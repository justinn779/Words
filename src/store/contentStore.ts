// Reactive wrapper around src/firebase/levels.ts's module cache. Not persisted
// (this is shared/global content, not per-player state — see playerStore.ts for
// that) and separate from playerStore so components that only care about the
// player's own settings/progress don't re-render on every content load.

import { create } from 'zustand'
import {
  ensureLevelsLoaded,
  getLoadedLevels,
  hasAnyLevelEverBeenRequested,
  refreshLevels,
  requestLevelGeneration,
} from '../firebase/levels'
import { refreshAiContent } from '../firebase/aiContent'
import type { LevelConfig } from '../engine/types'

/** How many not-yet-entered levels should always exist ahead of the player's
 * current frontier — enough that the level grid never shows an empty/pending
 * gap right where the player is about to scroll to. */
const AHEAD_BUFFER = 3

interface ContentState {
  levels: Record<number, LevelConfig>
  generatingLevelNumbers: number[]
  loadLevels: () => Promise<void>
  /** Re-checks Firestore fresh (bypassing the one-time cache) and re-runs
   * whichever of bootstrap/ensureLevelsAhead applies — see refreshLevels's own
   * comment for why this needs to be more than just loadLevels called again. */
  refreshAndEnsureAhead: (currentLevelNumber?: number) => Promise<void>
  generateLevel: (levelNumber: number) => Promise<{ ok: true } | { ok: false; message: string }>
  /** Call whenever the player's frontier level becomes known (opening the level
   * grid, or starting a level). Generates whichever of the next AHEAD_BUFFER
   * levels don't exist yet, in parallel — no-op for any that already exist or
   * are already generating. */
  ensureLevelsAhead: (currentLevelNumber: number) => void
}

export const useContentStore = create<ContentState>((set, get) => ({
  levels: {},
  generatingLevelNumbers: [],

  loadLevels: async () => {
    await ensureLevelsLoaded()
    const levels = getLoadedLevels()
    set({ levels })
    maybeBootstrapFirstLevel(get, levels)
  },

  refreshAndEnsureAhead: async (currentLevelNumber) => {
    await refreshLevels()
    const levels = getLoadedLevels()
    set({ levels })
    if (currentLevelNumber) get().ensureLevelsAhead(currentLevelNumber)
    else maybeBootstrapFirstLevel(get, levels)
  },

  generateLevel: async (levelNumber) => {
    if (get().generatingLevelNumbers.includes(levelNumber)) return { ok: false, message: '這一關正在生成中' }
    set((s) => ({ generatingLevelNumbers: [...s.generatingLevelNumbers, levelNumber] }))
    const result = await requestLevelGeneration(levelNumber)
    set((s) => ({ generatingLevelNumbers: s.generatingLevelNumbers.filter((n) => n !== levelNumber) }))
    if (!result.ok) return { ok: false, message: result.message }
    // The level's own categories were just written to `aiCategories` server-side
    // — refresh this session's cache of it so createGame() can resolve them the
    // moment the player opens it, without needing a page reload first.
    await refreshAiContent()
    set((s) => ({ levels: { ...s.levels, [levelNumber]: result.config } }))
    return { ok: true }
  },

  ensureLevelsAhead: (currentLevelNumber) => {
    const { levels, generatingLevelNumbers } = get()
    for (let n = currentLevelNumber + 1; n <= currentLevelNumber + AHEAD_BUFFER; n++) {
      if (!levels[n] && !generatingLevelNumbers.includes(n)) void get().generateLevel(n)
    }
  },
}))

/** Bootstrap: a brand-new install (or a freshly wiped database) has no levels at
 * all yet — kick off generating level 1 (and the usual ahead-buffer) right away.
 * Gated on hasAnyLevelEverBeenRequested(), not just levels being empty — a level
 * still `status: 'generating'` is invisible to `levels` until it's ready, and
 * without this check, reloading the page while level 1 is still generating
 * looked identical to "nothing has ever been requested" and fired a duplicate,
 * separately billed generation — confirmed happening in testing (see git history
 * on the equivalent aiChapters.ts check this replaced). */
function maybeBootstrapFirstLevel(get: () => ContentState, levels: Record<number, LevelConfig>): void {
  if (Object.keys(levels).length === 0 && !hasAnyLevelEverBeenRequested()) {
    get().ensureLevelsAhead(0)
  }
}
