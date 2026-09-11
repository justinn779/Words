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

import type { Category, LevelConfig, WordEntry } from '../../src/engine/types'
import { generateSolvableLevel } from '../../src/engine/generator'
import { SEED } from '../../src/data/seed'
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

/** The core pipeline: ask OpenAI for `count` new categories, keep only the ones
 * that are well-formed AND solver-verified, write those to Firestore. Always
 * returns a summary rather than throwing, so a partial success (some rejected) is
 * still useful — callers decide whether that's good enough. */
async function generateAndVerifyCategories(apiKey: string, count: number): Promise<GenerationSummary> {
  const existing = await existingCategoryIds()
  const candidates = await generateCategories(apiKey, existing, count)

  const accepted: VerifiedCategory[] = []
  const rejected: { categoryId: string; reason: string }[] = []

  for (const cat of candidates) {
    if (existing.includes(cat.categoryId)) {
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
    accepted.push({ ...cat, moveCount })
  }

  if (accepted.length > 0) {
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
