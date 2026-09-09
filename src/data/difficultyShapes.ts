import type { Difficulty } from '../engine/types'

export interface DifficultyShape {
  categoryCount: number
  columnCount: number
  slotCount: number
  deckEnabled: boolean
  deckSize: number
}

// Shared by the offline level generator (scripts/generate-levels.ts) and any
// runtime level construction (Daily Challenge) so both always agree on what
// "easy/normal/hard" means structurally.
export const DIFFICULTY_SHAPE: Record<Difficulty, DifficultyShape> = {
  easy: { categoryCount: 3, columnCount: 4, slotCount: 2, deckEnabled: false, deckSize: 0 },
  normal: { categoryCount: 4, columnCount: 5, slotCount: 2, deckEnabled: true, deckSize: 6 },
  hard: { categoryCount: 5, columnCount: 6, slotCount: 3, deckEnabled: true, deckSize: 9 },
}

export const WORDS_PER_CATEGORY: Record<Difficulty, number> = { easy: 4, normal: 5, hard: 6 }

export function cardCountFor(difficulty: Difficulty, categoryCount: number): number {
  return categoryCount * (WORDS_PER_CATEGORY[difficulty] + 1)
}

/**
 * Star/time thresholds scaled from card count using the ratios the Phase 1
 * hand-authored levels landed on (~1.3x cards for 3 stars, ~1.8x for 2 stars;
 * ~6.7s/card and ~10s/card). Deliberately not derived from solver move counts —
 * see docs/solver.md for why a plain DFS's move count is a poor "par" estimate.
 */
export function estimateTargets(cardCount: number) {
  return {
    targetThreeStarMoves: Math.round(cardCount * 1.3),
    targetTwoStarMoves: Math.round(cardCount * 1.8),
    targetThreeStarTime: Math.round(cardCount * 6.7),
    targetTwoStarTime: Math.round(cardCount * 10),
  }
}
