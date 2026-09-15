// Read-only helpers shared by moves.ts, the store, hints and the solver.

import type { Card, GameState, Location } from './types'

export interface CardLocation {
  card: Card
  location: Location
  indexInPile: number
}

/** Locates a card anywhere it could legally be picked up from (columns or waste top). */
export function findCard(state: GameState, cardId: string): CardLocation | undefined {
  for (let index = 0; index < state.columns.length; index++) {
    const column = state.columns[index]
    const indexInPile = column.findIndex((c) => c.id === cardId)
    if (indexInPile !== -1) {
      return { card: column[indexInPile], location: { zone: 'column', index }, indexInPile }
    }
  }
  const wasteIndex = state.waste.findIndex((c) => c.id === cardId)
  if (wasteIndex !== -1) {
    return { card: state.waste[wasteIndex], location: { zone: 'waste' }, indexInPile: wasteIndex }
  }
  return undefined
}

export function getPile(state: GameState, location: Location): Card[] {
  if (location.zone === 'column') return state.columns[location.index]
  if (location.zone === 'waste') return state.waste
  return []
}

export function topOf(pile: Card[]): Card | undefined {
  return pile.length > 0 ? pile[pile.length - 1] : undefined
}

/**
 * The start of the maximal contiguous, face-up, same-category word run that
 * contains `fromIndex` — walks backward through same-category neighbors only;
 * whether the run also extends cleanly *up* to the column's physical top
 * (what actually determines if it's movable) is a separate question, left to
 * canMoveStack. Same-category cards are permanently bound together the
 * instant they end up stacked (see game-rules.md) — a card index never picks
 * out just a tail sub-run, only ever the whole bound group it belongs to.
 */
export function getBoundRunStart(state: GameState, columnIndex: number, fromIndex: number): number {
  const column = state.columns[columnIndex]
  if (fromIndex < 0 || fromIndex >= column.length) return fromIndex
  const anchor = column[fromIndex]
  if (!anchor.faceUp || anchor.cardType !== 'word') return fromIndex
  let start = fromIndex
  while (start > 0) {
    const prev = column[start - 1]
    if (prev.faceUp && prev.cardType === 'word' && prev.categoryId === anchor.categoryId) {
      start--
    } else {
      break
    }
  }
  return start
}

/** The maximal run of contiguous, face-up, same-category word cards ending at the column top. */
export function getRunStartIndex(state: GameState, columnIndex: number): number {
  const column = state.columns[columnIndex]
  return getBoundRunStart(state, columnIndex, column.length - 1)
}

export function totalCategoriesInLevel(state: GameState): number {
  return Object.keys(state.categoryMeta).length
}
