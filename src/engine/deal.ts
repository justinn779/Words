// Runtime dealing for a regular (non-Daily-Challenge) level: instead of a level
// being pinned to one solver-verified seed forever (the old design — see git
// history), the same fixed card pool (categoryIds/categoryWordCounts) gets freshly
// reshuffled every time a player enters or replays the level. A cheap, instant
// check (isLikelyWinnable below) stands in for running the actual DFS solver —
// by design: this game never chases perfect solvability guarantees at the cost of
// gameplay or generation cost (see functions/src/index.ts's chapter-generation
// comments), and reshuffling a bad deal is free, so there's no need to prove any
// one deal correct — just keep redealing until a reasonable one turns up.

import type { Category, GameState, LevelConfig, WordEntry } from './types'
import { createGame } from './createGame'

/** A category counts as "unburied" if none of its cards (word cards or its own
 * Category Card) are sitting face-down under another card in some column —
 * i.e. every card it has in the tableau is that column's own top card, and the
 * rest of its cards are in the deck. Cheap to check (O(cards)) and, per
 * product decision, a good enough proxy for "this deal is worth playing" — see
 * dealUntilLikelyWinnable below, which reshuffles instead of trusting one deal. */
export function countUnburiedCategories(state: GameState): number {
  const categoryIds = Object.keys(state.categoryMeta)
  let count = 0
  for (const categoryId of categoryIds) {
    const buried = state.columns.some((column) => column.some((card, i) => card.categoryId === categoryId && i !== column.length - 1))
    if (!buried) count++
  }
  return count
}

/** The deal is "likely winnable" once at least (columns + slots) categories are
 * fully unburied — enough immediately-workable material to make real progress
 * without needing to dig through mismatched cards first. */
export function isLikelyWinnable(state: GameState, config: LevelConfig): boolean {
  return countUnburiedCategories(state) >= config.columnCount + config.categorySlotCount
}

const MAX_DEAL_ATTEMPTS = 30

/**
 * Deals `config`'s fixed card pool with a freshly-random seed — never the same
 * layout twice, even for the same level — retrying (still randomly, still free)
 * until isLikelyWinnable passes or MAX_DEAL_ATTEMPTS is exhausted, in which case
 * the last attempt is used anyway (never blocks the player from starting the
 * level; the "❗ 回報無解" flow is the safety net for the rare case that still
 * turns out to be a dead end).
 */
export function dealUntilLikelyWinnable(config: LevelConfig, categories: Category[], words: WordEntry[]): GameState {
  let last: GameState | null = null
  for (let attempt = 0; attempt < MAX_DEAL_ATTEMPTS; attempt++) {
    const seed = `${config.id}-deal-${Date.now()}-${Math.random()}-${attempt}`
    const state = createGame({ ...config, seed }, categories, words)
    last = state
    if (isLikelyWinnable(state, config)) return state
  }
  return last!
}
