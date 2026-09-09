// Phase 6 — Daily Challenge. Every day offers one Easy, one Normal, and one Hard
// level, built on the fly (never pre-generated/stored) from a seed derived purely
// from the calendar date plus difficulty. Because createGame is a deterministic
// function of its seed, every player who opens the app on the same day gets the
// exact same table for a given difficulty — no server coordination required.

import type { Difficulty, LevelConfig } from '../engine/types'
import { CATEGORIES } from './categories'
import { DIFFICULTY_SHAPE, WORDS_PER_CATEGORY, cardCountFor, estimateTargets } from './difficultyShapes'
import { createRng, shuffle } from '../engine/rng'

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

export function buildDailyLevelConfig(date: string, difficulty: Difficulty): LevelConfig {
  const shape = DIFFICULTY_SHAPE[difficulty]
  const rng = createRng(`daily-${date}-${difficulty}`)
  const categoryIds = shuffle(
    CATEGORIES.map((c) => c.id),
    rng,
  ).slice(0, shape.categoryCount)

  const targets = estimateTargets(cardCountFor(difficulty, categoryIds.length))

  return {
    id: `daily-${date}-${difficulty}`,
    chapterId: 'daily-challenge',
    difficulty,
    categoryIds,
    columnCount: shape.columnCount,
    categorySlotCount: shape.slotCount,
    deckEnabled: shape.deckEnabled,
    deckSize: shape.deckSize,
    categoryWordCounts: Object.fromEntries(categoryIds.map((c) => [c, WORDS_PER_CATEGORY[difficulty]])),
    ...targets,
    seed: `daily-${date}-${difficulty}`,
  }
}
