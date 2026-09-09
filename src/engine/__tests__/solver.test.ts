import { describe, expect, it } from 'vitest'
import { createGame } from '../createGame'
import { solve } from '../solver'
import { getAvailableMoves, getHint } from '../hint'
import { CATEGORIES } from '../../data/categories'
import { WORDS } from '../../data/words'
import { LEVELS } from '../../data/levels'

describe('solver — validates authored levels are winnable', () => {
  // Every shipped level is already solver-verified at generation time (see
  // scripts/generate-levels.ts and docs/level-generator.md) — re-solving all 30
  // here would be far too slow for a test run, so this just spot-checks a couple
  // of the smallest ('easy') ones as a fast regression check.
  const smallLevels = LEVELS.filter((l) => l.difficulty === 'easy').slice(0, 2)

  for (const level of smallLevels) {
    it(`level ${level.id} is solvable`, () => {
      const state = createGame(level, CATEGORIES, WORDS)
      const result = solve(state)
      expect(result.solvable).toBe(true)
    })
  }
})

describe('getAvailableMoves / getHint', () => {
  it('always offers at least one move on a freshly dealt board', () => {
    const level = LEVELS[0]
    const state = createGame(level, CATEGORIES, WORDS)
    expect(getAvailableMoves(state).length).toBeGreaterThan(0)
  })

  it('hint level 1 omits the destination, level 2 includes it', () => {
    const level = LEVELS[0]
    const state = createGame(level, CATEGORIES, WORDS)
    const hint1 = getHint(state, 1)
    const hint2 = getHint(state, 2)
    expect(hint1?.to).toBeUndefined()
    expect(hint2?.to).toBeDefined()
  })
})
