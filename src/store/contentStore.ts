// Reactive wrapper around src/firebase/aiChapters.ts's module cache. Not persisted
// (this is shared/global content, not per-player state — see playerStore.ts for
// that) and separate from playerStore so components that only care about the
// player's own settings/progress don't re-render on every content load.

import { create } from 'zustand'
import type { LevelConfig } from '../engine/types'
import { ensureAiChaptersLoaded, getLoadedAiChapters, requestChapterGeneration } from '../firebase/aiChapters'

interface ContentState {
  aiChapterLevels: Record<string, LevelConfig[]>
  generatingChapterId: string | null
  loadAiChapters: () => Promise<void>
  generateChapter: (chapterId: string) => Promise<{ ok: true } | { ok: false; message: string }>
}

export const useContentStore = create<ContentState>((set, get) => ({
  aiChapterLevels: {},
  generatingChapterId: null,

  loadAiChapters: async () => {
    await ensureAiChaptersLoaded()
    set({ aiChapterLevels: getLoadedAiChapters() })
  },

  generateChapter: async (chapterId) => {
    if (get().generatingChapterId) return { ok: false, message: '已經有一個章節正在生成中' }
    set({ generatingChapterId: chapterId })
    const result = await requestChapterGeneration(chapterId)
    set({ generatingChapterId: null })
    if (result.ok) {
      set((s) => ({ aiChapterLevels: { ...s.aiChapterLevels, [chapterId]: result.levels } }))
      return { ok: true }
    }
    return { ok: false, message: result.message }
  },
}))
