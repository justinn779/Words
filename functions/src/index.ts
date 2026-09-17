// Cloud Functions entry point for the AI-generated category content pipeline.
//
// Design: OpenAI only ever produces *content* — a category name plus a word list,
// the same shape as src/data/seed.ts's SeedRow. It never touches board layout or
// win-condition logic. Every generated category is re-verified through the exact
// same generate -> solve -> accept/reject pipeline (src/engine/generator.ts) that
// every hand-authored level in this game goes through, before it's ever written to
// Firestore — so the "no unsolvable board ever reaches a player" guarantee
// (docs/game-rules.md, docs/level-generator.md) holds for AI content too.
//
// Accepted categories land in the public, read-only `aiCategories/{categoryId}`
// collection (see firestore.rules) — the client merges these with the built-in
// SEED categories when picking a level's category pool. Nothing about the
// deterministic, offline, no-network core game loop changes: this is purely an
// occasional content top-up.

import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

import type { Category, Difficulty, LevelConfig, WordEntry } from '../../src/engine/types'
import { generateSolvableLevel, type LevelConfigWithoutSeed } from '../../src/engine/generator'
import { createRng, shuffle } from '../../src/engine/rng'
import { SEED } from '../../src/data/seed'
import { DIFFICULTY_SHAPE, varyWordCounts, totalCardCount, estimateTargets, computeDeckSize } from '../../src/data/difficultyShapes'
import { generateCategories, reviewCategories, type GeneratedCategory } from './openai'

initializeApp()

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY')
const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN')
const TELEGRAM_CHAT_ID = defineSecret('TELEGRAM_CHAT_ID')

// --- Developer notifications (Telegram) -------------------------------------------
//
// A handful of events worth knowing about right away rather than digging through
// logs for: a player flags a level as unsolvable (reportUnsolvableLevel below), AI
// level generation starting/finishing/failing, and a player actually registering
// (linking a persistent account, not every anonymous first-visit). Any function
// that calls notifyDeveloper must list TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID in its
// own `secrets` array — v2 only injects a secret into functions that declare it.

async function sendTelegramNotification(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  if (!res.ok) throw new Error(`Telegram API responded ${res.status}: ${await res.text()}`)
}

/** Best-effort: never throws — a notification glitch must never fail the actual
 * operation it's reporting on. */
async function notifyDeveloper(text: string): Promise<void> {
  try {
    await sendTelegramNotification(TELEGRAM_BOT_TOKEN.value(), TELEGRAM_CHAT_ID.value(), text)
  } catch (err) {
    logger.error('notifyDeveloper: Telegram notification failed', { error: String(err) })
  }
}

const AI_CATEGORIES_COLLECTION = 'aiCategories'
const MIN_WORDS = 8
const CATEGORY_ID_RE = /^[a-z][a-z0-9-]{2,40}$/
const WORD_LEN_RANGE = [1, 6] as const

interface VerifiedCategory extends GeneratedCategory {
  moveCount?: number
}

interface GenerationSummary {
  requested: number
  accepted: VerifiedCategory[]
  rejected: { categoryId: string; reason: string }[]
}

function isWellFormed(cat: GeneratedCategory): string | null {
  if (!CATEGORY_ID_RE.test(cat.categoryId)) return `bad categoryId "${cat.categoryId}"`
  if (!cat.name || cat.name.length > 10) return 'name missing or too long'
  if (cat.words.length < MIN_WORDS) return `only ${cat.words.length} words, need >= ${MIN_WORDS}`
  const [min, max] = WORD_LEN_RANGE
  if (cat.words.some((w) => w.length < min || w.length > max)) return 'a word is outside the 1-6 character range'
  if (new Set(cat.words).size !== cat.words.length) return 'duplicate words'
  return null
}

/** Builds the same Category/WordEntry shape src/data/categories.ts and words.ts
 * derive from SEED, but for one just-generated category — so it can be run through
 * the real engine without any special-casing. */
function toEngineShape(cat: GeneratedCategory): { category: Category; words: WordEntry[] } {
  const wordIds = cat.words.map((_, i) => `${cat.categoryId}-${i + 1}`)
  return {
    category: { id: cat.categoryId, name: cat.name, wordIds },
    words: cat.words.map((text, i) => ({ id: wordIds[i], text, possibleCategoryIds: [cat.categoryId] })),
  }
}

/** Confirms a single new category can, on its own, deal into a genuinely winnable
 * board — the same solver-verified acceptance every hand-authored level requires
 * (see scripts/generate-levels.ts). Uses a small easy-difficulty single-category
 * shape; this is a content sanity check, not a full difficulty-tier level. */
function verifySolvable(cat: GeneratedCategory): { solvable: boolean; moveCount?: number } {
  const { category, words } = toEngineShape(cat)
  const base: Omit<LevelConfig, 'seed'> = {
    id: `ai-check-${cat.categoryId}`,
    difficulty: 'easy',
    categoryIds: [cat.categoryId],
    columnCount: 4,
    categorySlotCount: 1,
    deckEnabled: false,
    deckSize: 0,
    categoryWordCounts: { [cat.categoryId]: Math.min(MIN_WORDS, cat.words.length) },
    targetThreeStarMoves: 0,
    targetTwoStarMoves: 0,
    targetThreeStarTime: 0,
    targetTwoStarTime: 0,
  }
  const result = generateSolvableLevel(base, [category], words, { maxAttempts: 4, maxStates: 20000 })
  return { solvable: result.solvable, moveCount: result.moveCount }
}

/** Fetches the categoryIds already in use (built-in SEED + previously accepted AI
 * categories) so OpenAI is asked to avoid them. */
async function existingCategoryIds(): Promise<string[]> {
  const db = getFirestore()
  const snap = await db.collection(AI_CATEGORIES_COLLECTION).select().get()
  return [...SEED.map((row) => row.categoryId), ...snap.docs.map((d) => d.id)]
}

/** Every word already in play anywhere in the game — built-in SEED plus every
 * previously accepted AI category. A category's own categoryId not colliding
 * with an existing one (existingCategoryIds above) says nothing about whether
 * its WORDS collide with some other category's; the same word appearing under
 * two different categories is exactly the ambiguity the design explicitly rules
 * out ("每個詞語必須...明確、毫無疑義地只屬於這一個分類" — src/data/seed.ts's
 * header), but nothing checked for it before this. */
async function existingWords(): Promise<Set<string>> {
  const db = getFirestore()
  const snap = await db.collection(AI_CATEGORIES_COLLECTION).select('words').get()
  const words = new Set<string>(SEED.flatMap((row) => row.words))
  for (const doc of snap.docs) {
    const list = doc.data().words as unknown
    if (Array.isArray(list)) for (const w of list) if (typeof w === 'string') words.add(w)
  }
  return words
}

/** Full content (not just ids) for every category already in the shared pool —
 * built-in SEED plus every previously accepted AI category — the raw material
 * fillShortfallFromExistingPool draws from. A category recurring across
 * levels this way is no different from a SEED category already appearing in
 * multiple hand-authored levels today. */
async function existingCategoriesFull(): Promise<GeneratedCategory[]> {
  const db = getFirestore()
  const snap = await db.collection(AI_CATEGORIES_COLLECTION).get()
  const fromAi: GeneratedCategory[] = snap.docs.map((d) => {
    const data = d.data() as { name?: string; words?: string[] }
    return { categoryId: d.id, name: data.name ?? d.id, words: Array.isArray(data.words) ? data.words : [] }
  })
  return [...SEED.map((row) => ({ categoryId: row.categoryId, name: row.name, words: row.words })), ...fromAi]
}

/** The guarantee that level generation never simply gives up: if `accepted`
 * (whatever OpenAI produced and passed verification) falls short of
 * `minAccepted`, tops it up with categories already known-good — built-in SEED
 * plus previously accepted AI content — until the target is met or the whole
 * shared pool is exhausted (34+ SEED categories alone, so this cannot realistically
 * come up short). These are never re-persisted to aiCategories (they're already
 * there, or built-in) and never re-run through the solver (already verified when
 * first accepted, or hand-authored) — see the callers for why only the genuinely
 * new portion of the return value gets persisted. */
async function fillShortfallFromExistingPool(
  accepted: VerifiedCategory[],
  /** categoryIds already picked for THIS level's own pool (just `accepted`'s
   * own ids) — deliberately not the whole game's existingCategoryIds(), since
   * reusing a category that's already in some OTHER level is completely fine
   * (see existingCategoriesFull's comment) and excluding all of them would empty
   * out the very pool this function exists to draw from. */
  usedIds: Set<string>,
  minAccepted: number,
): Promise<VerifiedCategory[]> {
  if (accepted.length >= minAccepted) return accepted
  const rng = createRng(`fallback-${[...usedIds].sort().join(',')}`)
  const pool = await existingCategoriesFull()
  const candidates = shuffle(
    pool.filter((c) => !usedIds.has(c.categoryId)),
    rng,
  )
  const filled = [...accepted]
  for (const cat of candidates) {
    if (filled.length >= minAccepted) break
    filled.push({ ...cat })
  }
  return filled
}

/** Keeps only the candidates that are well-formed, don't reuse a word that's
 * already spoken for by some OTHER category (see existingWords above — this is
 * a distinct check from the categoryId collision below), AND solver-verified,
 * out of an already-fetched batch. Does not touch Firestore — see
 * persistAcceptedCategories. The verification core shared by both
 * verifyCategoryCandidates (fetches from OpenAI itself) and
 * generateLevelNow (which uses the same category-generation pipeline for a
 * single level's categories). Mutates neither input set — callers doing
 * multiple rounds (the top-up retry loop in generateLevelNow) add
 * newly-accepted ids/words to their own copies. */
function verifyCategoryCandidatesFrom(
  candidates: GeneratedCategory[],
  existingIds: string[],
  existingWordSet: Set<string>,
): { accepted: VerifiedCategory[]; rejected: { categoryId: string; reason: string }[] } {
  const seenIds = new Set(existingIds)
  const seenWords = new Set(existingWordSet)
  const accepted: VerifiedCategory[] = []
  const rejected: { categoryId: string; reason: string }[] = []

  for (const cat of candidates) {
    if (seenIds.has(cat.categoryId)) {
      rejected.push({ categoryId: cat.categoryId, reason: 'categoryId already exists' })
      continue
    }
    const formatIssue = isWellFormed(cat)
    if (formatIssue) {
      rejected.push({ categoryId: cat.categoryId, reason: formatIssue })
      continue
    }
    const reusedWord = cat.words.find((w) => seenWords.has(w))
    if (reusedWord) {
      rejected.push({ categoryId: cat.categoryId, reason: `word "${reusedWord}" already used by another category` })
      continue
    }
    const { solvable, moveCount } = verifySolvable(cat)
    if (!solvable) {
      rejected.push({ categoryId: cat.categoryId, reason: 'solver could not verify a winnable board' })
      continue
    }
    seenIds.add(cat.categoryId)
    for (const w of cat.words) seenWords.add(w)
    accepted.push({ ...cat, moveCount })
  }

  return { accepted, rejected }
}

/** Asks OpenAI for `count` new categories and keeps only the ones that are
 * well-formed AND solver-verified. Does not touch Firestore — see
 * persistAcceptedCategories. */
async function verifyCategoryCandidates(
  apiKey: string,
  existingIds: string[],
  existingWordSet: Set<string>,
  count: number,
): Promise<{ accepted: VerifiedCategory[]; rejected: { categoryId: string; reason: string }[] }> {
  const candidates = await generateCategories(apiKey, existingIds, count)
  return verifyCategoryCandidatesFrom(candidates, existingIds, existingWordSet)
}

/** Second, semantic quality gate on top of the mechanical checks above (format,
 * word-collision, solver) — asks OpenAI to self-critique its own output for
 * vagueness/ambiguity/obscurity a mechanical check can't catch (see
 * openai.ts's reviewCategories for the exact criteria), and drops anything it
 * flags. One review call for the whole batch, not one per category. Never lets
 * the review call itself failing (bad JSON, network hiccup) block generation —
 * on error, or for any category the reviewer doesn't mention, that category
 * just passes through unreviewed rather than discarding content over a
 * formatting problem in the review step. */
async function reviewAcceptedCategories(
  apiKey: string,
  accepted: VerifiedCategory[],
): Promise<{ kept: VerifiedCategory[]; rejected: { categoryId: string; reason: string }[] }> {
  if (accepted.length === 0) return { kept: accepted, rejected: [] }
  try {
    const reviews = await reviewCategories(apiKey, accepted)
    const reviewById = new Map(reviews.map((r) => [r.categoryId, r]))
    const kept: VerifiedCategory[] = []
    const rejected: { categoryId: string; reason: string }[] = []
    for (const cat of accepted) {
      const review = reviewById.get(cat.categoryId)
      if (review?.keep === false) {
        rejected.push({ categoryId: cat.categoryId, reason: `review: ${review.reason ?? 'flagged as low quality'}` })
        continue
      }
      kept.push(cat)
    }
    return { kept, rejected }
  } catch (err) {
    logger.warn('reviewAcceptedCategories: review call failed, keeping all unreviewed', { error: String(err) })
    return { kept: accepted, rejected: [] }
  }
}

async function persistAcceptedCategories(accepted: VerifiedCategory[]): Promise<void> {
  if (accepted.length === 0) return
  const db = getFirestore()
  const batch = db.batch()
  for (const cat of accepted) {
    batch.set(db.collection(AI_CATEGORIES_COLLECTION).doc(cat.categoryId), {
      categoryId: cat.categoryId,
      name: cat.name,
      words: cat.words,
      source: 'openai',
      createdAt: FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()
}

/** The core pipeline: ask OpenAI for `count` new categories, keep only the ones
 * that are well-formed AND solver-verified, write those to Firestore. Always
 * returns a summary rather than throwing, so a partial success (some rejected) is
 * still useful — callers decide whether that's good enough. */
async function generateAndVerifyCategories(apiKey: string, count: number): Promise<GenerationSummary> {
  const existingIds = await existingCategoryIds()
  const existingWordSet = await existingWords()
  const { accepted, rejected } = await verifyCategoryCandidates(apiKey, existingIds, existingWordSet, count)
  await persistAcceptedCategories(accepted)
  return { requested: count, accepted, rejected }
}

/** Scheduled top-up: once a day, try to add a few new categories to the shared
 * pool. Low frequency by design — this is meant to slowly enrich Daily Challenge
 * and future infinite-mode variety, not to regenerate content constantly. */
export const dailyAiCategoryRefresh = onSchedule(
  { schedule: 'every day 00:00', timeZone: 'Asia/Taipei', secrets: [OPENAI_API_KEY] },
  async () => {
    const summary = await generateAndVerifyCategories(OPENAI_API_KEY.value(), 3)
    logger.info('dailyAiCategoryRefresh done', summary)
  },
)

/** Manual trigger for testing, and the hook future "infinite mode" / "auto-advance
 * to next chapter" features can call on demand. Requires a signed-in caller
 * (anonymous is fine — every player has one, see src/firebase/auth.ts) purely to
 * stop anonymous internet strangers from running up the API bill; it does not
 * gate on *which* signed-in user. */
export const generateAiCategoriesNow = onCall({ secrets: [OPENAI_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in (even anonymously) before requesting new content.')
  }
  const count = Math.max(1, Math.min(5, Number(request.data?.count) || 3))
  const summary = await generateAndVerifyCategories(OPENAI_API_KEY.value(), count)
  logger.info('generateAiCategoriesNow done', { uid: request.auth.uid, ...summary })
  return summary
})

// --- Level generation --------------------------------------------------------------
//
// Every level is generated on demand and completely independently — there is no
// chapter grouping, fixed roster, or hand-authored content anymore (src/data/
// levels.ts and the old chapters.ts roster are gone). generateLevelNow below
// picks a level's categories with no unifying theme required (deliberately —
// putting stationery + outer space + fantasy creatures + Korean culture all in
// one level is fine, even encouraged, per explicit product direction), and
// stores the result in the public, read-only `levels/{levelNumber}` collection.
//
// An earlier version generated levels in themed 5-level batches (a "chapter"),
// asking OpenAI for categories under a narrow shared topic hint. In production
// that narrow a vocabulary collided with itself and with existing categories
// often enough that a batch could fall short of the categories a 'hard' level
// needs and give up entirely — a player reaching it just saw it stuck. This
// version fixes that at the root by not having a topic to conform to at all
// (a wide-open ask, same shape as dailyAiCategoryRefresh/generateAiCategoriesNow's
// top-up, is far less collision-prone), and fillShortfallFromExistingPool below
// still guarantees a level is never short even so — generation cannot fail to
// produce a playable level.

const LEVELS_COLLECTION = 'levels'
/** Asked for up front, with room to spare over DIFFICULTY_SHAPE.hard.categoryCount
 * (the largest single ask, currently 15) — OpenAI doesn't always keep to the
 * excluded-id list perfectly, and the more categories exist the likelier a given
 * attempt collides with one of them (see MAX_TOPUP_ATTEMPTS below). */
const CATEGORY_REQUEST_TARGET = 20
/** How many extra top-up rounds to try if the first batch doesn't clear this
 * level's DIFFICULTY_SHAPE categoryCount once duplicates/rejects are filtered
 * out — each round asks for just the shortfall (+ a small buffer), excluding
 * every id seen so far, including this level's own already-accepted ones.
 * Confirmed necessary in production: as more categories accumulate, OpenAI
 * increasingly resuggests an existing categoryId despite being told the
 * exclusion list, and a single failed attempt was aborting generation outright
 * even though a retry routinely succeeds. */
const MAX_TOPUP_ATTEMPTS = 4
const CATEGORY_REQUEST_BUFFER = 5
/** How many of the immediately preceding levels' categories get passed to the
 * prompt as a soft "avoid repeating this vibe" hint (see openai.ts's
 * buildPrompt) — distinct from the hard categoryId/word-uniqueness check every
 * candidate goes through regardless of this. */
const RECENT_LEVELS_TO_AVOID = 10

function buildLevelBase(
  levelNumber: number,
  difficulty: Difficulty,
  categoryIds: string[],
  categoryWordCounts: Record<string, number>,
): LevelConfigWithoutSeed {
  const shape = DIFFICULTY_SHAPE[difficulty]
  return {
    id: levelDocId(levelNumber),
    difficulty,
    categoryIds,
    columnCount: shape.columnCount,
    categorySlotCount: shape.slotCount,
    deckEnabled: shape.deckEnabled,
    deckSize: computeDeckSize(categoryWordCounts),
    categoryWordCounts,
    targetThreeStarMoves: 0,
    targetTwoStarMoves: 0,
    targetThreeStarTime: 0,
    targetTwoStarTime: 0,
  }
}

function levelDocId(levelNumber: number): string {
  return `level-${levelNumber}`
}

/** Level numbers are 1-based; difficulty repeats in a fixed 5-level cycle
 * (1=easy, 2=normal, 3=normal, 4=hard, 5=normal, 6=easy, ...) — mirrors
 * src/data/progression.ts's getDifficultyForLevel (duplicated rather than
 * imported since that module also pulls in client-only types; this is
 * intentionally the one place the rule is allowed to drift, and it's a
 * single line to keep in sync). */
function difficultyForLevel(levelNumber: number): Difficulty {
  const cycle: Difficulty[] = ['easy', 'normal', 'normal', 'hard', 'normal']
  return cycle[(levelNumber - 1) % cycle.length]
}

/** Category NAMES used across the RECENT_LEVELS_TO_AVOID levels immediately
 * before `levelNumber` — see openai.ts's buildPrompt for how this gets used. */
async function recentCategoryNames(levelNumber: number): Promise<string[]> {
  const db = getFirestore()
  const from = Math.max(1, levelNumber - RECENT_LEVELS_TO_AVOID)
  if (from >= levelNumber) return []
  const refs = Array.from({ length: levelNumber - from }, (_, i) => db.collection(LEVELS_COLLECTION).doc(levelDocId(from + i)))
  const snaps = await db.getAll(...refs)
  const ids = new Set<string>()
  for (const snap of snaps) {
    const data = snap.data() as { status?: string; config?: LevelConfig } | undefined
    if (data?.status === 'ready') for (const id of data.config?.categoryIds ?? []) ids.add(id)
  }
  if (ids.size === 0) return []
  const pool = await existingCategoriesFull()
  const nameById = new Map(pool.map((c) => [c.categoryId, c.name]))
  return [...ids].map((id) => nameById.get(id) ?? id)
}

/** How long a 'generating' lock is honored before a retry is allowed to just take
 * over — covers a crashed/killed previous attempt rather than wedging the level
 * forever. Not a true distributed lock (a rare double-generate under this window
 * just wastes an OpenAI call, never corrupts anything — last writer wins on the
 * same idempotent doc), which is an acceptable trade for how rarely this fires. */
const GENERATING_LOCK_TIMEOUT_MS = 3 * 60 * 1000

/** Callable (see src/firebase/levels.ts for the client side) that generates a
 * single, specific level number on demand — the client's ahead-buffer
 * (src/store/contentStore.ts) calls this for whichever of the next few levels
 * don't exist yet. Reuses whatever's already stored if another player (or an
 * earlier, slower request) already generated this level number — every player
 * sees the same level once it exists, same principle as Daily Challenge's
 * shared-seed determinism, just generated once instead of computed. */
export const generateLevelNow = onCall(
  { secrets: [OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID], timeoutSeconds: 300, memory: '1GiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in (even anonymously) before requesting new content.')
    }
    const levelNumber = Number(request.data?.levelNumber)
    if (!Number.isInteger(levelNumber) || levelNumber < 1) {
      throw new HttpsError('invalid-argument', `Invalid levelNumber "${request.data?.levelNumber}"`)
    }

    const db = getFirestore()
    const levelRef = db.collection(LEVELS_COLLECTION).doc(levelDocId(levelNumber))
    const existingSnap = await levelRef.get()
    if (existingSnap.exists) {
      const data = existingSnap.data() as { status?: string; config?: LevelConfig; startedAt?: FirebaseFirestore.Timestamp }
      if (data.status === 'ready' && data.config) {
        logger.info('generateLevelNow reused existing level', { levelNumber, uid: request.auth.uid })
        return { levelNumber, config: data.config, reused: true }
      }
      if (data.status === 'generating' && Date.now() - (data.startedAt?.toMillis() ?? 0) < GENERATING_LOCK_TIMEOUT_MS) {
        throw new HttpsError('already-exists', 'This level is already being generated — try again shortly.')
      }
    }

    await levelRef.set({ status: 'generating', startedAt: FieldValue.serverTimestamp() })
    await notifyDeveloper(`[文字接龍] 開始生成第 ${levelNumber} 關`)

    try {
      const difficulty = difficultyForLevel(levelNumber)
      const shape = DIFFICULTY_SHAPE[difficulty]
      const existingIds = await existingCategoryIds()
      const existingWordSet = await existingWords()
      const avoidThemes = await recentCategoryNames(levelNumber)

      let accepted: VerifiedCategory[] = []
      let rejected: { categoryId: string; reason: string }[] = []
      try {
        const excludedIds = new Set(existingIds)
        const excludedWords = new Set(existingWordSet)
        const candidates = await generateCategories(OPENAI_API_KEY.value(), [...excludedIds], CATEGORY_REQUEST_TARGET, avoidThemes)
        const initial = verifyCategoryCandidatesFrom(candidates, [...excludedIds], excludedWords)
        accepted = initial.accepted
        rejected = initial.rejected
        for (const cat of accepted) {
          excludedIds.add(cat.categoryId)
          for (const w of cat.words) excludedWords.add(w)
        }

        for (let attempt = 0; attempt < MAX_TOPUP_ATTEMPTS && accepted.length < shape.categoryCount; attempt++) {
          const count = shape.categoryCount - accepted.length + CATEGORY_REQUEST_BUFFER
          const more = await generateCategories(OPENAI_API_KEY.value(), [...excludedIds], count, avoidThemes)
          const verified = verifyCategoryCandidatesFrom(more, [...excludedIds], excludedWords)
          for (const cat of verified.accepted) {
            excludedIds.add(cat.categoryId)
            for (const w of cat.words) excludedWords.add(w)
          }
          accepted = [...accepted, ...verified.accepted]
          rejected = [...rejected, ...verified.rejected]
        }

        const review = await reviewAcceptedCategories(OPENAI_API_KEY.value(), accepted)
        accepted = review.kept
        rejected = [...rejected, ...review.rejected]
      } catch (err) {
        // OpenAI itself unreachable/malformed — not fatal, fillShortfallFromExistingPool
        // below fills the whole level from the existing pool instead.
        logger.warn('generateLevelNow: AI category generation failed, falling back to existing pool', {
          levelNumber,
          error: String(err),
        })
      }
      logger.info('generateLevelNow category candidates', { levelNumber, acceptedCount: accepted.length, rejected })

      await persistAcceptedCategories(accepted)

      const filled = await fillShortfallFromExistingPool(accepted, new Set(accepted.map((c) => c.categoryId)), shape.categoryCount)
      if (filled.length > accepted.length) {
        logger.info('generateLevelNow topped up shortfall from existing pool', {
          levelNumber,
          newlyGenerated: accepted.length,
          filledFromPool: filled.length - accepted.length,
        })
      }

      const rng = createRng(`level-${levelNumber}`)
      // fillShortfallFromExistingPool only guarantees >= shape.categoryCount, not
      // exactly — a generous OpenAI batch can overshoot, so trim back down.
      const categoryIds = shuffle(filled.map((c) => c.categoryId), rng).slice(0, shape.categoryCount)
      const categoryWordCounts = varyWordCounts(rng, difficulty, categoryIds)
      const base = buildLevelBase(levelNumber, difficulty, categoryIds, categoryWordCounts)
      const targets = estimateTargets(totalCardCount(categoryWordCounts))
      // No solver verification here, on purpose: this config only fixes the
      // level's card *pool* — the actual deal (deck vs. column placement,
      // ordering) is randomized fresh every time a player enters or replays it
      // (see src/engine/deal.ts's dealUntilLikelyWinnable, which ignores this
      // `seed`). Pre-verifying one specific seed at generation time was both
      // expensive (this is exactly what once made generation risk the 300s
      // Cloud Function timeout) and pointless under that model.
      const config: LevelConfig = { ...base, ...targets, seed: `${base.id}-s0` }

      await levelRef.set({ status: 'ready', config, readyAt: FieldValue.serverTimestamp() })
      logger.info('generateLevelNow done', { levelNumber, uid: request.auth.uid, difficulty })
      await notifyDeveloper(`[文字接龍] 第 ${levelNumber} 關生成成功\n難度：${difficulty}`)
      return { levelNumber, config, reused: false }
    } catch (err) {
      await levelRef.set({ status: 'failed', error: String(err), failedAt: FieldValue.serverTimestamp() })
      logger.error('generateLevelNow failed', { levelNumber, error: String(err) })
      await notifyDeveloper(`[文字接龍] 第 ${levelNumber} 關生成失敗\n錯誤：${String(err)}`)
      throw new HttpsError('internal', `Level generation failed: ${String(err)}`)
    }
  },
)

// --- "Report an unsolvable level" ------------------------------------------------
//
// The generator's solver (src/engine/generator.ts) is a best-effort check, not a
// proof — it's deliberately kept cheap (bounded attempts/states, see that file's
// comments) rather than tuned for perfect coverage, because the search budget
// needed to guarantee every level solves scales with board size in a way that
// would mean shrinking the game itself just to keep the checker fast. That
// trade-off is intentional: gameplay (deck size, difficulty curve) is never
// adjusted for the solver's convenience. This is the other half of that trade —
// a low-friction way for a player who actually gets stuck to flag the specific
// level, so it can be fixed by hand instead.

const LEVEL_REPORT_FLAGS_COLLECTION = 'levelReportFlags'
const REPORT_ID_RE = /^[a-zA-Z0-9-]{1,80}$/

/** Player-facing callable (see src/firebase/reports.ts and HUD.tsx's "❗ 回報無解"
 * button): records that `levelId` was flagged as possibly unsolvable, and — only
 * the first time this happens while the flag is unresolved — notifies the
 * developer over Telegram and email so it can be fixed by hand. Further reports
 * of the same still-open level just bump a counter rather than re-notifying, so
 * one broken level going viral doesn't spam either channel. Once the level is
 * fixed and re-verified, the fix workflow deletes/resolves this flag doc so a
 * future regression can notify again. */
export const reportUnsolvableLevel = onCall(
  { secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in (even anonymously) before reporting a level.')
    }
    const levelId = String(request.data?.levelId ?? '')
    const difficulty = String(request.data?.difficulty ?? '')
    if (!REPORT_ID_RE.test(levelId)) {
      throw new HttpsError('invalid-argument', 'Missing or malformed levelId')
    }

    const db = getFirestore()
    const flagRef = db.collection(LEVEL_REPORT_FLAGS_COLLECTION).doc(levelId)
    const shouldNotify = await db.runTransaction(async (tx) => {
      const snap = await tx.get(flagRef)
      const data = snap.exists ? (snap.data() as { resolved?: boolean; reportCount?: number }) : undefined
      const alreadyOpen = data && data.resolved !== true
      tx.set(
        flagRef,
        {
          difficulty,
          resolved: false,
          reportCount: (alreadyOpen ? (data?.reportCount ?? 0) : 0) + 1,
          lastReportedAt: FieldValue.serverTimestamp(),
          ...(alreadyOpen ? {} : { firstReportedAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      )
      return !alreadyOpen
    })

    if (shouldNotify) {
      const text = `[文字接龍] 玩家回報可能無解的關卡\n關卡：${levelId}\n難度：${difficulty}`
      await notifyDeveloper(text)
    }

    logger.info('reportUnsolvableLevel recorded', { levelId, difficulty, uid: request.auth.uid, notified: shouldNotify })
    return { ok: true }
  },
)

// --- "A player registered" notification ------------------------------------------
//
// Anonymous sign-in happens automatically for every first-time visitor (see
// src/firebase/auth.ts's initAuth) — far too frequent to notify on and not a
// meaningful event on its own. What's actually worth knowing about is a player
// choosing to link a persistent account (currently Google — see linkGoogleAccount),
// which the client calls this after. Deduped per uid (a page reload or a retry
// after an already-successful link never double-notifies).

const USER_REGISTERED_FLAGS_COLLECTION = 'userRegisteredFlags'

export const notifyUserRegistered = onCall({ secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in before registering.')
  }
  const uid = request.auth.uid
  const displayName = typeof request.data?.displayName === 'string' ? request.data.displayName.slice(0, 100) : undefined
  const provider = typeof request.data?.provider === 'string' ? request.data.provider.slice(0, 40) : 'unknown'

  const db = getFirestore()
  const flagRef = db.collection(USER_REGISTERED_FLAGS_COLLECTION).doc(uid)
  const alreadyNotified = await db.runTransaction(async (tx) => {
    const snap = await tx.get(flagRef)
    if (snap.exists) return true
    tx.set(flagRef, { provider, displayName: displayName ?? null, registeredAt: FieldValue.serverTimestamp() })
    return false
  })

  if (!alreadyNotified) {
    const text = `[文字接龍] 有新玩家註冊\n方式：${provider}\n名稱：${displayName ?? '（無）'}\nUID：${uid}`
    await notifyDeveloper(text)
  }

  logger.info('notifyUserRegistered recorded', { uid, provider, notified: !alreadyNotified })
  return { ok: true }
})
