import { describe, expect, it } from 'vitest'
import type { Card, CategoryCard, GameState, WordCard } from '../types'
import {
  canMoveCard,
  canMoveStack,
  moveCard,
  moveStack,
  flipTopCard,
  drawDeckCard,
  recycleDeck,
  undo,
} from '../moves'
import { checkWin, calculateScore } from '../win'
import type { LevelConfig } from '../types'

function word(categoryId: string, id: string, faceUp = true): WordCard {
  return { id: `word-${categoryId}-${id}`, cardType: 'word', wordId: id, text: id, categoryId, faceUp }
}

function categoryCard(categoryId: string, required: number, faceUp = true): CategoryCard {
  return { id: `cat-${categoryId}`, cardType: 'category', categoryId, name: categoryId, requiredWordCount: required, faceUp }
}

function makeState(columns: Card[][], overrides: Partial<GameState> = {}): GameState {
  return {
    levelId: 'test',
    difficulty: 'easy',
    columns,
    deck: [],
    waste: [],
    categorySlots: [null, null],
    completedCategories: [],
    categoryMeta: { fruit: { name: '水果', required: 2 }, animal: { name: '動物', required: 2 } },
    moves: 0,
    startedAt: 0,
    coinsSpent: 0,
    hintsUsed: 0,
    status: 'playing',
    history: [],
    ...overrides,
  }
}

describe('canMoveCard', () => {
  it('allows only the face-up top of a column', () => {
    const state = makeState([[word('fruit', 'apple', false), word('fruit', 'banana', true)]])
    expect(canMoveCard(state, 'word-fruit-apple')).toBe(false)
    expect(canMoveCard(state, 'word-fruit-banana')).toBe(true)
  })
})

describe('moveCard — word stacking', () => {
  it('allows placing a word on a same-category word', () => {
    const state = makeState([[word('fruit', 'apple')], [word('fruit', 'banana')]])
    const result = moveCard(state, 'word-fruit-banana', { zone: 'column', index: 0 })
    expect(result.success).toBe(true)
    expect(result.state.columns[0].map((c) => c.id)).toEqual(['word-fruit-apple', 'word-fruit-banana'])
    expect(result.state.columns[1]).toHaveLength(0)
  })

  it('blocks placing a word on a different-category word', () => {
    const state = makeState([[word('fruit', 'apple')], [word('animal', 'dog')]])
    const result = moveCard(state, 'word-animal-dog', { zone: 'column', index: 0 })
    expect(result.success).toBe(false)
  })

  it('blocks a word from ever landing on a category card', () => {
    const state = makeState([[categoryCard('fruit', 2)], [word('fruit', 'apple')]])
    const result = moveCard(state, 'word-fruit-apple', { zone: 'column', index: 0 })
    expect(result.success).toBe(false)
  })

  it('allows an empty column to receive any single card', () => {
    const state = makeState([[], [word('fruit', 'apple')]])
    const result = moveCard(state, 'word-fruit-apple', { zone: 'column', index: 0 })
    expect(result.success).toBe(true)
  })
})

describe('moveCard — category card asymmetric rule', () => {
  it('allows a category card onto a matching word/stack', () => {
    const state = makeState([[word('fruit', 'apple')], [categoryCard('fruit', 2)]])
    const result = moveCard(state, 'cat-fruit', { zone: 'column', index: 0 })
    expect(result.success).toBe(true)
    expect(result.state.columns[0].map((c) => c.id)).toEqual(['word-fruit-apple', 'cat-fruit'])
  })

  it('blocks a category card from landing on a mismatched category', () => {
    const state = makeState([[word('animal', 'dog')], [categoryCard('fruit', 2)]])
    const result = moveCard(state, 'cat-fruit', { zone: 'column', index: 0 })
    expect(result.success).toBe(false)
  })

  it('blocks a category card from landing on another category card', () => {
    const state = makeState([[categoryCard('animal', 2)], [categoryCard('fruit', 2)]])
    const result = moveCard(state, 'cat-fruit', { zone: 'column', index: 0 })
    expect(result.success).toBe(false)
  })
})

describe('category slot activation and completion', () => {
  it('activates an empty slot with a category card, starting at 0 collected', () => {
    const state = makeState([[categoryCard('fruit', 2)]])
    const result = moveCard(state, 'cat-fruit', { zone: 'slot', index: 0 })
    expect(result.success).toBe(true)
    expect(result.state.categorySlots[0]).toEqual({
      slotIndex: 0,
      categoryId: 'fruit',
      name: '水果',
      collected: 0,
      required: 2,
    })
  })

  it('rejects activating an already-occupied slot', () => {
    const state = makeState([[categoryCard('fruit', 2)], [categoryCard('animal', 2)]], {
      categorySlots: [{ slotIndex: 0, categoryId: 'animal', name: '動物', collected: 0, required: 2 }, null],
    })
    const result = moveCard(state, 'cat-fruit', { zone: 'slot', index: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects sending a word to a slot for the wrong category', () => {
    const state = makeState([[word('animal', 'dog')]], {
      categorySlots: [{ slotIndex: 0, categoryId: 'fruit', name: '水果', collected: 0, required: 2 }, null],
    })
    const result = moveCard(state, 'word-animal-dog', { zone: 'slot', index: 0 })
    expect(result.success).toBe(false)
  })

  it('completes and frees the slot once the required count is reached', () => {
    let state = makeState([[word('fruit', 'apple')], [word('fruit', 'banana')]], {
      categorySlots: [{ slotIndex: 0, categoryId: 'fruit', name: '水果', collected: 1, required: 2 }, null],
    })
    const result = moveCard(state, 'word-fruit-apple', { zone: 'slot', index: 0 })
    expect(result.success).toBe(true)
    state = result.state
    expect(state.categorySlots[0]).toBeNull()
    expect(state.completedCategories).toEqual(['fruit'])
  })
})

describe('flipping', () => {
  it('flips the newly exposed top card after a move empties above it', () => {
    const state = makeState([[word('fruit', 'apple', false), word('fruit', 'banana', true)], []])
    const result = moveCard(state, 'word-fruit-banana', { zone: 'column', index: 1 })
    expect(result.success).toBe(true)
    expect(result.state.columns[0][0].faceUp).toBe(true)
  })

  it('flipTopCard is a no-op when the top is already face up or the column is empty', () => {
    const state = makeState([[word('fruit', 'apple', true)], []])
    expect(flipTopCard(state, 0)).toBe(state)
    expect(flipTopCard(state, 1)).toBe(state)
  })
})

describe('stacks', () => {
  it('recognizes and moves a contiguous same-category run together', () => {
    const state = makeState([[word('fruit', 'apple'), word('fruit', 'banana')], []])
    expect(canMoveStack(state, 0, 0)).toBe(true)
    const result = moveStack(state, 0, 0, { zone: 'column', index: 1 })
    expect(result.success).toBe(true)
    expect(result.state.columns[1].map((c) => c.id)).toEqual(['word-fruit-apple', 'word-fruit-banana'])
    expect(result.state.columns[0]).toHaveLength(0)
  })

  it('does not include a face-down card underneath the run', () => {
    const state = makeState([[word('fruit', 'apple', false), word('fruit', 'banana', true)]])
    expect(canMoveStack(state, 0, 0)).toBe(false)
    expect(canMoveStack(state, 0, 1)).toBe(true)
  })

  it('rejects a run that mixes categories', () => {
    const state = makeState([[word('animal', 'dog', true), word('fruit', 'apple', true)]])
    expect(canMoveStack(state, 0, 0)).toBe(false)
  })

  it('delivers a whole same-category run into its active slot in one move', () => {
    const state = makeState([[word('fruit', 'apple'), word('fruit', 'banana')]], {
      categorySlots: [{ slotIndex: 0, categoryId: 'fruit', name: '水果', collected: 0, required: 4 }, null],
    })
    const result = moveStack(state, 0, 0, { zone: 'slot', index: 0 })
    expect(result.success).toBe(true)
    expect(result.state.columns[0]).toHaveLength(0)
    expect(result.state.categorySlots[0]?.collected).toBe(2)
    expect(result.state.moves).toBe(1)
  })

  it('completes and frees the slot when a run finishes it', () => {
    const state = makeState([[word('fruit', 'apple'), word('fruit', 'banana')]], {
      categorySlots: [{ slotIndex: 0, categoryId: 'fruit', name: '水果', collected: 2, required: 4 }, null],
    })
    const result = moveStack(state, 0, 0, { zone: 'slot', index: 0 })
    expect(result.success).toBe(true)
    expect(result.state.categorySlots[0]).toBeNull()
    expect(result.state.completedCategories).toContain('fruit')
  })

  it('rejects a run that would overflow the slot capacity', () => {
    const state = makeState([[word('fruit', 'apple'), word('fruit', 'banana')]], {
      categorySlots: [{ slotIndex: 0, categoryId: 'fruit', name: '水果', collected: 3, required: 4 }, null],
    })
    const result = moveStack(state, 0, 0, { zone: 'slot', index: 0 })
    expect(result.success).toBe(false)
    expect(result.state.columns[0]).toHaveLength(2)
  })

  it('rejects a run whose category does not match the slot', () => {
    const state = makeState([[word('animal', 'cat'), word('animal', 'dog')]], {
      categorySlots: [{ slotIndex: 0, categoryId: 'fruit', name: '水果', collected: 0, required: 4 }, null],
    })
    const result = moveStack(state, 0, 0, { zone: 'slot', index: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects a run sent to an inactive (empty) slot', () => {
    const state = makeState([[word('fruit', 'apple'), word('fruit', 'banana')]], {
      categorySlots: [null, null],
    })
    const result = moveStack(state, 0, 0, { zone: 'slot', index: 0 })
    expect(result.success).toBe(false)
  })
})

describe('deck and waste', () => {
  it('draws the top deck card face-up onto waste', () => {
    const state = makeState([[]], { deck: [word('fruit', 'apple', false), word('fruit', 'banana', false)] })
    const next = drawDeckCard(state)
    expect(next.deck).toHaveLength(1)
    expect(next.waste).toHaveLength(1)
    expect(next.waste[0].faceUp).toBe(true)
    expect(next.waste[0].id).toBe('word-fruit-banana')
  })

  it('is a no-op when the deck is empty', () => {
    const state = makeState([[]], { deck: [] })
    expect(drawDeckCard(state)).toBe(state)
  })

  it('recycles waste back into the deck face-down once the deck is empty', () => {
    const state = makeState([[]], {
      deck: [],
      waste: [word('fruit', 'apple', true), word('fruit', 'banana', true)],
    })
    const next = recycleDeck(state)
    expect(next.waste).toHaveLength(0)
    expect(next.deck).toHaveLength(2)
    expect(next.deck.every((c) => !c.faceUp)).toBe(true)
  })

  it('a word can be moved off the top of waste', () => {
    const state = makeState([[word('fruit', 'apple')]], { waste: [word('fruit', 'banana')] })
    const result = moveCard(state, 'word-fruit-banana', { zone: 'column', index: 0 })
    expect(result.success).toBe(true)
    expect(result.state.waste).toHaveLength(0)
  })
})

describe('undo', () => {
  it('restores the exact prior state after a card move', () => {
    const state = makeState([[word('fruit', 'apple')], [word('fruit', 'banana')]])
    const moved = moveCard(state, 'word-fruit-banana', { zone: 'column', index: 0 }).state
    const restored = undo(moved)
    expect(restored.columns).toEqual(state.columns)
    expect(restored.moves).toBe(state.moves)
    expect(restored.history).toHaveLength(0)
  })

  it('restores category completion (slot state and completedCategories)', () => {
    const state = makeState([[word('fruit', 'apple')]], {
      categorySlots: [{ slotIndex: 0, categoryId: 'fruit', name: '水果', collected: 1, required: 2 }, null],
    })
    const moved = moveCard(state, 'word-fruit-apple', { zone: 'slot', index: 0 }).state
    expect(moved.completedCategories).toEqual(['fruit'])
    const restored = undo(moved)
    expect(restored.completedCategories).toEqual([])
    expect(restored.categorySlots[0]?.collected).toBe(1)
  })

  it('is a no-op with no history', () => {
    const state = makeState([[]])
    expect(undo(state)).toBe(state)
  })
})

describe('checkWin / calculateScore', () => {
  const config: LevelConfig = {
    id: 't',
    chapterId: 'c',
    difficulty: 'easy',
    categoryIds: ['fruit', 'animal'],
    columnCount: 2,
    categorySlotCount: 2,
    deckEnabled: false,
    deckSize: 0,
    targetThreeStarMoves: 5,
    targetTwoStarMoves: 10,
    targetThreeStarTime: 60,
    targetTwoStarTime: 120,
  }

  it('is not won until every category in the level is completed', () => {
    const state = makeState([[]], { completedCategories: ['fruit'] })
    expect(checkWin(state)).toBe(false)
  })

  it('is won once all categories are completed', () => {
    const state = makeState([[]], { completedCategories: ['fruit', 'animal'] })
    expect(checkWin(state)).toBe(true)
  })

  it('awards 3 stars for a fast, low-move win and 1 star for a slow one', () => {
    const fast = makeState([[]], { completedCategories: ['fruit', 'animal'], moves: 4 })
    expect(calculateScore(fast, config, 30_000).stars).toBe(3)

    const slow = makeState([[]], { completedCategories: ['fruit', 'animal'], moves: 40 })
    expect(calculateScore(slow, config, 500_000).stars).toBe(1)
  })

  it('reports the moves and time sub-ratings, and caps stars at the lower one', () => {
    // Perfect moves (<=5), but slow enough to be a 2-star time (60 < 90 <= 120).
    const state = makeState([[]], { completedCategories: ['fruit', 'animal'], moves: 3 })
    const score = calculateScore(state, config, 90_000)
    expect(score.moveStars).toBe(3)
    expect(score.timeStars).toBe(2)
    expect(score.stars).toBe(2)
  })

  it('awards 0 stars and no coins for an unfinished game', () => {
    const state = makeState([[]], { completedCategories: ['fruit'] })
    const score = calculateScore(state, config, 10_000)
    expect(score.stars).toBe(0)
    expect(score.coinsEarned).toBe(0)
  })
})
