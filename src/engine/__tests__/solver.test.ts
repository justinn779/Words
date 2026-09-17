import { describe, expect, it } from 'vitest'
import { createGame } from '../createGame'
import { generateSolvableLevel, type LevelConfigWithoutSeed } from '../generator'
import { getAvailableMoves, getHint } from '../hint'
import { CATEGORIES } from '../../data/categories'
import { WORDS } from '../../data/words'
import { estimateTargets, totalCardCount } from '../../data/difficultyShapes'

// A small, fixed, no-deck fixture — deliberately decoupled from
// DIFFICULTY_SHAPE's real easy/normal/hard numbers, which are large enough now
// (see src/data/difficultyShapes.ts) that a plain DFS can take tens of seconds
// per attempt and isn't guaranteed to find a solution at all — that's expected
// and accepted for real generated content (see functions/src/index.ts's
// fillShortfallFromExistingPool and the player-facing "❗ 回報無解" report flow),
// not something these engine-level sanity checks should depend on. This fixture
// only needs to be small enough to solve fast and reliably.
const TEST_CATEGORY_IDS = ['fruit', 'animal', 'instrument']
const TEST_WORDS_PER_CATEGORY = 3

function testLevelBase(id: string): LevelConfigWithoutSeed {
  const categoryWordCounts = Object.fromEntries(TEST_CATEGORY_IDS.map((c) => [c, TEST_WORDS_PER_CATEGORY]))
  return {
    id,
    difficulty: 'easy',
    categoryIds: TEST_CATEGORY_IDS,
    columnCount: 4,
    categorySlotCount: 2,
    deckEnabled: false,
    deckSize: 0,
    categoryWordCounts,
    ...estimateTargets(totalCardCount(categoryWordCounts)),
  }
}

describe('solver — validates small generated levels are winnable', () => {
  const levels = ['solver-test-a', 'solver-test-b'].map((id) => generateSolvableLevel(testLevelBase(id), CATEGORIES, WORDS))

  for (const result of levels) {
    it(`level ${result.config.id} is solvable`, () => {
      expect(result.solvable).toBe(true)
    })
  }
})

describe('getAvailableMoves / getHint', () => {
  const level = generateSolvableLevel(testLevelBase('solver-test-hint'), CATEGORIES, WORDS).config

  it('always offers at least one move on a freshly dealt board', () => {
    const state = createGame(level, CATEGORIES, WORDS)
    expect(getAvailableMoves(state).length).toBeGreaterThan(0)
  })

  it('hint level 1 omits the destination, level 2 includes it', () => {
    const state = createGame(level, CATEGORIES, WORDS)
    const hint1 = getHint(state, 1)
    const hint2 = getHint(state, 2)
    expect(hint1?.to).toBeUndefined()
    expect(hint2?.to).toBeDefined()
  })
})
