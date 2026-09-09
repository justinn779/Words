import { describe, expect, it } from 'vitest'
import { createGame } from '../createGame'
import { CATEGORIES } from '../../data/categories'
import { WORDS } from '../../data/words'
import type { LevelConfig } from '../types'

const baseConfig: LevelConfig = {
  id: 'test-1',
  chapterId: 'test',
  difficulty: 'easy',
  categoryIds: ['fruit', 'animal'],
  columnCount: 4,
  categorySlotCount: 2,
  deckEnabled: false,
  deckSize: 0,
  categoryWordCounts: { fruit: 4, animal: 4 },
  targetThreeStarMoves: 10,
  targetTwoStarMoves: 20,
  targetThreeStarTime: 60,
  targetTwoStarTime: 120,
  seed: 'fixed-seed',
}

describe('createGame', () => {
  it('deals every card from the selected categories exactly once', () => {
    const state = createGame(baseConfig, CATEGORIES, WORDS)
    const allCards = [...state.columns.flat(), ...state.deck, ...state.waste]
    // 2 categories * (4 words + 1 category card) = 10
    expect(allCards).toHaveLength(10)
    const ids = new Set(allCards.map((c) => c.id))
    expect(ids.size).toBe(10)
  })

  it('deals into the configured number of columns', () => {
    const state = createGame(baseConfig, CATEGORIES, WORDS)
    expect(state.columns).toHaveLength(4)
  })

  it('only the top card of each column is face up', () => {
    const state = createGame(baseConfig, CATEGORIES, WORDS)
    for (const column of state.columns) {
      column.forEach((card, i) => {
        expect(card.faceUp).toBe(i === column.length - 1)
      })
    }
  })

  it('puts overflow cards face-down in the deck when deckEnabled', () => {
    const config: LevelConfig = { ...baseConfig, deckEnabled: true, deckSize: 3 }
    const state = createGame(config, CATEGORIES, WORDS)
    expect(state.deck).toHaveLength(3)
    expect(state.deck.every((c) => !c.faceUp)).toBe(true)
  })

  it('is deterministic for a fixed seed', () => {
    const a = createGame(baseConfig, CATEGORIES, WORDS)
    const b = createGame(baseConfig, CATEGORIES, WORDS)
    expect(a.columns.map((c) => c.map((x) => x.id))).toEqual(b.columns.map((c) => c.map((x) => x.id)))
  })

  it('produces different layouts for different seeds', () => {
    const a = createGame(baseConfig, CATEGORIES, WORDS)
    const b = createGame({ ...baseConfig, seed: 'another-seed' }, CATEGORIES, WORDS)
    expect(a.columns.map((c) => c.map((x) => x.id))).not.toEqual(b.columns.map((c) => c.map((x) => x.id)))
  })
})
