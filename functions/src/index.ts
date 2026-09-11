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
import { DIFFICULTY_SHAPE, varyWordCounts, totalCardCount, estimateTargets } from '../../src/data/difficultyShapes'
import { generateCategories, type GeneratedCategory } from './openai'

initializeApp()

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY')

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

/** Asks OpenAI for `count` new categories and keeps only the ones that are
 * well-formed AND solver-verified. Does not touch Firestore — see
 * persistAcceptedCategories. Shared by the plain category top-up and the
 * chapter-generation pipeline below (which passes a `theme` hint). */
async function verifyCategoryCandidates(
  apiKey: string,
  existing: string[],
  count: number,
  theme?: string,
): Promise<{ accepted: VerifiedCategory[]; rejected: { categoryId: string; reason: string }[] }> {
  const candidates = await generateCategories(apiKey, existing, count, theme)
  const seen = new Set(existing)
  const accepted: VerifiedCategory[] = []
  const rejected: { categoryId: string; reason: string }[] = []

  for (const cat of candidates) {
    if (seen.has(cat.categoryId)) {
      rejected.push({ categoryId: cat.categoryId, reason: 'categoryId already exists' })
      continue
    }
    const formatIssue = isWellFormed(cat)
    if (formatIssue) {
      rejected.push({ categoryId: cat.categoryId, reason: formatIssue })
      continue
    }
    const { solvable, moveCount } = verifySolvable(cat)
    if (!solvable) {
      rejected.push({ categoryId: cat.categoryId, reason: 'solver could not verify a winnable board' })
      continue
    }
    seen.add(cat.categoryId)
    accepted.push({ ...cat, moveCount })
  }

  return { accepted, rejected }
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
  const existing = await existingCategoryIds()
  const { accepted, rejected } = await verifyCategoryCandidates(apiKey, existing, count)
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

// --- "Auto-generate the next chapter" -------------------------------------------
//
// src/data/chapters.ts pre-declares 3 chapter themes (science-world, history-
// culture, curious-facts) that scripts/generate-levels.ts's PLAN deliberately
// leaves with zero hand-authored levels. When a player finishes the last
// hand-authored chapter, the client calls generateNextChapterNow for the next one
// of these — this fills it in with AI-generated categories, built into a real
// difficulty curve, run through the exact same solver-verified pipeline as every
// other level in the game (see buildChapterLevels below), and stored in the
// public, read-only `aiChapters/{chapterId}` collection so every later player who
// reaches that chapter reuses it instead of regenerating.

const AI_CHAPTERS_COLLECTION = 'aiChapters'

const AI_CHAPTER_IDS = ['science-world', 'history-culture', 'curious-facts'] as const
type AiChapterId = (typeof AI_CHAPTER_IDS)[number]

const CHAPTER_THEME_HINT: Record<AiChapterId, string> = {
  'science-world': '科學世界（天文、物理、化學、生物、地球科學等主題）',
  'history-culture': '歷史文化（歷史事件、古文明、傳統習俗、歷史人物等主題，避免政治敏感或近代爭議內容）',
  'curious-facts': '奇妙知識（趣味冷知識、罕見自然現象、有趣的科學小常識等主題）',
}

/** Same 5-level shape as arts-entertainment in scripts/generate-levels.ts's PLAN —
 * a reasonable single-chapter size that also matches CHAPTER_CATEGORY_POOL_TARGET. */
const CHAPTER_LEVEL_CURVE: Difficulty[] = ['easy', 'easy', 'normal', 'normal', 'hard']
const CHAPTER_CATEGORY_POOL_TARGET = 6
/** How long a 'generating' lock is honored before a retry is allowed to just take
 * over — covers a crashed/killed previous attempt rather than wedging the chapter
 * forever. Not a true distributed lock (a rare double-generate under this window
 * just wastes an OpenAI call, never corrupts anything — last writer wins on the
 * same idempotent doc), which is an acceptable trade for how rarely this fires. */
const GENERATING_LOCK_TIMEOUT_MS = 3 * 60 * 1000

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
    deckSize: shape.deckSize,
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
  const rng = createRng(`ai-chapter-${chapterId}`)
  const poolIds = pool.map((c) => c.id)
  const levels: LevelConfig[] = []
  const unsolvedIds: string[] = []

  CHAPTER_LEVEL_CURVE.forEach((difficulty, index) => {
    const shape = DIFFICULTY_SHAPE[difficulty]
    const categoryCount = Math.min(shape.categoryCount, poolIds.length)
    const categoryIds = shuffle(poolIds, rng).slice(0, categoryCount)
    const categoryWordCounts = varyWordCounts(rng, difficulty, categoryIds)
    const base = buildChapterLevelBase(chapterId, difficulty, index, categoryIds, categoryWordCounts)

    // A tighter budget than the offline script's default (8 attempts x 60000
    // states): this runs inside a live Cloud Function call a player is waiting
    // on, not an offline batch job, so total latency/cost needs a hard ceiling.
    // A level that doesn't solve within budget still ships (see unsolvedIds) —
    // same "log it, don't block" trade-off generateAndVerifyCategories takes.
    const result = generateSolvableLevel(base, pool, words, { maxAttempts: 5, maxStates: 30000 })
    const targets = estimateTargets(totalCardCount(categoryWordCounts))
    if (!result.solvable) unsolvedIds.push(result.config.id)
    levels.push({ ...result.config, ...targets })
  })

  return { levels, unsolvedIds }
}

/** Manual trigger (callable from the client, see src/firebase/aiChapters.ts) for
 * filling in one of the 3 placeholder chapters with AI-generated content. Reuses
 * whatever's already stored if another player generated this chapter first —
 * every player sees the same chapter once it exists, same principle as Daily
 * Challenge's shared-seed determinism, just generated once instead of computed. */
export const generateNextChapterNow = onCall({ secrets: [OPENAI_API_KEY], timeoutSeconds: 300 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in (even anonymously) before requesting new content.')
  }
  const chapterId = String(request.data?.chapterId ?? '')
  if (!(AI_CHAPTER_IDS as readonly string[]).includes(chapterId)) {
    throw new HttpsError('invalid-argument', `Unknown or already-authored chapterId "${chapterId}"`)
  }

  const db = getFirestore()
  const chapterRef = db.collection(AI_CHAPTERS_COLLECTION).doc(chapterId)
  const existingSnap = await chapterRef.get()
  if (existingSnap.exists) {
    const data = existingSnap.data() as { status?: string; levels?: LevelConfig[]; startedAt?: FirebaseFirestore.Timestamp }
    if (data.status === 'ready' && data.levels) {
      logger.info('generateNextChapterNow reused existing chapter', { chapterId, uid: request.auth.uid })
      return { chapterId, levels: data.levels, reused: true }
    }
    if (data.status === 'generating' && Date.now() - (data.startedAt?.toMillis() ?? 0) < GENERATING_LOCK_TIMEOUT_MS) {
      throw new HttpsError('already-exists', 'This chapter is already being generated — try again shortly.')
    }
  }

  await chapterRef.set({ status: 'generating', startedAt: FieldValue.serverTimestamp() })

  try {
    const existing = await existingCategoryIds()
    const { accepted, rejected } = await verifyCategoryCandidates(
      OPENAI_API_KEY.value(),
      existing,
      CHAPTER_CATEGORY_POOL_TARGET,
      CHAPTER_THEME_HINT[chapterId as AiChapterId],
    )
    logger.info('generateNextChapterNow category candidates', { chapterId, acceptedCount: accepted.length, rejected })

    if (accepted.length < DIFFICULTY_SHAPE.hard.categoryCount) {
      throw new Error(
        `only ${accepted.length} categories passed verification, need >= ${DIFFICULTY_SHAPE.hard.categoryCount} for a 'hard' level`,
      )
    }

    await persistAcceptedCategories(accepted)

    const pool: Category[] = accepted.map((cat) => toEngineShape(cat).category)
    const words: WordEntry[] = accepted.flatMap((cat) => toEngineShape(cat).words)
    const { levels, unsolvedIds } = buildChapterLevels(chapterId, pool, words)
    if (unsolvedIds.length > 0) {
      logger.warn('generateNextChapterNow: some levels unverified', { chapterId, unsolvedIds })
    }

    await chapterRef.set({ status: 'ready', levels, readyAt: FieldValue.serverTimestamp() })
    logger.info('generateNextChapterNow done', { chapterId, uid: request.auth.uid, levelCount: levels.length })
    return { chapterId, levels, reused: false }
  } catch (err) {
    await chapterRef.set({ status: 'failed', error: String(err), failedAt: FieldValue.serverTimestamp() })
    logger.error('generateNextChapterNow failed', { chapterId, error: String(err) })
    throw new HttpsError('internal', `Chapter generation failed: ${String(err)}`)
  }
})
