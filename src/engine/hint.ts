import type { AvailableMove, Card, GameState, HintResult, Location } from './types'
import { canPlaceCardsOn } from './moves'
import { getRunStartIndex, topOf } from './query'

/**
 * Enumerates every legal move currently available: single-card moves, partial/whole
 * stack moves, category-slot activations, word-to-slot placements, and deck actions.
 * Used by the store (to validate drops), the hint system, and the solver.
 */
export function getAvailableMoves(state: GameState): AvailableMove[] {
  const moves: AvailableMove[] = []

  const tryDestinations = (cards: Card[], from: Location, stackStartIndex?: number) => {
    const bottom = cards[0]
    for (let c = 0; c < state.columns.length; c++) {
      if (from.zone === 'column' && from.index === c) continue
      const to: Location = { zone: 'column', index: c }
      if (canPlaceCardsOn(state, cards, to)) {
        moves.push({
          kind: cards.length > 1 ? 'stack' : 'card',
          cardId: bottom.id,
          from,
          stackStartIndex,
          to,
        })
      }
    }
    if (cards.length === 1) {
      for (let s = 0; s < state.categorySlots.length; s++) {
        const to: Location = { zone: 'slot', index: s }
        if (canPlaceCardsOn(state, cards, to)) {
          moves.push({
            kind: bottom.cardType === 'category' ? 'categoryActivate' : 'wordToSlot',
            cardId: bottom.id,
            from,
            to,
          })
        }
      }
    }
  }

  for (let columnIndex = 0; columnIndex < state.columns.length; columnIndex++) {
    const column = state.columns[columnIndex]
    if (column.length === 0) continue
    const runStart = getRunStartIndex(state, columnIndex)
    for (let start = runStart; start < column.length; start++) {
      const run = column.slice(start)
      tryDestinations(run, { zone: 'column', index: columnIndex }, start)
    }
  }

  const wasteTop = topOf(state.waste)
  if (wasteTop) {
    tryDestinations([wasteTop], { zone: 'waste' })
  }

  if (state.deck.length > 0) {
    moves.push({ kind: 'draw' })
  } else if (state.waste.length > 0) {
    moves.push({ kind: 'recycle' })
  }

  return moves
}

const PRIORITY: Record<string, number> = {
  wordToSlot: 0,
  categoryActivate: 1,
  card: 2,
  stack: 3,
  draw: 4,
  recycle: 5,
}

/**
 * Hint level 1: highlights a safe card to move (no destination shown).
 * Hint level 2: also reveals where it should go.
 */
export function getHint(state: GameState, level: 1 | 2): HintResult | null {
  const moves = getAvailableMoves(state)
    .filter((m) => m.cardId)
    .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind])

  const best = moves[0]
  if (!best || !best.cardId) return null

  return {
    cardId: best.cardId,
    from: best.from,
    to: level === 2 ? best.to : undefined,
    level,
  }
}
