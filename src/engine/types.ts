// Word Solitaire — core data model.
// This module has zero dependency on React and must remain pure data + types.

export type Difficulty = 'easy' | 'normal' | 'hard'

/** A single Chinese word that can belong to one or more categories in the master dataset. */
export interface WordEntry {
  id: string
  text: string
  /** Categories this word could plausibly belong to. A level must only ever use one of them. */
  possibleCategoryIds: string[]
  tags?: string[]
  difficulty?: number
}

/** A themed group of words, e.g. 水果 (fruit). */
export interface Category {
  id: string
  name: string
  wordIds: string[]
  tags?: string[]
  difficulty?: number
}

/** Author-controlled level definition. The generator turns this into a concrete GameState. */
export interface LevelConfig {
  id: string
  chapterId: string
  difficulty: Difficulty
  categoryIds: string[]
  columnCount: number
  categorySlotCount: number
  deckEnabled: boolean
  deckSize: number
  /** Optional explicit word count per category; falls back to a difficulty-based default. */
  categoryWordCounts?: Record<string, number>
  targetThreeStarMoves: number
  targetTwoStarMoves: number
  /** Target times in seconds. */
  targetThreeStarTime: number
  targetTwoStarTime: number
  seed?: string
}

export interface WordCard {
  id: string
  cardType: 'word'
  wordId: string
  text: string
  categoryId: string
  faceUp: boolean
}

export interface CategoryCard {
  id: string
  cardType: 'category'
  categoryId: string
  name: string
  requiredWordCount: number
  faceUp: boolean
}

export type Card = WordCard | CategoryCard

export interface CategorySlotState {
  slotIndex: number
  categoryId: string
  name: string
  collected: number
  required: number
}

export interface TodoItem {
  categoryId: string
  name: string
  required: number
  collected: number
  completed: boolean
}

export type Location =
  | { zone: 'column'; index: number }
  | { zone: 'waste' }
  | { zone: 'slot'; index: number }

export type GameStatus = 'playing' | 'won'

/** Everything about a game in progress, excluding its own undo history (see GameState). */
export interface GameStateCore {
  levelId: string
  difficulty: Difficulty
  columns: Card[][]
  deck: Card[]
  waste: Card[]
  categorySlots: (CategorySlotState | null)[]
  completedCategories: string[]
  categoryMeta: Record<string, { name: string; required: number }>
  moves: number
  startedAt: number
  coinsSpent: number
  hintsUsed: number
  status: GameStatus
}

/** Full engine-facing game state. `history` holds prior snapshots for undo(). */
export interface GameState extends GameStateCore {
  history: GameStateCore[]
}

export interface MoveResult {
  success: boolean
  state: GameState
  reason?: string
}

export type AvailableMoveKind = 'card' | 'stack' | 'categoryActivate' | 'wordToSlot' | 'draw' | 'recycle'

export interface AvailableMove {
  kind: AvailableMoveKind
  cardId?: string
  from?: Location
  /** For stack moves: index within the source column where the run starts. */
  stackStartIndex?: number
  to?: Location
}

export interface HintResult {
  cardId: string
  from?: Location
  to?: Location
  level: 1 | 2
}

export interface ScoreResult {
  stars: 0 | 1 | 2 | 3
  moves: number
  timeMs: number
  coinsEarned: number
}
