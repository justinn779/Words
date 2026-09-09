import { describe, expect, it } from 'vitest'
import { generateSolvableLevel, type LevelConfigWithoutSeed } from '../generator'
import { CATEGORIES } from '../../data/categories'
import { WORDS } from '../../data/words'
import { createGame } from '../createGame'
import { solve } from '../solver'

const base: LevelConfigWithoutSeed = {
  id: 'gen-test',
  chapterId: 'test',
  difficulty: 'easy',
  categoryIds: ['fruit', 'animal', 'color'],
  columnCount: 4,
  categorySlotCount: 2,
  deckEnabled: false,
  deckSize: 0,
  categoryWordCounts: { fruit: 4, animal: 4, color: 4 },
  targetThreeStarMoves: 18,
  targetTwoStarMoves: 26,
  targetThreeStarTime: 100,
  targetTwoStarTime: 170,
}

describe('generateSolvableLevel', () => {
  it('returns a config whose dealt table the solver confirms is winnable', () => {
    const result = generateSolvableLevel(base, CATEGORIES, WORDS)
    expect(result.solvable).toBe(true)
    expect(result.config.seed).toBeDefined()

    // Re-deal with the returned seed and confirm independently.
    const state = createGame(result.config, CATEGORIES, WORDS)
    expect(solve(state).solvable).toBe(true)
  })

  it('tries successive seeds named after the level id', () => {
    const result = generateSolvableLevel(base, CATEGORIES, WORDS)
    expect(result.config.seed).toMatch(/^gen-test-s\d+$/)
  })
})
