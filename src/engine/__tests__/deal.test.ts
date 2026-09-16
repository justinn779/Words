import { describe, expect, it } from 'vitest'
import { countUnburiedCategories, isLikelyWinnable, dealUntilLikelyWinnable } from '../deal'
import { CATEGORIES } from '../../data/categories'
import { WORDS } from '../../data/words'
import type { Card, GameState, LevelConfig } from '../types'

function fakeCard(id: string, categoryId: string): Card {
  return { id, cardType: 'word', wordId: id, text: id, categoryId, faceUp: false }
}

function fakeState(columns: Card[][], categoryIds: string[]): GameState {
  return {
    levelId: 'test',
    difficulty: 'easy',
    columns,
    deck: [],
    waste: [],
    categorySlots: [],
    completedCategories: [],
    categoryMeta: Object.fromEntries(categoryIds.map((id) => [id, { name: id, required: 1 }])),
    moves: 0,
    startedAt: 0,
    coinsSpent: 0,
    hintsUsed: 0,
    status: 'playing',
    history: [],
  }
}

describe('countUnburiedCategories', () => {
  it('counts a category as unburied when its only card is a column top', () => {
    const state = fakeState([[fakeCard('a1', 'a')], [fakeCard('b1', 'b')]], ['a', 'b'])
    expect(countUnburiedCategories(state)).toBe(2)
  })

  it('counts a category as buried once one of its cards sits under another in a column', () => {
    const state = fakeState([[fakeCard('a1', 'a'), fakeCard('a2', 'a')], [fakeCard('b1', 'b')]], ['a', 'b'])
    // a1 is under a2 in the same column -> category 'a' is buried; 'b' is not.
    expect(countUnburiedCategories(state)).toBe(1)
  })

  it('a category with a card buried under a DIFFERENT category is still buried', () => {
    const state = fakeState([[fakeCard('a1', 'a'), fakeCard('b1', 'b')]], ['a', 'b'])
    expect(countUnburiedCategories(state)).toBe(1) // only 'b' (the top card) is unburied
  })
})

describe('isLikelyWinnable', () => {
  // columnCount + categorySlotCount = 2, matching the 2 categories below exactly
  // -> passes only when BOTH are unburied.
  const config: LevelConfig = {
    id: 'test',
    chapterId: 'test',
    difficulty: 'easy',
    categoryIds: ['a', 'b'],
    columnCount: 1,
    categorySlotCount: 1,
    deckEnabled: false,
    deckSize: 0,
    targetThreeStarMoves: 1,
    targetTwoStarMoves: 1,
    targetThreeStarTime: 1,
    targetTwoStarTime: 1,
  }

  it('passes once every needed category is unburied', () => {
    const state = fakeState([[fakeCard('a1', 'a')], [fakeCard('b1', 'b')]], ['a', 'b'])
    expect(isLikelyWinnable(state, config)).toBe(true)
  })

  it('fails when a needed category is buried', () => {
    const state = fakeState([[fakeCard('a1', 'a'), fakeCard('a2', 'a')], [fakeCard('b1', 'b')]], ['a', 'b'])
    expect(isLikelyWinnable(state, config)).toBe(false)
  })
})

describe('dealUntilLikelyWinnable', () => {
  const level: LevelConfig = {
    id: 'test-deal',
    chapterId: 'test',
    difficulty: 'easy',
    categoryIds: ['fruit', 'animal', 'instrument'],
    columnCount: 3,
    categorySlotCount: 2,
    deckEnabled: true,
    deckSize: 8,
    categoryWordCounts: { fruit: 4, animal: 4, instrument: 4 },
    targetThreeStarMoves: 10,
    targetTwoStarMoves: 20,
    targetThreeStarTime: 60,
    targetTwoStarTime: 120,
  }

  it('returns a real dealt GameState with every card accounted for', () => {
    const state = dealUntilLikelyWinnable(level, CATEGORIES, WORDS)
    const allCards = [...state.columns.flat(), ...state.deck, ...state.waste]
    expect(allCards).toHaveLength(15) // 3 categories * (4 words + 1 category card)
  })

  it('deals a different layout on each call, even for the same level id and seed', () => {
    const a = dealUntilLikelyWinnable({ ...level, seed: 'fixed' }, CATEGORIES, WORDS)
    const b = dealUntilLikelyWinnable({ ...level, seed: 'fixed' }, CATEGORIES, WORDS)
    expect(a.columns.map((c) => c.map((x) => x.id))).not.toEqual(b.columns.map((c) => c.map((x) => x.id)))
  })
})
