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

/** The maximal run of contiguous, face-up, same-category word cards ending at the column top. */
export function getRunStartIndex(state: GameState, columnIndex: number): number {
  const column = state.columns[columnIndex]
  if (column.length === 0) return -1
  let start = column.length - 1
  const top = column[start]
  if (!top.faceUp || top.cardType !== 'word') return start
  while (start > 0) {
    const prev = column[start - 1]
    if (prev.faceUp && prev.cardType === 'word' && prev.categoryId === top.categoryId) {
      start--
    } else {
      break
    }
  }
  return start
}

export function totalCategoriesInLevel(state: GameState): number {
  return Object.keys(state.categoryMeta).length
}
