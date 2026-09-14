// Reactive wrapper around src/firebase/aiChapters.ts's module cache. Not persisted
// (this is shared/global content, not per-player state — see playerStore.ts for
// that) and separate from playerStore so components that only care about the
// player's own settings/progress don't re-render on every content load.

import { create } from 'zustand'
import {
  ensureAiChaptersLoaded,
  getLoadedAiChapters,
  requestChapterGeneration,
  requestNewChapterGeneration,
  type AiChapterEntry,
} from '../firebase/aiChapters'
import { refreshAiContent } from '../firebase/aiContent'

/** Sentinel generatingChapterId while generateNewChapter's call is in flight —
 * there's no chapterId to key on yet (the server assigns one). */
export const GENERATING_NEW_CHAPTER = '__new__'

interface ContentState {
  aiChapters: Record<string, AiChapterEntry>
  generatingChapterId: string | null
  loadAiChapters: () => Promise<void>
  generateChapter: (chapterId: string) => Promise<{ ok: true } | { ok: false; message: string }>
  generateNewChapter: () => Promise<{ ok: true; chapterId: string } | { ok: false; message: string }>
}

export const useContentStore = create<ContentState>((set, get) => ({
  aiChapters: {},
  generatingChapterId: null,

  loadAiChapters: async () => {
    await ensureAiChaptersLoaded()
    set({ aiChapters: getLoadedAiChapters() })
  },

  generateChapter: async (chapterId) => {
    if (get().generatingChapterId) return { ok: false, message: '已經有一個章節正在生成中' }
    set({ generatingChapterId: chapterId })
    const result = await requestChapterGeneration(chapterId)
    if (!result.ok) {
      set({ generatingChapterId: null })
      return { ok: false, message: result.message }
    }
    // The chapter's own categories were just written to `aiCategories` server-side
    // — refresh this session's cache of it so createGame() can resolve them the
    // moment the player opens a level here, without needing a page reload first.
    await refreshAiContent()
    set((s) => ({ aiChapters: { ...s.aiChapters, [result.chapterId]: result.entry }, generatingChapterId: null }))
    return { ok: true }
  },

  generateNewChapter: async () => {
    if (get().generatingChapterId) return { ok: false, message: '已經有一個章節正在生成中' }
    set({ generatingChapterId: GENERATING_NEW_CHAPTER })
    const result = await requestNewChapterGeneration()
    if (!result.ok) {
      set({ generatingChapterId: null })
      return { ok: false, message: result.message }
    }
    await refreshAiContent()
    set((s) => ({ aiChapters: { ...s.aiChapters, [result.chapterId]: result.entry }, generatingChapterId: null }))
    return { ok: true, chapterId: result.chapterId }
  },
}))
