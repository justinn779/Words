import type { Card, GameState, GameStateCore, Location, MoveResult } from './types'
import { findCard, getPile, getRunStartIndex, topOf } from './query'

const MAX_HISTORY = 500

function toCore(state: GameState): GameStateCore {
  const { history: _history, ...core } = state
  // Deep-clone so later mutations on `state` can never leak into a stored snapshot.
  return structuredClone(core)
}

function withHistory(previous: GameState, next: Omit<GameState, 'history'>): GameState {
  const history = [...previous.history, toCore(previous)]
  if (history.length > MAX_HISTORY) history.shift()
  return { ...next, history }
}

/** A card can be picked up only if it is face up and sits on top of its pile. */
export function canMoveCard(state: GameState, cardId: string): boolean {
  const found = findCard(state, cardId)
  if (!found) return false
  const { card, location, indexInPile } = found
  if (!card.faceUp) return false
  const pile = getPile(state, location)
  return indexInPile === pile.length - 1
}

/**
 * A stack move takes every card from `cardIndex` to the column top. All of them must be
 * face-up word cards of the same category — a category card can never be part of a run,
 * and a face-down card can never be dragged along underneath one.
 */
export function canMoveStack(state: GameState, columnIndex: number, cardIndex: number): boolean {
  const column = state.columns[columnIndex]
  if (!column || cardIndex < 0 || cardIndex >= column.length) return false
  const run = column.slice(cardIndex)
  if (run.length === 0) return false
  const categoryId = run[0].categoryId
  return run.every((c) => c.faceUp && c.cardType === 'word' && c.categoryId === categoryId)
}

function canPlaceOnColumn(state: GameState, movingBottomCard: Card, columnIndex: number): boolean {
  const column = state.columns[columnIndex]
  if (column.length === 0) return true
  const top = column[column.length - 1]
  if (!top.faceUp) return false

  if (movingBottomCard.cardType === 'word') {
    // Word -> Word (same category) only. Word can never land on a Category card.
    return top.cardType === 'word' && top.categoryId === movingBottomCard.categoryId
  }
  // Category card -> matching Word/Word-stack only (never onto another Category card).
  return top.cardType === 'word' && top.categoryId === movingBottomCard.categoryId
}

function canPlaceOnSlot(state: GameState, card: Card, slotIndex: number): boolean {
  const slot = state.categorySlots[slotIndex]
  if (card.cardType === 'category') {
    return slot === null
  }
  return slot !== null && slot.categoryId === card.categoryId && slot.collected < slot.required
}

export function canPlaceCardsOn(state: GameState, movingCards: Card[], destination: Location): boolean {
  if (movingCards.length === 0) return false
  const bottom = movingCards[0]
  if (destination.zone === 'waste') return false
  if (destination.zone === 'slot') {
    return movingCards.length === 1 && canPlaceOnSlot(state, bottom, destination.index)
  }
  return canPlaceOnColumn(state, bottom, destination.index)
}

/** Flips the new top card of a column face-up if it is currently face-down. No-op otherwise. */
export function flipTopCard(state: GameState, columnIndex: number): GameState {
  const column = state.columns[columnIndex]
  const top = topOf(column)
  if (!top || top.faceUp) return state
  const columns = state.columns.slice()
  columns[columnIndex] = [...column.slice(0, -1), { ...top, faceUp: true }]
  return { ...state, columns }
}

function removeFromSource(state: GameState, location: Location, count: number): GameState {
  if (location.zone === 'column') {
    const columns = state.columns.slice()
    columns[location.index] = columns[location.index].slice(0, -count)
    return { ...state, columns }
  }
  return { ...state, waste: state.waste.slice(0, -count) }
}

function appendToColumn(state: GameState, columnIndex: number, cards: Card[]): GameState {
  const columns = state.columns.slice()
  columns[columnIndex] = [...columns[columnIndex], ...cards]
  return { ...state, columns }
}

/** Category-card-specific move: park it on a matching word stack/empty column, or activate a slot. */
export function moveCategoryCard(state: GameState, cardId: string, destination: Location): MoveResult {
  const found = findCard(state, cardId)
  if (!found || found.card.cardType !== 'category') {
    return { success: false, state, reason: 'not-a-category-card' }
  }
  if (!canMoveCard(state, cardId)) return { success: false, state, reason: 'card-not-movable' }
  const { card, location } = found
  if (!canPlaceCardsOn(state, [card], destination)) {
    return { success: false, state, reason: 'illegal-destination' }
  }

  let next = removeFromSource(state, location, 1)

  if (destination.zone === 'slot') {
    const meta = state.categoryMeta[card.categoryId]
    const slots = next.categorySlots.slice()
    slots[destination.index] = {
      slotIndex: destination.index,
      categoryId: card.categoryId,
      name: meta.name,
      collected: 0,
      required: meta.required,
    }
    next = { ...next, categorySlots: slots }
  } else if (destination.zone === 'column') {
    next = appendToColumn(next, destination.index, [card])
  }

  if (location.zone === 'column') next = flipTopCard(next, location.index)

  const finalState = withHistory(state, { ...next, moves: state.moves + 1 })
  return { success: true, state: finalState }
}

/** Word-card-specific move: land on a matching word/stack, an empty column, or an active slot. */
export function moveToCategorySlot(state: GameState, cardId: string, slotIndex: number): MoveResult {
  const found = findCard(state, cardId)
  if (!found || found.card.cardType !== 'word') return { success: false, state, reason: 'not-a-word-card' }
  if (!canMoveCard(state, cardId)) return { success: false, state, reason: 'card-not-movable' }
  const { card, location } = found
  const destination: Location = { zone: 'slot', index: slotIndex }
  if (!canPlaceCardsOn(state, [card], destination)) {
    return { success: false, state, reason: 'illegal-destination' }
  }

  let next = removeFromSource(state, location, 1)
  const slot = next.categorySlots[slotIndex]!
  const collected = slot.collected + 1
  const slots = next.categorySlots.slice()
  slots[slotIndex] = { ...slot, collected }
  next = { ...next, categorySlots: slots }

  if (location.zone === 'column') next = flipTopCard(next, location.index)

  if (collected >= slot.required) {
    next = completeCategory(next, slotIndex)
  }

  const finalState = withHistory(state, { ...next, moves: state.moves + 1 })
  return { success: true, state: finalState }
}

/** Finalizes a category once its slot has collected every required word. Frees the slot. */
export function completeCategory(state: GameState, slotIndex: number): GameState {
  const slot = state.categorySlots[slotIndex]
  if (!slot) return state
  const slots = state.categorySlots.slice()
  slots[slotIndex] = null
  return {
    ...state,
    categorySlots: slots,
    completedCategories: [...state.completedCategories, slot.categoryId],
  }
}

/**
 * Universal single-card move entry point used by the UI. Dispatches to the
 * category- or slot-specific logic as needed.
 */
export function moveCard(state: GameState, cardId: string, destination: Location): MoveResult {
  const found = findCard(state, cardId)
  if (!found) return { success: false, state, reason: 'card-not-found' }

  if (found.card.cardType === 'category') {
    return moveCategoryCard(state, cardId, destination)
  }
  if (destination.zone === 'slot') {
    return moveToCategorySlot(state, cardId, destination.index)
  }
  if (destination.zone !== 'column') {
    return { success: false, state, reason: 'illegal-destination' }
  }

  if (!canMoveCard(state, cardId)) return { success: false, state, reason: 'card-not-movable' }
  const { card, location } = found
  if (!canPlaceCardsOn(state, [card], destination)) {
    return { success: false, state, reason: 'illegal-destination' }
  }

  let next = removeFromSource(state, location, 1)
  next = appendToColumn(next, destination.index, [card])
  if (location.zone === 'column') next = flipTopCard(next, location.index)

  const finalState = withHistory(state, { ...next, moves: state.moves + 1 })
  return { success: true, state: finalState }
}

/** Moves a whole same-category run of word cards from one column to another (or to empty space). */
export function moveStack(
  state: GameState,
  columnIndex: number,
  cardIndex: number,
  destination: Location,
): MoveResult {
  if (destination.zone !== 'column') {
    return { success: false, state, reason: 'stacks-can-only-target-columns' }
  }
  if (!canMoveStack(state, columnIndex, cardIndex)) {
    return { success: false, state, reason: 'not-a-movable-stack' }
  }
  const column = state.columns[columnIndex]
  const run = column.slice(cardIndex)
  if (!canPlaceCardsOn(state, run, destination)) {
    return { success: false, state, reason: 'illegal-destination' }
  }

  let next = removeFromSource(state, { zone: 'column', index: columnIndex }, run.length)
  next = appendToColumn(next, destination.index, run)
  next = flipTopCard(next, columnIndex)

  const finalState = withHistory(state, { ...next, moves: state.moves + 1 })
  return { success: true, state: finalState }
}

/** Draws the top deck card face-up onto the waste pile. No-op if the deck is empty. */
export function drawDeckCard(state: GameState): GameState {
  if (state.deck.length === 0) return state
  const deck = state.deck.slice()
  const drawn = { ...deck.pop()!, faceUp: true }
  const next = { ...state, deck, waste: [...state.waste, drawn] }
  return withHistory(state, { ...next, moves: state.moves + 1 })
}

/** Recycles the waste pile back into the deck, face-down, preserving future draw order. */
export function recycleDeck(state: GameState): GameState {
  if (state.deck.length > 0 || state.waste.length === 0) return state
  const deck = state.waste
    .slice()
    .reverse()
    .map((c) => ({ ...c, faceUp: false }))
  const next = { ...state, deck, waste: [] }
  return withHistory(state, next)
}

/** Restores the most recent snapshot, if any. No-op at the start of history. */
export function undo(state: GameState): GameState {
  if (state.history.length === 0) return state
  const history = state.history.slice()
  const previous = history.pop()!
  return { ...previous, history }
}

export { getRunStartIndex }
