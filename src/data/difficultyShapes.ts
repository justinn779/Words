import type { Difficulty } from '../engine/types'
import { shuffle } from '../engine/rng'

export interface DifficultyShape {
  categoryCount: number
  columnCount: number
  slotCount: number
  deckEnabled: boolean
}

// Shared by every runtime level construction path (AI-generated chapters, Daily
// Challenge) so all of them agree on what "easy/normal/hard" means structurally.
// Every difficulty deals a deck; deckSize itself is not a fixed per-difficulty
// constant here — see computeDeckSize below. These numbers are deliberately
// explicit (not derived) per product decision: more distinct categories than
// slots/columns alone would suggest, so same-category runs stay spread out and
// the sorting puzzle stays hard even at 'easy'.
export const DIFFICULTY_SHAPE: Record<Difficulty, DifficultyShape> = {
  easy: { categoryCount: 6, columnCount: 3, slotCount: 2, deckEnabled: true },
  normal: { categoryCount: 10, columnCount: 4, slotCount: 3, deckEnabled: true },
  hard: { categoryCount: 15, columnCount: 5, slotCount: 4, deckEnabled: true },
}

export const WORDS_PER_CATEGORY: Record<Difficulty, number> = { easy: 4, normal: 5, hard: 6 }

/**
 * Picks a varied (not uniform) word count per category — some categories finish in a
 * couple of moves, others linger, which makes the "which category do I free a slot
 * for first" decision (docs/game-design.md) more interesting than a level where
 * every category is the same size.
 *
 * The total is kept sum-preserving (pair up categories and nudge one +1/one -1
 * around the difficulty's WORDS_PER_CATEGORY baseline) rather than sampling each
 * category independently in a wide range. An earlier version did the latter — it
 * looked fine on average but let an unlucky draw push *every* category in a level
 * to the top of its range at once, occasionally producing boards 25-30% bigger
 * than intended. That was enough to make src/engine/solver.ts's DFS blow up during
 * offline generation (see the note on DIFFICULTY_SHAPE.hard). Sum-preservation
 * guarantees the total card count — and so solver cost — never drifts from the
 * uniform baseline, no matter how the per-category variation lands.
 */
export function varyWordCounts(rng: () => number, difficulty: Difficulty, categoryIds: string[]): Record<string, number> {
  const base = WORDS_PER_CATEGORY[difficulty]
  const counts = categoryIds.map(() => base)
  const order = shuffle(
    categoryIds.map((_, i) => i),
    rng,
  )
  const swings = Math.floor(categoryIds.length / 2)
  for (let i = 0; i < swings; i++) {
    counts[order[i]] += 1
    counts[order[categoryIds.length - 1 - i]] -= 1
  }
  return Object.fromEntries(categoryIds.map((id, i) => [id, counts[i]]))
}

/** Total card count (word cards + one Category Card per category) from an actual
 * per-category word-count map — the accurate replacement for cardCountFor() now
 * that counts aren't uniform. */
export function totalCardCount(categoryWordCounts: Record<string, number>): number {
  return Object.values(categoryWordCounts).reduce((sum, n) => sum + n + 1, 0)
}

/**
 * Deck size for a level: half its total card pool, so the deck ends up the
 * same size as the columns it's dealt alongside (createGame.ts splits the
 * shuffled pool deckSize/rest between the two) — a much bigger share of the
 * board hidden in the deck than the old fixed per-difficulty counts (0 for
 * easy, 7 for normal, 9 for hard), by explicit request: with most of the
 * board visible up front, the game had gotten too easy.
 */
export function computeDeckSize(categoryWordCounts: Record<string, number>): number {
  return Math.round(totalCardCount(categoryWordCounts) / 2)
}

/**
 * Star/time thresholds scaled from card count. Loosened twice now — first from
 * 1.3x to 1.5x on the 3-star move ratio, then again here across the board —
 * because DIFFICULTY_SHAPE's category counts (and the bigger deck share before
 * that) kept making boards harder while these ratios stayed put, so 2/3 stars
 * kept getting harder to reach even on an efficient clear. Deliberately not
 * derived from solver move counts — see docs/solver.md for why a plain DFS's
 * move count is a poor "par" estimate.
 */
export function estimateTargets(cardCount: number) {
  return {
    targetThreeStarMoves: Math.round(cardCount * 1.9),
    targetTwoStarMoves: Math.round(cardCount * 2.3),
    targetThreeStarTime: Math.round(cardCount * 8.5),
    targetTwoStarTime: Math.round(cardCount * 12.5),
  }
}
