// Client side of the "auto-generate the next chapter" feature: reads chapters the
// Cloud Function functions/src/index.ts's generateNextChapterNow has already
// produced (public, read-only `aiChapters/{chapterId}` collection — see
// firestore.rules), and can call that function to generate one on demand.
//
// Like src/firebase/aiContent.ts, this is a small module-level cache, not a store:
// the game must keep working with zero AI chapters (Firebase disabled, offline, or
// nothing generated yet) exactly as it always has. src/store/contentStore.ts wraps
// this in a reactive Zustand store so UI can re-render when content shows up.

import type { LevelConfig } from '../engine/types'
import { getFirebase } from './config'

/** The 3 placeholder chapters from src/data/chapters.ts that scripts/generate-
 * levels.ts's PLAN deliberately leaves with zero hand-authored levels (see that
 * file's comment) — the only chapterIds the Cloud Function will ever generate. */
export const AI_CHAPTER_IDS = ['science-world', 'history-culture', 'curious-facts'] as const

let cache: Record<string, LevelConfig[]> = {}
let loadPromise: Promise<void> | null = null

/** Whatever AI-generated chapters have been loaded so far, keyed by chapterId. */
export function getLoadedAiChapters(): Record<string, LevelConfig[]> {
  return cache
}

/** Starts the one-time background fetch of already-generated chapters, if it
 * hasn't already. Safe to call from anywhere, any number of times. Never rejects. */
export function ensureAiChaptersLoaded(): Promise<void> {
  if (!loadPromise) loadPromise = loadAiChapters()
  return loadPromise
}

async function loadAiChapters(): Promise<void> {
  try {
    const fb = await getFirebase()
    if (!fb) return
    const { collection, getDocs, query, where } = await import('firebase/firestore')
    const snap = await getDocs(query(collection(fb.db, 'aiChapters'), where('status', '==', 'ready')))
    const next: Record<string, LevelConfig[]> = {}
    snap.forEach((doc) => {
      const data = doc.data() as { levels?: LevelConfig[] }
      if (Array.isArray(data.levels) && data.levels.length > 0) next[doc.id] = data.levels
    })
    cache = next
  } catch (err) {
    console.error('[firebase] failed to load AI-generated chapters', err)
  }
}

export type GenerateChapterResult =
  | { ok: true; levels: LevelConfig[] }
  | { ok: false; message: string }

/** Calls generateNextChapterNow for chapterId (an AI_CHAPTER_IDS member). Updates
 * the local cache on success so getLoadedAiChapters() reflects it immediately. */
export async function requestChapterGeneration(chapterId: string): Promise<GenerateChapterResult> {
  const fb = await getFirebase()
  if (!fb) return { ok: false, message: '雲端同步尚未啟用' }
  try {
    const { httpsCallable } = await import('firebase/functions')
    const call = httpsCallable<{ chapterId: string }, { chapterId: string; levels: LevelConfig[] }>(
      fb.functions,
      'generateNextChapterNow',
      // The default client timeout (~70s) is shorter than this actually takes
      // (OpenAI + a solver-verified 5-level curve routinely runs 60-90s+) — match
      // the server's own onCall({ timeoutSeconds: 300 }) so a real slow run isn't
      // reported as "failed" while it's still working server-side.
      { timeout: 300_000 },
    )
    const result = await call({ chapterId })
    cache = { ...cache, [chapterId]: result.data.levels }
    return { ok: true, levels: result.data.levels }
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code === 'functions/already-exists') {
      return { ok: false, message: '這個章節正在生成中，請稍後再回來看看' }
    }
    if (code === 'functions/deadline-exceeded') {
      // The call itself timed out, but generation may still finish server-side
      // and land in Firestore for the next load — see ensureAiChaptersLoaded().
      return { ok: false, message: '生成時間較長，請稍後重新整理再確認章節是否已完成' }
    }
    console.error('[firebase] generateNextChapterNow failed', err)
    return { ok: false, message: '生成失敗，請稍後再試一次' }
  }
}
