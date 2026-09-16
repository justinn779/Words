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
import { generateCategories, generateNewChapterContent, reviewCategories, type GeneratedCategory } from './openai'

initializeApp()

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY')
const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN')
const TELEGRAM_CHAT_ID = defineSecret('TELEGRAM_CHAT_ID')

// --- Developer notifications (Telegram) -------------------------------------------
//
// A handful of events worth knowing about right away rather than digging through
// logs for: a player flags a level as unsolvable (reportUnsolvableLevel below), AI
// chapter generation starting/finishing/failing, and a player actually registering
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
    chapterId: 'ai-check',
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
 * fillShortfallFromExistingPool draws from. A category recurring across chapters
 * this way is no different from a SEED category already appearing in multiple
 * hand-authored chapters today. */
async function existingCategoriesFull(): Promise<GeneratedCategory[]> {
  const db = getFirestore()
  const snap = await db.collection(AI_CATEGORIES_COLLECTION).get()
  const fromAi: GeneratedCategory[] = snap.docs.map((d) => {
    const data = d.data() as { name?: string; words?: string[] }
    return { categoryId: d.id, name: data.name ?? d.id, words: Array.isArray(data.words) ? data.words : [] }
  })
  return [...SEED.map((row) => ({ categoryId: row.categoryId, name: row.name, words: row.words })), ...fromAi]
}

/** The guarantee that chapter generation never simply gives up: if `accepted`
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
  /** categoryIds already picked for THIS chapter's own pool (just `accepted`'s
   * own ids) — deliberately not the whole game's existingCategoryIds(), since
   * reusing a category that's already in some OTHER chapter is completely fine
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
 * generateNewChapterNow (which fetches candidates bundled with a chapter
 * theme in one call, via generateNewChapterContent). Mutates neither input set —
 * callers doing multiple rounds (the retry loop in generateNewChapterNow) add
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
 * persistAcceptedCategories. Shared by the plain category top-up and the
 * chapter-generation pipeline below (which passes a `theme` hint). */
async function verifyCategoryCandidates(
  apiKey: string,
  existingIds: string[],
  existingWordSet: Set<string>,
  count: number,
  theme?: string,
): Promise<{ accepted: VerifiedCategory[]; rejected: { categoryId: string; reason: string }[] }> {
  const candidates = await generateCategories(apiKey, existingIds, count, theme)
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

// --- Chapter generation ----------------------------------------------------------
//
// Every chapter is generated on demand now — there is no fixed roster or
// hand-authored content (src/data/levels.ts and the old chapters.ts roster are
// gone). generateNewChapterNow below invents each chapter's theme + categories,
// built into a real difficulty curve, run through the exact same solver-verified
// pipeline every level in the game always has (see buildChapterLevels below), and
// stored in the public, read-only `aiChapters/{chapterId}` collection so every
// later player who reaches that chapter reuses it instead of regenerating.
//
// An earlier version asked OpenAI for categories under a narrow per-chapter topic
// hint. In production that narrow a vocabulary collided with itself and with
// existing categories often enough that a chapter could fall short of the
// categories a 'hard' level needs and give up entirely — a player reaching that
// chapter just saw it stuck. Two changes fix that: no topic hint on the category
// ask itself (a wide-open ask, same shape as dailyAiCategoryRefresh/
// generateAiCategoriesNow's top-up, is far less collision-prone, and matches how
// Daily Challenge mixes categories freely rather than sticking to one topic), and
// fillShortfallFromExistingPool below, which guarantees a chapter is never
// short — generation now literally cannot fail to produce a playable chapter.

const AI_CHAPTERS_COLLECTION = 'aiChapters'

/** One level per difficulty step — a reasonable single-chapter size that also
 * matches CHAPTER_CATEGORY_POOL_TARGET. */
const CHAPTER_LEVEL_CURVE: Difficulty[] = ['easy', 'easy', 'normal', 'normal', 'hard']
/** Asked for up front, with room to spare over DIFFICULTY_SHAPE.hard.categoryCount
 * (the largest single ask, currently 15) — OpenAI doesn't always keep to the
 * excluded-id/title list perfectly, and the more chapters exist the likelier a
 * given attempt collides with one of them (see MAX_TOPUP_ATTEMPTS below). */
const CHAPTER_CATEGORY_POOL_TARGET = 20
/** How many extra top-up rounds to try if the first batch doesn't clear
 * DIFFICULTY_SHAPE.hard.categoryCount once duplicates/rejects are filtered out —
 * each round asks for just the shortfall (+ a small buffer), excluding every id
 * seen so far, including this chapter's own already-accepted ones. Confirmed
 * necessary in production: as more chapters accumulate, OpenAI increasingly
 * resuggests an existing categoryId or a near-duplicate theme despite being told
 * the exclusion list, and a single failed attempt was aborting generation
 * outright even though a retry routinely succeeds. */
const MAX_TOPUP_ATTEMPTS = 4
const CATEGORY_REQUEST_BUFFER = 5

function buildChapterLevelBase(
  chapterId: string,
  difficulty: Difficulty,
  index: number,
  categoryIds: string[],
  categoryWordCounts: Record<string, number>,
): LevelConfigWithoutSeed {
  const shape = DIFFICULTY_SHAPE[difficulty]
  return {
    id: `${chapterId}-${String(index + 1).padStart(2, '0')}`,
    chapterId,
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

/** Mirrors scripts/generate-levels.ts's generateChapter, but over a freshly
 * AI-generated category pool instead of the static built-in CATEGORIES/WORDS. */
function buildChapterLevels(chapterId: string, pool: Category[], words: WordEntry[]): { levels: LevelConfig[]; unsolvedIds: string[] } {
  const rng = createRng(`chapter-levels-${chapterId}`)
  const poolIds = pool.map((c) => c.id)
  const levels: LevelConfig[] = []
  const unsolvedIds: string[] = []

  CHAPTER_LEVEL_CURVE.forEach((difficulty, index) => {
    const shape = DIFFICULTY_SHAPE[difficulty]
    const categoryCount = Math.min(shape.categoryCount, poolIds.length)
    const categoryIds = shuffle(poolIds, rng).slice(0, categoryCount)
    const categoryWordCounts = varyWordCounts(rng, difficulty, categoryIds)
    const base = buildChapterLevelBase(chapterId, difficulty, index, categoryIds, categoryWordCounts)

    // A tight budget: this runs inside a live Cloud Function call with a hard
    // 300s ceiling shared with the OpenAI calls above, across all 5 levels —
    // not an offline batch job with minutes to spare. Confirmed necessary in
    // production: DIFFICULTY_SHAPE's larger category counts (up to 15 for
    // 'hard') made a plain DFS at the previous budget (5 attempts x 30000
    // states) take long enough per level that a whole chapter could blow the
    // timeout entirely, exactly like scripts/generate-levels.ts's old default
    // budget once did offline (see difficultyShapes.ts's history). A level
    // that doesn't solve within budget still ships (see unsolvedIds) — same
    // "log it, don't block" trade-off generateAndVerifyCategories takes; the
    // player-facing "❗ 回報無解" report flow is the actual safety net now.
    const result = generateSolvableLevel(base, pool, words, { maxAttempts: 2, maxStates: 5000 })
    const targets = estimateTargets(totalCardCount(categoryWordCounts))
    if (!result.solvable) unsolvedIds.push(result.config.id)
    levels.push({ ...result.config, ...targets })
  })

  return { levels, unsolvedIds }
}

// generateNewChapterNow reserves the next sequential chapter "order" via a
// Firestore counter (meta/chapterCounter — see firestore.rules for why clients
// can't touch it directly), asks OpenAI for a fresh theme and the categories to
// match, then runs the verify -> build -> store pipeline below. Chapter ids are
// named `ai-chapter-{order}`; src/data/progression.ts's getContentChapterOrder
// sorts these by that numeric order.

const CHAPTER_COUNTER_DOC = 'meta/chapterCounter'
/** No fixed roster anymore — chapter numbering starts at 1. */
const FIRST_DYNAMIC_CHAPTER_ORDER = 1

/** All chapter titles/themes already in use, static or generated — asked of
 * OpenAI so it doesn't invent a theme that duplicates one that already exists. */
async function existingChapterTitles(): Promise<string[]> {
  const db = getFirestore()
  const snap = await db.collection(AI_CHAPTERS_COLLECTION).where('status', '==', 'ready').select('title').get()
  return snap.docs.map((d) => d.data().title as string | undefined).filter((t): t is string => Boolean(t))
}

export const generateNewChapterNow = onCall(
  { secrets: [OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID], timeoutSeconds: 300, memory: '1GiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in (even anonymously) before requesting new content.')
    }

    const db = getFirestore()
    // Atomically reserve the next order number so two players finishing the last
    // chapter at nearly the same moment don't generate two competing chapters.
    const order = await db.runTransaction(async (tx) => {
      const counterRef = db.doc(CHAPTER_COUNTER_DOC)
      const snap = await tx.get(counterRef)
      const next = snap.exists ? (snap.data()!.nextOrder as number) : FIRST_DYNAMIC_CHAPTER_ORDER
      tx.set(counterRef, { nextOrder: next + 1 }, { merge: true })
      return next
    })
    const chapterId = `ai-chapter-${order}`
    const chapterRef = db.collection(AI_CHAPTERS_COLLECTION).doc(chapterId)

    await chapterRef.set({ status: 'generating', order, startedAt: FieldValue.serverTimestamp() })
    await notifyDeveloper(`[文字接龍] 開始生成全新章節\n預計序號：${order}`)

    try {
      const existingIds = await existingCategoryIds()
      const existingWordSet = await existingWords()

      // A brand-new chapter's title only makes sense if OpenAI actually invents
      // one — but everything downstream of it (the categories) still has the same
      // guarantee as generateNextChapterNow: any failure anywhere in this
      // AI-dependent chain (theme invention, top-up rounds, review) is not fatal —
      // it just leaves chapterTitle unset and accepted empty, and
      // fillShortfallFromExistingPool below fills the whole chapter from the
      // existing pool. getChapterDisplayTitle (src/data/progression.ts) already
      // renders a chapter with no AI title as a plain "第N章", so this degrades
      // gracefully rather than leaving the chapter stuck.
      let chapterTitle: string | undefined
      let accepted: VerifiedCategory[] = []
      let rejected: { categoryId: string; reason: string }[] = []
      try {
        const existingTitles = await existingChapterTitles()
        const seed = await generateNewChapterContent(OPENAI_API_KEY.value(), existingIds, existingTitles, CHAPTER_CATEGORY_POOL_TARGET)
        chapterTitle = seed.chapterTitle
        logger.info('generateNewChapterNow theme', { chapterId, order, chapterTitle })

        const excludedIds = new Set(existingIds)
        const excludedWords = new Set(existingWordSet)
        const initial = verifyCategoryCandidatesFrom(seed.categories, [...excludedIds], excludedWords)
        accepted = initial.accepted
        rejected = initial.rejected
        for (const cat of accepted) {
          excludedIds.add(cat.categoryId)
          for (const w of cat.words) excludedWords.add(w)
        }

        // The theme is only invented once (above) — these top-up rounds ask for
        // more categories under that SAME theme, they don't re-invent a new one.
        for (let attempt = 0; attempt < MAX_TOPUP_ATTEMPTS && accepted.length < DIFFICULTY_SHAPE.hard.categoryCount; attempt++) {
          const count = DIFFICULTY_SHAPE.hard.categoryCount - accepted.length + CATEGORY_REQUEST_BUFFER
          const more = await generateCategories(OPENAI_API_KEY.value(), [...excludedIds], count, chapterTitle)
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
        logger.warn('generateNewChapterNow: AI theme/category generation failed, falling back to the existing pool with a generic title', {
          chapterId,
          order,
          error: String(err),
        })
        chapterTitle = undefined
        accepted = []
        rejected = []
      }
      logger.info('generateNewChapterNow category candidates', { chapterId, acceptedCount: accepted.length, rejected })

      await persistAcceptedCategories(accepted)

      // Same guarantee as generateNextChapterNow — if this new theme didn't yield
      // enough verified categories of its own, top up from the existing pool
      // rather than leaving the chapter stuck. The chapter still gets its own
      // freshly-invented title even when some of its categories end up being
      // familiar ones.
      const filled = await fillShortfallFromExistingPool(
        accepted,
        new Set(accepted.map((c) => c.categoryId)),
        DIFFICULTY_SHAPE.hard.categoryCount,
      )
      if (filled.length > accepted.length) {
        logger.info('generateNewChapterNow topped up shortfall from existing pool', {
          chapterId,
          newlyGenerated: accepted.length,
          filledFromPool: filled.length - accepted.length,
        })
      }

      const pool: Category[] = filled.map((cat) => toEngineShape(cat).category)
      const words: WordEntry[] = filled.flatMap((cat) => toEngineShape(cat).words)
      const { levels, unsolvedIds } = buildChapterLevels(chapterId, pool, words)
      if (unsolvedIds.length > 0) {
        logger.warn('generateNewChapterNow: some levels unverified', { chapterId, unsolvedIds })
      }

      // Firestore rejects an explicit `undefined` field value outright — omit
      // `title` entirely on the no-AI-theme fallback path rather than write one.
      await chapterRef.set({
        status: 'ready',
        ...(chapterTitle ? { title: chapterTitle } : {}),
        order,
        levels,
        readyAt: FieldValue.serverTimestamp(),
      })
      logger.info('generateNewChapterNow done', { chapterId, order, uid: request.auth.uid, levelCount: levels.length })
      await notifyDeveloper(
        `[文字接龍] 全新章節生成成功\n章節：${chapterId}\n標題：${chapterTitle ?? '（無，使用預設章節標題）'}\n關卡數：${levels.length}\n未驗證關卡數：${unsolvedIds.length}`,
      )
      return { chapterId, title: chapterTitle, order, levels }
    } catch (err) {
      await chapterRef.set({ status: 'failed', error: String(err), failedAt: FieldValue.serverTimestamp() }, { merge: true })
      logger.error('generateNewChapterNow failed', { chapterId, error: String(err) })
      await notifyDeveloper(`[文字接龍] 全新章節生成失敗\n章節：${chapterId}\n錯誤：${String(err)}`)
      throw new HttpsError('internal', `Chapter generation failed: ${String(err)}`)
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
    const chapterId = String(request.data?.chapterId ?? '')
    const difficulty = String(request.data?.difficulty ?? '')
    if (!REPORT_ID_RE.test(levelId) || !REPORT_ID_RE.test(chapterId)) {
      throw new HttpsError('invalid-argument', 'Missing or malformed levelId/chapterId')
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
          chapterId,
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
      const text = `[文字接龍] 玩家回報可能無解的關卡\n章節：${chapterId}\n關卡：${levelId}\n難度：${difficulty}`
      await notifyDeveloper(text)
    }

    logger.info('reportUnsolvableLevel recorded', { levelId, chapterId, difficulty, uid: request.auth.uid, notified: shouldNotify })
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
