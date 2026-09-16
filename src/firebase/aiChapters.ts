// Client side of the "auto-generate the next chapter" feature: reads chapters the
// Cloud Functions in functions/src/index.ts have already produced (public,
// read-only `aiChapters/{chapterId}` collection — see firestore.rules), and can
// call generateNewChapterNow to invent one on demand. Every chapter — including
// the very first one — is generated this way now; there is no fixed roster or
// hand-authored content. A chapter's chapterId is `ai-chapter-{order}`, order
// assigned sequentially server-side starting at 1.
//
// Like src/firebase/aiContent.ts, this is a small module-level cache, not a store:
// the game must keep working with zero AI chapters (Firebase disabled, offline, or
// nothing generated yet) exactly as it always has. src/store/contentStore.ts wraps
// this in a reactive Zustand store so UI can re-render when content shows up.

import type { LevelConfig } from '../engine/types'
import { getFirebase, waitForSignedInUser } from './config'

export interface AiChapterEntry {
  /** The short theme OpenAI invented for this chapter — absent if generation
   * fell back entirely to the existing category pool with no AI-invented theme
   * (see functions/src/index.ts's fillShortfallFromExistingPool). */
  title?: string
  order?: number
  levels: LevelConfig[]
}

let cache: Record<string, AiChapterEntry> = {}
let anyChapterEverRequested = false
let loadPromise: Promise<void> | null = null

/** Whatever AI-generated chapters have been loaded so far, keyed by chapterId. */
export function getLoadedAiChapters(): Record<string, AiChapterEntry> {
  return cache
}

/** True if the `aiChapters` collection has ANY document at all — including one
 * still `status: 'generating'`, not just ready ones. src/store/contentStore.ts's
 * bootstrap (generate the very first chapter for a brand-new player) checks
 * this, not just getLoadedAiChapters() being empty: without it, reloading the
 * page while chapter 1 is still generating looks identical to "nothing has ever
 * been requested" and fires a second, third, ... bootstrap generation — each a
 * real, separately-billed OpenAI run — confirmed happening in testing. */
export function hasAnyChapterEverBeenRequested(): boolean {
  return anyChapterEverRequested
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
    // firestore.rules requires request.auth != null — initAuth()'s anonymous
    // sign-in (kicked off by initCloud()) may still be in flight when this runs.
    // Missing this wait was confirmed in production: this read fired before
    // sign-in settled and was rejected outright with permission-denied.
    const signedIn = await waitForSignedInUser(fb.auth)
    if (!signedIn) return
    const { collection, getDocsFromServer } = await import('firebase/firestore')
    // getDocsFromServer, not getDocs — see the comment on the equivalent read in
    // aiContent.ts's loadAiContent for why a plain collection getDocs() can miss
    // a document written moments earlier in the same session. No status filter —
    // hasAnyChapterEverBeenRequested() below needs to see 'generating'/'failed'
    // docs too, not just 'ready' ones.
    const snap = await getDocsFromServer(collection(fb.db, 'aiChapters'))
    anyChapterEverRequested = !snap.empty
    const next: Record<string, AiChapterEntry> = {}
    snap.forEach((doc) => {
      const data = doc.data() as { status?: string; levels?: LevelConfig[]; title?: string; order?: number }
      if (data.status === 'ready' && Array.isArray(data.levels) && data.levels.length > 0) {
        next[doc.id] = { levels: data.levels, title: data.title, order: data.order }
      }
    })
    cache = next
  } catch (err) {
    console.error('[firebase] failed to load AI-generated chapters', err)
  }
}

export type GenerateChapterResult =
  | { ok: true; chapterId: string; entry: AiChapterEntry }
  | { ok: false; message: string }

function describeCallError(err: unknown): string {
  const code = (err as { code?: string })?.code
  if (code === 'functions/already-exists') return '這個章節正在生成中，請稍後再回來看看'
  if (code === 'functions/deadline-exceeded') {
    // The call itself timed out, but generation may still finish server-side and
    // land in Firestore for the next load — see ensureAiChaptersLoaded().
    return '生成時間較長，請稍後重新整理再確認章節是否已完成'
  }
  console.error('[firebase] chapter generation call failed', err)
  return '生成失敗，請稍後再試一次'
}

// The default client timeout (~70s) is shorter than this actually takes (OpenAI +
// a solver-verified 5-level curve routinely runs 60-90s+) — match the server's own
// onCall({ timeoutSeconds: 300 }) so a real slow run isn't reported as "failed"
// while it's still working server-side.
const CALL_TIMEOUT_MS = 300_000

/** Calls generateNewChapterNow to invent the next chapter (theme + categories).
 * The server assigns both the chapterId (`ai-chapter-{order}`) and the theme
 * title. Updates the local cache on success so getLoadedAiChapters() reflects
 * it immediately. */
export async function requestNewChapterGeneration(): Promise<GenerateChapterResult> {
  const fb = await getFirebase()
  if (!fb) return { ok: false, message: '雲端同步尚未啟用' }
  try {
    const { httpsCallable } = await import('firebase/functions')
    const call = httpsCallable<Record<string, never>, { chapterId: string; title: string; order: number; levels: LevelConfig[] }>(
      fb.functions,
      'generateNewChapterNow',
      { timeout: CALL_TIMEOUT_MS },
    )
    const result = await call({})
    const { chapterId, title, order, levels } = result.data
    const entry: AiChapterEntry = { levels, title, order }
    cache = { ...cache, [chapterId]: entry }
    return { ok: true, chapterId, entry }
  } catch (err) {
    return { ok: false, message: describeCallError(err) }
  }
}
