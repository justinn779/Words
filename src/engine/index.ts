// Public surface of the Word Solitaire game engine.
// Pure TypeScript — no React import anywhere in this folder. Runnable and testable standalone.

export * from './types'
export { createGame } from './createGame'
export { canMoveCard, canMoveStack, moveCard, moveStack, flipTopCard, drawDeckCard, recycleDeck, moveCategoryCard, moveToCategorySlot, completeCategory, undo, canPlaceCardsOn } from './moves'
export { getAvailableMoves, getHint } from './hint'
export { checkWin, calculateScore, getTodoList } from './win'
export { serializeGameState, deserializeGameState } from './serialize'
export { recordHintUsed, recordCoinsSpent, HINT_LEVEL_1_COST, HINT_LEVEL_2_COST, UNDO_COST } from './economy'
export { solve } from './solver'
export { generateSolvableLevel } from './generator'
export type { GenerateOptions, GenerateResult, LevelConfigWithoutSeed } from './generator'
export { findCard, getRunStartIndex } from './query'
