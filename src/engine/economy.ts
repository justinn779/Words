import type { GameState } from './types'

export const HINT_LEVEL_1_COST = 10
export const HINT_LEVEL_2_COST = 25
export const UNDO_COST = 10

/**
 * Bookkeeping only — does not touch the undo history. A hint or undo purchase is a
 * sunk wallet cost; unwinding the board afterward should not refund it.
 */
export function recordHintUsed(state: GameState, coinCost: number): GameState {
  return { ...state, hintsUsed: state.hintsUsed + 1, coinsSpent: state.coinsSpent + coinCost }
}

export function recordCoinsSpent(state: GameState, coinCost: number): GameState {
  return { ...state, coinsSpent: state.coinsSpent + coinCost }
}
