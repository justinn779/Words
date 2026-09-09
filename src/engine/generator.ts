// The Phase 3 "generate -> solve -> accept/reject" authoring pipeline (spec section 29).
// Given an author-picked knob set (everything except the seed), this tries seeds in
// sequence until the solver confirms the dealt table is winnable, so no unsolvable
// board is ever accepted. Used offline by scripts/generate-levels.ts; also usable at
// runtime (e.g. Daily Challenge) since it's plain, side-effect-free TypeScript.

import type { Category, LevelConfig, WordEntry } from './types'
import { createGame } from './createGame'
import { solve } from './solver'

export type LevelConfigWithoutSeed = Omit<LevelConfig, 'seed'>

export interface GenerateOptions {
  /** How many different seeds to try before giving up and accepting the last one unverified. */
  maxAttempts?: number
  /** Solver state budget per attempt — keeps generation time bounded for larger boards. */
  maxStates?: number
}

export interface GenerateResult {
  config: LevelConfig
  solvable: boolean
  moveCount?: number
  attempts: number
}

const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_MAX_STATES = 60000

/**
 * Tries seeds `${base.id}-s0`, `${base.id}-s1`, ... until one deals a solver-confirmed
 * winnable table. If every attempt fails (or times out against maxStates), returns the
 * last attempt anyway with `solvable: false` so the caller can decide whether to accept
 * it, log a warning, or retry with different knobs entirely.
 */
export function generateSolvableLevel(
  base: LevelConfigWithoutSeed,
  categories: Category[],
  words: WordEntry[],
  options: GenerateOptions = {},
): GenerateResult {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const maxStates = options.maxStates ?? DEFAULT_MAX_STATES

  let lastConfig: LevelConfig = { ...base, seed: `${base.id}-s0` }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const config: LevelConfig = { ...base, seed: `${base.id}-s${attempt}` }
    lastConfig = config
    const state = createGame(config, categories, words)
    const result = solve(state, maxStates)
    if (result.solvable) {
      return { config, solvable: true, moveCount: result.moveCount, attempts: attempt + 1 }
    }
  }

  return { config: lastConfig, solvable: false, attempts: maxAttempts }
}
