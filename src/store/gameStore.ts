import { create } from 'zustand'
import type { GameState, HintResult, LevelConfig, Location, ScoreResult } from '../engine/types'
import {
  createGame,
  dealUntilLikelyWinnable,
  moveCard,
  moveStack,
  canMoveStack,
  getBoundRunStart,
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
import { buildDailyLevelConfig, getTodayDateString } from '../data/dailyChallenge'
import { getLoadedAiContent, ensureAiContentLoaded, refreshAiContent } from '../firebase/aiContent'
import { getLoadedLevels } from '../firebase/levels'
import { reportUnsolvableLevel } from '../firebase/reports'
import { levelIdToNumber } from '../data/progression'
import { usePlayerStore } from './playerStore'
import { useContentStore } from './contentStore'
import { playSfx, type SfxName } from '../audio/sfx'

function sfx(name: SfxName) {
  playSfx(name, usePlayerStore.getState().settings.soundOn)
}

export type Selection = { kind: 'column'; columnIndex: number; cardIndex: number; cardId: string } | { kind: 'waste'; cardId: string }

interface FlashState {
  cardId: string
  token: number
}

export interface DragRect {
  top: number
  left: number
  width: number
  height: number
}

export interface DragVisual {
  cardIds: string[]
  dx: number
  dy: number
  /** Viewport-space origin of each dragged card, captured when the drag begins.
   * Lets CardView render the card `position: fixed` so no `overflow` ancestor
   * (e.g. the horizontally-scrolling columns row) can clip it while it's lifted
   * over the category slots. */
  rects?: Record<string, DragRect>
}

export type CardLoc = { zone: 'column'; columnIndex: number; cardIndex: number } | { zone: 'waste' }

export interface WinUnlocks {
  achievementIds: string[]
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
  /** Set when the active game is a Daily Challenge run instead of a generated level. */
  dailyDate: string | null
  winUnlocks: WinUnlocks | null

  startLevel: (levelId: string) => Promise<void>
  startDailyLevel: (difficulty: LevelConfig['difficulty']) => Promise<void>
  clickCard: (loc: CardLoc) => void
  clickEmptyColumn: (columnIndex: number) => void
  clickSlot: (slotIndex: number) => void
  draw: () => void
  undo: () => void
  requestHint: (level: 1 | 2) => void
  /** Sends the current level's id/difficulty to reportUnsolvableLevel
   * (functions/src/index.ts), which relays it to the developer for a manual fix —
   * see src/firebase/reports.ts. Purely a notification; never touches gameplay. */
  reportCurrentLevel: () => Promise<void>
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
  for (const config of Object.values(getLoadedLevels())) {
    if (config.id === levelId) return config
  }
  throw new Error(`Unknown level id: ${levelId}`)
}

/** CATEGORIES/WORDS plus whatever AI-generated content (src/firebase/aiContent.ts)
 * has loaded so far — a level's categoryIds may reference either, including
 * Daily Challenge's now that it also merges in AI categories (see
 * data/dailyChallenge.ts). */
function allCategories() {
  const ai = getLoadedAiContent()
  return ai.categories.length > 0 ? [...CATEGORIES, ...ai.categories] : CATEGORIES
}

function allWords() {
  const ai = getLoadedAiContent()
  return ai.words.length > 0 ? [...WORDS, ...ai.words] : WORDS
}

function isRunTop(game: GameState, columnIndex: number, cardIndex: number): boolean {
  return cardIndex === game.columns[columnIndex].length - 1
}

function tryPickSelection(game: GameState, columnIndex: number, cardIndex: number): Selection | null {
  const column = game.columns[columnIndex]
  const card = column[cardIndex]
  if (!card || !card.faceUp) return null

  // Same-category adjacency is permanently bound (see game-rules.md): clicking
  // or dragging ANY card in a run — including the column's physical top card,
  // not just one buried partway in — always picks up the whole bound group
  // from its true start, never a partial tail. A capping Category Card counts
  // as part of the run below it too: a word card can only ever legally land
  // on a *matching* category's word run (canPlaceOnColumn), so a Category
  // Card sitting right on a word card is always that same category's cap.
  let anchorIndex = cardIndex
  if (card.cardType === 'category') {
    const below = cardIndex > 0 ? column[cardIndex - 1] : undefined
    const isCapping = below?.faceUp && below.cardType === 'word' && below.categoryId === card.categoryId
    if (!isCapping) {
      // A lone Category Card (nothing bound below it) is only pickable as
      // itself, and only when nothing sits above it either.
      return isRunTop(game, columnIndex, cardIndex) ? { kind: 'column', columnIndex, cardIndex, cardId: card.id } : null
    }
    anchorIndex = cardIndex - 1 // the word card just under the cap — walk its run from there
  }
  const start = getBoundRunStart(game, columnIndex, anchorIndex)
  // Delegate to the engine's canMoveStack so "what counts as a pickable stack" (a
  // same-category word run, optionally capped by that category's parked Category
  // Card) lives in exactly one place — it also rejects a run that doesn't
  // actually reach the column's physical top (e.g. a stray mismatched card
  // above it), which a plain backward walk from anchorIndex can't see.
  return canMoveStack(game, columnIndex, start)
    ? { kind: 'column', columnIndex, cardIndex: start, cardId: column[start].id }
    : null
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

  startLevel: async (levelId) => {
    const levelConfig = findLevel(levelId)
    // A level generated by a DIFFERENT session (another tab, another player,
    // or this session's own ahead-buffer picking it up already-ready rather
    // than generating it itself — see contentStore.ts's ensureLevelsAhead)
    // can reference categories this client's aiContent cache never saw: that
    // cache is otherwise a one-time load from whenever the app first
    // mounted, long before this specific level's content might have been
    // written. Without this, dealUntilLikelyWinnable below throws "Unknown
    // category id" and the level silently fails to start — confirmed live.
    await refreshAiContent()
    // Never the same layout twice, even replaying the same level — see
    // src/engine/deal.ts. Daily Challenge (below) is the one exception: it
    // keeps calling createGame directly with its fixed shared-seed config, since
    // every player must see the same board on the same day.
    const game = dealUntilLikelyWinnable(levelConfig, allCategories(), allWords())
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
    // Starting a level is also a signal to keep the ahead-buffer topped up
    // (see contentStore.ts's AHEAD_BUFFER) — belt-and-suspenders alongside the
    // level grid's own check on mount, in case the player jumped straight into
    // a level without revisiting the grid (e.g. WinModal's "下一關").
    const levelNumber = levelIdToNumber(levelConfig.id)
    if (levelNumber !== undefined) useContentStore.getState().ensureLevelsAhead(levelNumber)
  },

  startDailyLevel: async (difficulty) => {
    const date = getTodayDateString()
    // Daily Challenge's category pool now merges in AI-generated content (see
    // dailyChallenge.ts), so this needs both loaded before it can pick categoryIds.
    await ensureAiContentLoaded()
    const levelConfig = await buildDailyLevelConfig(date, difficulty)
    const game = createGame(levelConfig, allCategories(), allWords())
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
    // A whole same-category run can be delivered to its slot at once; the engine
    // (moveStack) validates capacity and category, so no pre-check is needed here.
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

  reportCurrentLevel: async () => {
    const { levelConfig } = get()
    if (!levelConfig) return
    const result = await reportUnsolvableLevel(levelConfig.id, levelConfig.difficulty)
    set({ message: result.ok ? '已回報，謝謝提供！我們會盡快確認' : result.message })
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
    // Dropping a card/stack back onto the column it already sits on is a no-op,
    // not a mistake — snap it back silently instead of shaking/beeping at the
    // player for putting a card down where they picked it up.
    if (result.reason !== 'same-position') {
      sfx('invalid')
      flashInvalid(set, selection.cardId)
    }
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
    if (unlocks.newlyUnlockedAchievementIds.length > 0) {
      setTimeout(() => sfx('unlock'), 400)
    }
    set({
      game: won,
      selection: null,
      hint: null,
      score,
      winUnlocks: { achievementIds: unlocks.newlyUnlockedAchievementIds },
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
