// Phase 6 — Daily Challenge. Every day offers one Easy, one Normal, and one Hard
// level, built on the fly (never pre-generated/stored) from a seed derived purely
// from the calendar date plus difficulty. Because createGame is a deterministic
// function of its seed AND its category pool, every player who opens the app on
// the same day gets the exact same table for a given difficulty — which is why
// the pool below is cut off at that day's start (loadAiCategoriesCreatedBefore):
// without the cutoff, a category an AI chapter generates mid-day would silently
// join the pool for players loading afterward but not before.
//
// This category pool is no longer purely offline: with every level now dynamic
// (no more hand-authored src/data/levels.ts), the built-in SEED set alone is too
// thin on its own, so this always merges in the shared AI-generated pool —
// requiring network/Firebase the same way any other chapter does.

import type { Difficulty, LevelConfig } from '../engine/types'
import { CATEGORIES } from './categories'
import { DIFFICULTY_SHAPE, varyWordCounts, totalCardCount, estimateTargets, computeDeckSize } from './difficultyShapes'
import { createRng, shuffle } from '../engine/rng'
import { loadAiCategoriesCreatedBefore } from '../firebase/aiContent'

export const DAILY_DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard']

export function getTodayDateString(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Yesterday's date string relative to `date` (both "YYYY-MM-DD", local calendar days). */
export function previousDateString(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() - 1)
  return getTodayDateString(dt)
}

export async function buildDailyLevelConfig(date: string, difficulty: Difficulty): Promise<LevelConfig> {
  const shape = DIFFICULTY_SHAPE[difficulty]
  const rng = createRng(`daily-${date}-${difficulty}`)
  // Local midnight starting `date` — anything AI-accepted at or after this
  // moment is excluded so the pool is identical for every player all day.
  const [y, m, d] = date.split('-').map(Number)
  const cutoffMs = new Date(y, m - 1, d).getTime()
  const aiPool = await loadAiCategoriesCreatedBefore(cutoffMs)
  const pool = [...CATEGORIES, ...aiPool.categories]
  const categoryIds = shuffle(
    pool.map((c) => c.id),
    rng,
  ).slice(0, shape.categoryCount)

  const categoryWordCounts = varyWordCounts(rng, difficulty, categoryIds)
  const targets = estimateTargets(totalCardCount(categoryWordCounts))

  return {
    id: `daily-${date}-${difficulty}`,
    chapterId: 'daily-challenge',
    difficulty,
    categoryIds,
    columnCount: shape.columnCount,
    categorySlotCount: shape.slotCount,
    deckEnabled: shape.deckEnabled,
    deckSize: computeDeckSize(categoryWordCounts),
    categoryWordCounts,
    ...targets,
    seed: `daily-${date}-${difficulty}`,
  }
}
