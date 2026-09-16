// Reactive wrapper around src/firebase/aiChapters.ts's module cache. Not persisted
// (this is shared/global content, not per-player state — see playerStore.ts for
// that) and separate from playerStore so components that only care about the
// player's own settings/progress don't re-render on every content load.

import { create } from 'zustand'
import { ensureAiChaptersLoaded, getLoadedAiChapters, requestNewChapterGeneration, type AiChapterEntry } from '../firebase/aiChapters'
import { refreshAiContent } from '../firebase/aiContent'
import { getContentChapterOrder } from '../data/progression'

/** Sentinel generatingChapterId while generateNewChapter's call is in flight —
 * there's no chapterId to key on yet (the server assigns one). */
export const GENERATING_NEW_CHAPTER = '__new__'

interface ContentState {
  aiChapters: Record<string, AiChapterEntry>
  generatingChapterId: string | null
  loadAiChapters: () => Promise<void>
  generateNewChapter: () => Promise<{ ok: true; chapterId: string } | { ok: false; message: string }>
  /** Fire-and-forget: call whenever a player starts a level. Every chapter is
   * generated on demand now (no more fixed roster) — if that level's chapter is
   * the current content frontier (the newest chapter anyone has content for),
   * kicks off generating the next one in the background, so by the time anyone
   * actually reaches it, it's already there (or at least already in progress),
   * instead of waiting for a star threshold and a manual button press. No-op if
   * a generation is already running or chapterId isn't the frontier. */
  ensureNextChapterGenerating: (chapterId: string) => void
}

export const useContentStore = create<ContentState>((set, get) => ({
  aiChapters: {},
  generatingChapterId: null,

  loadAiChapters: async () => {
    await ensureAiChaptersLoaded()
    const aiChapters = getLoadedAiChapters()
    set({ aiChapters })
    // Bootstrap: a brand-new install (or a freshly wiped database) has no
    // chapters at all yet — nothing would ever call ensureNextChapterGenerating
    // in that state (it only fires from starting a level, and there's no level
    // to start), so kick off the very first chapter here instead.
    if (Object.keys(aiChapters).length === 0 && !get().generatingChapterId) {
      void get().generateNewChapter()
    }
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

  ensureNextChapterGenerating: (chapterId) => {
    if (get().generatingChapterId) return
    const extraLevels = Object.values(get().aiChapters).flatMap((e) => e.levels)
    const contentOrder = getContentChapterOrder(extraLevels)
    if (contentOrder[contentOrder.length - 1] !== chapterId) return // not the newest chapter with content
    void get().generateNewChapter()
  },
}))
