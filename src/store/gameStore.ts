import { create } from 'zustand'
import type { GameState, HintResult, LevelConfig, Location, ScoreResult } from '../engine/types'
import {
  createGame,
  moveCard,
  moveStack,
  drawDeckCard,
  recycleDeck,
  undo as engineUndo,
  getHint,
  checkWin,
  calculateScore,
  recordHintUsed,
  recordCoinsSpent,
  HINT_LEVEL_1_COST,
  HINT_LEVEL_2_COST,
  UNDO_COST,
} from '../engine'
import { CATEGORIES } from '../data/categories'
import { WORDS } from '../data/words'
import { LEVELS } from '../data/levels'
import { buildDailyLevelConfig, getTodayDateString } from '../data/dailyChallenge'
import { usePlayerStore } from './playerStore'
import { playSfx, type SfxName } from '../audio/sfx'

function sfx(name: SfxName) {
  playSfx(name, usePlayerStore.getState().settings.soundOn)
}

export type Selection = { kind: 'column'; columnIndex: number; cardIndex: number; cardId: string } | { kind: 'waste'; cardId: string }

interface FlashState {
  cardId: string
  token: number
}

export interface DragVisual {
  cardIds: string[]
  dx: number
  dy: number
}

export type CardLoc = { zone: 'column'; columnIndex: number; cardIndex: number } | { zone: 'waste' }

export interface WinUnlocks {
  achievementIds: string[]
  libraryItemIds: string[]
}

interface GameStore {
  levelConfig: LevelConfig | null
  game: GameState | null
  selection: Selection | null
  hint: HintResult | null
  invalidFlash: FlashState | null
  message: string | null
  score: ScoreResult | null
  nowTick: number
  dragVisual: DragVisual | null
  /** Set when the active game is a Daily Challenge run instead of a chapter level. */
  dailyDate: string | null
  winUnlocks: WinUnlocks | null

  startLevel: (levelId: string) => void
  startDailyLevel: (difficulty: LevelConfig['difficulty']) => void
  clickCard: (loc: CardLoc) => void
  clickEmptyColumn: (columnIndex: number) => void
  clickSlot: (slotIndex: number) => void
  draw: () => void
  undo: () => void
  requestHint: (level: 1 | 2) => void
  dismissMessage: () => void
  tick: () => void
  exitLevel: () => void

  /** Drag support: attempts to select `loc` for dragging without disturbing an existing
   * selection if `loc` is not itself pickable (the drag then falls back to a tap on `loc`). */
  selectAt: (loc: CardLoc) => boolean
  /** Drag support: attempts to move the current selection to `destination`. Returns success. */
  moveSelectionTo: (destination: Location) => boolean
  setDragVisual: (visual: DragVisual | null) => void
  /** Drag support: flashes the current selection as invalid and clears it (drag missed every dropzone). */
  cancelDrag: () => void
}

function elapsedMs(game: GameState, nowTick: number): number {
  return Math.max(0, nowTick - game.startedAt)
}

function findLevel(levelId: string): LevelConfig {
  const level = LEVELS.find((l) => l.id === levelId)
  if (!level) throw new Error(`Unknown level id: ${levelId}`)
  return level
}

function isRunTop(game: GameState, columnIndex: number, cardIndex: number): boolean {
  return cardIndex === game.columns[columnIndex].length - 1
}

function tryPickSelection(game: GameState, columnIndex: number, cardIndex: number): Selection | null {
  const column = game.columns[columnIndex]
  const card = column[cardIndex]
  if (!card || !card.faceUp) return null
  if (isRunTop(game, columnIndex, cardIndex)) {
    return { kind: 'column', columnIndex, cardIndex, cardId: card.id }
  }
  // Only a contiguous same-category word run (see engine canMoveStack) can be picked mid-column.
  const run = column.slice(cardIndex)
  const categoryId = run[0].categoryId
  const isRun = run.every((c) => c.faceUp && c.cardType === 'word' && c.categoryId === categoryId)
  return isRun ? { kind: 'column', columnIndex, cardIndex, cardId: card.id } : null
}

export const useGameStore = create<GameStore>((set, get) => ({
  levelConfig: null,
  game: null,
  selection: null,
  hint: null,
  invalidFlash: null,
  message: null,
  score: null,
  nowTick: Date.now(),
  dragVisual: null,
  dailyDate: null,
  winUnlocks: null,

  startLevel: (levelId) => {
    const levelConfig = findLevel(levelId)
    const game = createGame(levelConfig, CATEGORIES, WORDS)
    set({
      levelConfig,
      game,
      selection: null,
      hint: null,
      invalidFlash: null,
      score: null,
      nowTick: Date.now(),
      dragVisual: null,
      dailyDate: null,
      winUnlocks: null,
    })
  },

  startDailyLevel: (difficulty) => {
    const date = getTodayDateString()
    const levelConfig = buildDailyLevelConfig(date, difficulty)
    const game = createGame(levelConfig, CATEGORIES, WORDS)
    set({
      levelConfig,
      game,
      selection: null,
      hint: null,
      invalidFlash: null,
      score: null,
      nowTick: Date.now(),
      dragVisual: null,
      dailyDate: date,
      winUnlocks: null,
    })
  },

  exitLevel: () => {
    set({ levelConfig: null, game: null, selection: null, hint: null, score: null, dailyDate: null, winUnlocks: null })
  },

  tick: () => set({ nowTick: Date.now() }),

  dismissMessage: () => set({ message: null }),

  clickCard: (loc) => {
    const { game, selection } = get()
    if (!game || game.status !== 'playing') return

    const clickedCardId =
      loc.zone === 'waste' ? game.waste[game.waste.length - 1]?.id : game.columns[loc.columnIndex][loc.cardIndex]?.id
    if (!clickedCardId) return

    if (!selection) {
      const picked =
        loc.zone === 'waste'
          ? game.waste.length > 0 && game.waste[game.waste.length - 1].faceUp
            ? ({ kind: 'waste', cardId: clickedCardId } as Selection)
            : null
          : tryPickSelection(game, loc.columnIndex, loc.cardIndex)
      set({ selection: picked, hint: null })
      return
    }

    // Clicking the currently-selected card again deselects it.
    if (selection.cardId === clickedCardId) {
      set({ selection: null })
      return
    }

    if (loc.zone === 'waste') {
      // Waste is never a valid drop target — try reselecting the waste top instead.
      const picked = game.waste.length > 0 && game.waste[game.waste.length - 1].faceUp
        ? ({ kind: 'waste', cardId: game.waste[game.waste.length - 1].id } as Selection)
        : null
      set({ selection: picked })
      return
    }

    const destination: Location = { zone: 'column', index: loc.columnIndex }
    const result = attemptMoveSelection(get, set, selection, destination)
    if (!result) {
      // The move failed — offer the clicked card as a new selection if it is itself pickable.
      const picked = tryPickSelection(game, loc.columnIndex, loc.cardIndex)
      if (picked) {
        set({ selection: picked })
      } else {
        flashInvalid(set, selection.cardId)
        set({ selection: null })
      }
    }
  },

  clickEmptyColumn: (columnIndex) => {
    const { game, selection } = get()
    if (!game || game.status !== 'playing' || !selection) return
    attemptMoveSelection(get, set, selection, { zone: 'column', index: columnIndex })
  },

  clickSlot: (slotIndex) => {
    const { game, selection } = get()
    if (!game || game.status !== 'playing' || !selection) return
    if (selection.kind === 'column' && !isRunTop(game, selection.columnIndex, selection.cardIndex)) {
      // Multi-card stacks can never target a slot.
      flashInvalid(set, selection.cardId)
      set({ selection: null })
      return
    }
    attemptMoveSelection(get, set, selection, { zone: 'slot', index: slotIndex })
  },

  draw: () => {
    const { game } = get()
    if (!game || game.status !== 'playing') return
    if (game.deck.length > 0) {
      sfx('cardFlip')
      set({ game: drawDeckCard(game), selection: null, hint: null })
    } else if (game.waste.length > 0) {
      set({ game: recycleDeck(game), selection: null, hint: null })
    }
  },

  undo: () => {
    const { game } = get()
    if (!game || game.history.length === 0) return
    if (!usePlayerStore.getState().spendCoins(UNDO_COST)) {
      set({ message: '金幣不足，無法復原' })
      return
    }
    const undone = engineUndo(game)
    set({ game: recordCoinsSpent(undone, UNDO_COST), selection: null, hint: null })
  },

  requestHint: (level) => {
    const { game } = get()
    if (!game || game.status !== 'playing') return
    const cost = level === 1 ? HINT_LEVEL_1_COST : HINT_LEVEL_2_COST
    const hint = getHint(game, level)
    if (!hint) {
      set({ message: '目前沒有可提示的移動' })
      return
    }
    if (!usePlayerStore.getState().spendCoins(cost)) {
      set({ message: '金幣不足，無法使用提示' })
      return
    }
    set({ game: recordHintUsed(game, cost), hint, selection: null })
  },

  selectAt: (loc) => {
    const { game } = get()
    if (!game || game.status !== 'playing') return false
    const picked =
      loc.zone === 'waste'
        ? game.waste.length > 0 && game.waste[game.waste.length - 1].faceUp
          ? ({ kind: 'waste', cardId: game.waste[game.waste.length - 1].id } as Selection)
          : null
        : tryPickSelection(game, loc.columnIndex, loc.cardIndex)
    if (!picked) return false
    set({ selection: picked, hint: null })
    return true
  },

  moveSelectionTo: (destination) => {
    const { selection } = get()
    if (!selection) return false
    return attemptMoveSelection(get, set, selection, destination)
  },

  setDragVisual: (visual) => set({ dragVisual: visual }),

  cancelDrag: () => {
    const { selection } = get()
    if (selection) flashInvalid(set, selection.cardId)
    set({ selection: null })
  },
}))

const INVALID_FLASH_DURATION_MS = 450

function flashInvalid(set: (partial: Partial<GameStore>) => void, cardId: string) {
  const token = Date.now()
  set({ invalidFlash: { cardId, token } })
  // Auto-clears here (rather than via a timer in the CardView component) so the
  // component can derive its shake visual purely from store state during render.
  setTimeout(() => {
    if (useGameStore.getState().invalidFlash?.token === token) {
      useGameStore.setState({ invalidFlash: null })
    }
  }, INVALID_FLASH_DURATION_MS)
}

/** Shared apply-and-finalize path for both click-to-move flows. Returns true on success. */
function attemptMoveSelection(
  get: () => GameStore,
  set: (partial: Partial<GameStore>) => void,
  selection: Selection,
  destination: Location,
): boolean {
  const { game } = get()
  if (!game) return false

  const result =
    selection.kind === 'waste' || isRunTop(game, selection.columnIndex, selection.cardIndex)
      ? moveCard(game, selection.cardId, destination)
      : moveStack(game, selection.columnIndex, selection.cardIndex, destination)

  if (!result.success) {
    sfx('invalid')
    flashInvalid(set, selection.cardId)
    set({ selection: null })
    return false
  }

  finalizeMove(get, set, game, result.state)
  return true
}

function countFaceUp(game: GameState): number {
  return game.columns.reduce((sum, col) => sum + col.filter((c) => c.faceUp).length, 0)
}

function finalizeMove(get: () => GameStore, set: (partial: Partial<GameStore>) => void, previousGame: GameState, nextGame: GameState) {
  const { levelConfig, dailyDate } = get()
  if (levelConfig && checkWin(nextGame)) {
    const won: GameState = { ...nextGame, status: 'won' }
    const score = calculateScore(won, levelConfig, elapsedMs(won, Date.now()))
    const unlocks = usePlayerStore.getState().recordWin({
      levelId: dailyDate ? undefined : levelConfig.id,
      difficulty: levelConfig.difficulty,
      stars: score.stars,
      moves: score.moves,
      timeMs: score.timeMs,
      coinsEarned: score.coinsEarned,
      categoriesCompleted: won.completedCategories.length,
      hintsUsed: won.hintsUsed,
      daily: dailyDate ? { date: dailyDate } : undefined,
    })
    sfx('levelComplete')
    if (unlocks.newlyUnlockedAchievementIds.length > 0 || unlocks.newlyUnlockedLibraryItemIds.length > 0) {
      setTimeout(() => sfx('unlock'), 400)
    }
    set({
      game: won,
      selection: null,
      hint: null,
      score,
      winUnlocks: { achievementIds: unlocks.newlyUnlockedAchievementIds, libraryItemIds: unlocks.newlyUnlockedLibraryItemIds },
    })
    return
  }

  if (nextGame.completedCategories.length > previousGame.completedCategories.length) {
    sfx('categoryComplete')
  } else if (countFaceUp(nextGame) > countFaceUp(previousGame)) {
    sfx('cardFlip')
  } else {
    sfx('cardMove')
  }
  set({ game: nextGame, selection: null, hint: null })
}

export function getElapsedMs(game: GameState, nowTick: number): number {
  return elapsedMs(game, nowTick)
}

export function isCardSelected(cardId: string, selection: Selection | null): boolean {
  return selection?.cardId === cardId
}
