import { create } from 'zustand'
import type { Difficulty } from '../engine/types'
import { MISSIONS, getWeekKey, type MissionStatKey } from '../data/missions'
import { ACHIEVEMENTS, type Statistics } from '../data/achievements'
import { getTodayDateString, previousDateString } from '../data/dailyChallenge'
import { firebaseEnabled } from '../firebase/config'
import { initAuth, linkGoogleAccount, completeGoogleLinkRedirect, type AuthStatus } from '../firebase/auth'
import { loadProfile, saveProfile } from '../firebase/sync'
import { playSfx } from '../audio/sfx'

const STORAGE_KEY = 'word-solitaire-player-v2'
const STARTING_COINS = 100

interface LevelRecord {
  bestStars: 0 | 1 | 2 | 3
  bestMoves: number
  bestTimeMs: number
}

interface DailyDayResult {
  stars: 0 | 1 | 2 | 3
  moves: number
  timeMs: number
}

interface MissionPeriodState {
  periodKey: string
  progress: Partial<Record<MissionStatKey, number>>
  claimed: string[]
}

interface PersistedShape {
  coins: number
  levelRecords: Record<string, LevelRecord>
  daily: {
    days: Record<string, Partial<Record<Difficulty, DailyDayResult>>>
    streak: number
    lastStreakDate: string | null
  }
  statistics: Statistics
  achievements: Record<string, number>
  missionsDaily: MissionPeriodState
  missionsWeekly: MissionPeriodState
  settings: {
    soundOn: boolean
    animationsOn: boolean
    /** Set once the first-time tutorial has been shown (or skipped). */
    tutorialSeen: boolean
  }
  /** Local wall-clock time of the last write — used only for a simple last-write-wins
   * comparison against the cloud copy on sign-in (see docs/firebase.md). */
  updatedAt: number
}

function emptyStatistics(): Statistics {
  return {
    totalLevelsCompleted: 0,
    totalCategoriesCompleted: 0,
    totalStars: 0,
    levelsCompletedNoHint: 0,
    hardLevelsCompleted: 0,
    fastEasyClears: 0,
    dailyStreak: 0,
  }
}

function defaultShape(): PersistedShape {
  return {
    coins: STARTING_COINS,
    levelRecords: {},
    daily: { days: {}, streak: 0, lastStreakDate: null },
    statistics: emptyStatistics(),
    achievements: {},
    missionsDaily: { periodKey: getTodayDateString(), progress: {}, claimed: [] },
    missionsWeekly: { periodKey: getWeekKey(), progress: {}, claimed: [] },
    settings: { soundOn: true, animationsOn: true, tutorialSeen: false },
    updatedAt: 0,
  }
}

function load(): PersistedShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedShape>
      // Shallow-merge over defaults so fields added in a later version don't crash an older save.
      // `settings` is merged one level deeper so a new toggle isn't dropped by an older save.
      return { ...defaultShape(), ...parsed, settings: { ...defaultShape().settings, ...parsed.settings } }
    }
  } catch {
    // ignore corrupted/unavailable storage and fall back to defaults
  }
  return defaultShape()
}

function persist(shape: PersistedShape) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shape))
  } catch {
    // storage may be unavailable (private mode); the session still works in-memory
  }
}

let cloudUid: string | null = null
let cloudSyncTimer: ReturnType<typeof setTimeout> | null = null
let cloudInitStarted = false
const CLOUD_SYNC_DEBOUNCE_MS = 2000

/** Debounced cloud push — coalesces bursts of local writes into one Firestore call. */
function scheduleCloudPush(shape: PersistedShape) {
  if (!cloudUid) return
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer)
  cloudSyncTimer = setTimeout(() => {
    saveProfile(cloudUid!, shape).catch((err) => console.error('[firebase] profile sync failed', err))
  }, CLOUD_SYNC_DEBOUNCE_MS)
}

/** The single write path every mutating action funnels through: local storage
 * immediately, cloud storage debounced (only once signed in — see initCloud). */
function commit(get: () => PlayerStore, set: (partial: Partial<PlayerStore>) => void) {
  set({ updatedAt: Date.now() })
  const shape = snapshot(get)
  persist(shape)
  scheduleCloudPush(shape)
}

function rollPeriod(state: MissionPeriodState, currentKey: string): MissionPeriodState {
  if (state.periodKey === currentKey) return state
  return { periodKey: currentKey, progress: {}, claimed: [] }
}

function addProgress(state: MissionPeriodState, deltas: Partial<Record<MissionStatKey, number>>): MissionPeriodState {
  const progress = { ...state.progress }
  for (const [key, delta] of Object.entries(deltas) as [MissionStatKey, number][]) {
    if (!delta) continue
    progress[key] = (progress[key] ?? 0) + delta
  }
  return { ...state, progress }
}

export interface WinRecordInput {
  /** Present for a chapter level; absent for Daily Challenge. */
  levelId?: string
  difficulty: Difficulty
  stars: 0 | 1 | 2 | 3
  moves: number
  timeMs: number
  coinsEarned: number
  categoriesCompleted: number
  hintsUsed: number
  daily?: { date: string }
}

export interface WinRecordResult {
  newlyUnlockedAchievementIds: string[]
}

interface PlayerStore {
  coins: number
  levelRecords: Record<string, LevelRecord>
  daily: PersistedShape['daily']
  statistics: Statistics
  achievements: Record<string, number>
  missionsDaily: MissionPeriodState
  missionsWeekly: MissionPeriodState
  settings: PersistedShape['settings']
  updatedAt: number
  authStatus: AuthStatus
  /** Google account's display name once linked (src/firebase/auth.ts) — null for
   * every other authStatus (disabled/signed-out/anonymous never have one). */
  displayName: string | null

  spendCoins: (amount: number) => boolean
  addCoins: (amount: number) => void
  recordWin: (input: WinRecordInput) => WinRecordResult
  claimMission: (missionId: string) => boolean
  toggleSound: () => void
  toggleAnimations: () => void
  /** Marks the first-time tutorial as shown (or re-arms it, for "replay" from Settings). */
  setTutorialSeen: (seen: boolean) => void
  /** Wires up Firebase auth (anonymous sign-in + cloud profile merge). Safe to call
   * when Firebase isn't configured — resolves authStatus to 'disabled' and no-ops. */
  initCloud: () => void
  /** Attempts to link the current anonymous account to a Google account. Resolves
   * (never rejects) with the outcome so Settings can show *why* a failure happened
   * instead of just "nothing happened" — see AUTH_LINK_ERROR_LABEL in Settings.tsx. */
  linkGoogle: () => Promise<{ ok: true } | { ok: false; code?: string }>
}

const initial = load()

function snapshot(get: () => PlayerStore): PersistedShape {
  const s = get()
  return {
    coins: s.coins,
    levelRecords: s.levelRecords,
    daily: s.daily,
    statistics: s.statistics,
    achievements: s.achievements,
    missionsDaily: s.missionsDaily,
    missionsWeekly: s.missionsWeekly,
    settings: s.settings,
    updatedAt: s.updatedAt,
  }
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  coins: initial.coins,
  levelRecords: initial.levelRecords,
  daily: initial.daily,
  statistics: initial.statistics,
  achievements: initial.achievements,
  missionsDaily: rollPeriod(initial.missionsDaily, getTodayDateString()),
  missionsWeekly: rollPeriod(initial.missionsWeekly, getWeekKey()),
  settings: initial.settings,
  updatedAt: initial.updatedAt,
  authStatus: firebaseEnabled ? 'signed-out' : 'disabled',
  displayName: null,

  spendCoins: (amount) => {
    const { coins } = get()
    if (coins < amount) return false
    set({ coins: coins - amount })
    commit(get, set)
    return true
  },

  addCoins: (amount) => {
    set({ coins: get().coins + amount })
    commit(get, set)
  },

  recordWin: (input) => {
    const state = get()

    // 1. Best-score bookkeeping for chapter levels.
    let levelRecords = state.levelRecords
    if (input.levelId) {
      const existing = levelRecords[input.levelId]
      if (!existing || input.stars > existing.bestStars) {
        levelRecords = {
          ...levelRecords,
          [input.levelId]: { bestStars: input.stars, bestMoves: input.moves, bestTimeMs: input.timeMs },
        }
      }
    }

    // 2. Daily Challenge day result + streak.
    let daily = state.daily
    if (input.daily) {
      const date = input.daily.date
      const dayRecord = daily.days[date] ?? {}
      const existing = dayRecord[input.difficulty]
      const isFirstCompletionToday = Object.keys(dayRecord).length === 0
      const nextDayRecord = { ...dayRecord }
      if (!existing || input.stars > existing.stars) {
        nextDayRecord[input.difficulty] = { stars: input.stars, moves: input.moves, timeMs: input.timeMs }
      }
      let { streak, lastStreakDate } = daily
      if (isFirstCompletionToday && lastStreakDate !== date) {
        streak = lastStreakDate === previousDateString(date) ? streak + 1 : 1
        lastStreakDate = date
      }
      daily = { days: { ...daily.days, [date]: nextDayRecord }, streak, lastStreakDate }
    }

    // 3. Lifetime statistics.
    const deltas: Partial<Record<MissionStatKey, number>> = {
      levelsCompleted: 1,
      categoriesCompleted: input.categoriesCompleted,
      levelsCompletedNoHint: input.hintsUsed === 0 ? 1 : 0,
      hardLevelsCompleted: input.difficulty === 'hard' ? 1 : 0,
      starsEarned: input.stars,
    }
    const statistics: Statistics = {
      ...state.statistics,
      totalLevelsCompleted: state.statistics.totalLevelsCompleted + 1,
      totalCategoriesCompleted: state.statistics.totalCategoriesCompleted + input.categoriesCompleted,
      totalStars: state.statistics.totalStars + input.stars,
      levelsCompletedNoHint: state.statistics.levelsCompletedNoHint + (deltas.levelsCompletedNoHint ?? 0),
      hardLevelsCompleted: state.statistics.hardLevelsCompleted + (deltas.hardLevelsCompleted ?? 0),
      fastEasyClears: state.statistics.fastEasyClears + (input.difficulty === 'easy' && input.timeMs <= 60000 ? 1 : 0),
      dailyStreak: daily.streak,
    }

    // 4. Mission progress (auto-rolls its period if a day/week boundary passed).
    const missionsDaily = addProgress(rollPeriod(state.missionsDaily, getTodayDateString()), deltas)
    const missionsWeekly = addProgress(rollPeriod(state.missionsWeekly, getWeekKey()), deltas)

    // 5. Achievements, re-evaluated against the fresh statistics so nothing needs
    // a bespoke "did X just happen" check.
    const newlyUnlockedAchievementIds: string[] = []
    const achievements = { ...state.achievements }
    for (const def of ACHIEVEMENTS) {
      if (!achievements[def.id] && def.check(statistics)) {
        achievements[def.id] = Date.now()
        newlyUnlockedAchievementIds.push(def.id)
      }
    }

    set({
      coins: state.coins + input.coinsEarned,
      levelRecords,
      daily,
      statistics,
      achievements,
      missionsDaily,
      missionsWeekly,
    })
    commit(get, set)

    return { newlyUnlockedAchievementIds }
  },

  claimMission: (missionId) => {
    const def = MISSIONS.find((m) => m.id === missionId)
    if (!def) return false
    const state = get()
    const period = def.scope === 'daily' ? rollPeriod(state.missionsDaily, getTodayDateString()) : rollPeriod(state.missionsWeekly, getWeekKey())
    const progress = period.progress[def.statKey] ?? 0
    if (progress < def.target || period.claimed.includes(missionId)) return false

    const nextPeriod = { ...period, claimed: [...period.claimed, missionId] }
    if (def.scope === 'daily') {
      set({ missionsDaily: nextPeriod, coins: state.coins + def.rewardCoins })
    } else {
      set({ missionsWeekly: nextPeriod, coins: state.coins + def.rewardCoins })
    }
    playSfx('coin', get().settings.soundOn)
    commit(get, set)
    return true
  },

  toggleSound: () => {
    set({ settings: { ...get().settings, soundOn: !get().settings.soundOn } })
    commit(get, set)
  },

  toggleAnimations: () => {
    set({ settings: { ...get().settings, animationsOn: !get().settings.animationsOn } })
    commit(get, set)
  },

  setTutorialSeen: (seen) => {
    set({ settings: { ...get().settings, tutorialSeen: seen } })
    commit(get, set)
  },

  initCloud: () => {
    if (cloudInitStarted) return
    cloudInitStarted = true

    initAuth((authState) => {
      set({ authStatus: authState.status, displayName: authState.displayName })
      if (!authState.uid || authState.uid === cloudUid) return
      cloudUid = authState.uid

      loadProfile<PersistedShape>(cloudUid)
        .then((remote) => {
          const local = snapshot(get)
          const remoteUpdatedAt = typeof remote?.updatedAt === 'number' ? remote.updatedAt : 0
          if (remote && remoteUpdatedAt > local.updatedAt) {
            // The cloud copy is newer (e.g. player continued on another device) —
            // adopt it wholesale. Deliberately simple last-write-wins; see docs/firebase.md.
            set({ ...defaultShape(), ...remote, settings: { ...defaultShape().settings, ...remote.settings } })
            persist(snapshot(get))
          } else {
            // Local is at least as fresh — push it up so the cloud copy catches up.
            saveProfile(cloudUid!, local).catch((err) => console.error('[firebase] initial profile push failed', err))
          }
        })
        .catch((err) => console.error('[firebase] initial profile load failed', err))
    })

    // Picks up a Google link that finished via linkGoogleAccount()'s redirect
    // fallback (the popup was blocked, so the page navigated away and back).
    // A no-op on any normal page load with no pending redirect.
    completeGoogleLinkRedirect()
      .then((state) => {
        if (state) set({ authStatus: state.status, displayName: state.displayName })
      })
      .catch((err) => console.error('[firebase] Google redirect link failed', err))
  },

  linkGoogle: async () => {
    try {
      const state = await linkGoogleAccount()
      set({ authStatus: state.status, displayName: state.displayName })
      return { ok: true }
    } catch (err) {
      console.error('[firebase] Google account link failed', err)
      const code = (err as { code?: string })?.code
      return { ok: false, code }
    }
  },
}))
