import type { GameState, LevelConfig, ScoreResult, TodoItem } from './types'

export function checkWin(state: GameState): boolean {
  const total = Object.keys(state.categoryMeta).length
  return total > 0 && state.completedCategories.length === total
}

/** Derived, not stored — keeps completion counts in one source of truth (categorySlots + completedCategories). */
export function getTodoList(state: GameState): TodoItem[] {
  return Object.entries(state.categoryMeta).map(([categoryId, meta]) => {
    const completed = state.completedCategories.includes(categoryId)
    const activeSlot = state.categorySlots.find((s) => s?.categoryId === categoryId)
    return {
      categoryId,
      name: meta.name,
      required: meta.required,
      collected: completed ? meta.required : activeSlot?.collected ?? 0,
      completed,
    }
  })
}

function starsFor(value: number, threeStarMax: number, twoStarMax: number): 1 | 2 | 3 {
  if (value <= threeStarMax) return 3
  if (value <= twoStarMax) return 2
  return 1
}

/** Stars = the more conservative of the moves-based and time-based ratings. */
export function calculateScore(state: GameState, config: LevelConfig, elapsedMs: number): ScoreResult {
  if (!checkWin(state)) {
    return { stars: 0, moveStars: 0, timeStars: 0, moves: state.moves, timeMs: elapsedMs, coinsEarned: 0 }
  }
  const moveStars = starsFor(state.moves, config.targetThreeStarMoves, config.targetTwoStarMoves)
  const timeStars = starsFor(elapsedMs / 1000, config.targetThreeStarTime, config.targetTwoStarTime)
  // The overall rating is the more conservative of the two — so whichever of
  // moveStars/timeStars is lower is the one holding the score back.
  const stars = Math.min(moveStars, timeStars) as 1 | 2 | 3
  const coinsEarned = 10 + stars * 10
  return { stars, moveStars, timeStars, moves: state.moves, timeMs: elapsedMs, coinsEarned }
}
