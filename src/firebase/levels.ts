// Client side of the flat, endlessly-generated level sequence: reads levels the
// Cloud Functions in functions/src/index.ts have already produced (public,
// read-only `levels/{levelNumber}` collection — see firestore.rules), and can
// call generateLevelNow to invent one on demand. There is no chapter grouping —
// every level is independent, generated with its own randomly picked categories
// (see src/data/progression.ts for the difficulty-per-level-number rule).
//
// Like src/firebase/aiContent.ts, this is a small module-level cache, not a store:
// the game must keep working with zero generated levels (Firebase disabled,
// offline, or nothing generated yet) exactly as it always has.
// src/store/contentStore.ts wraps this in a reactive Zustand store.

import type { LevelConfig } from '../engine/types'
import { getFirebase, waitForSignedInUser } from './config'

let cache: Record<number, LevelConfig> = {}
let anyLevelEverRequested = false
let loadPromise: Promise<void> | null = null

/** Whatever generated levels have been loaded so far, keyed by level number. */
export function getLoadedLevels(): Record<number, LevelConfig> {
  return cache
}

/** True if the `levels` collection has ANY document at all — including one
 * still `status: 'generating'`, not just ready ones. src/store/contentStore.ts's
 * bootstrap (generate level 1 for a brand-new player) checks this, not just
 * getLoadedLevels() being empty — see aiChapters.ts's git history for why this
 * distinction matters (reloading mid-generation looked identical to "nothing
 * requested yet" and fired a duplicate, separately billed generation). */
export function hasAnyLevelEverBeenRequested(): boolean {
  return anyLevelEverRequested
}

/** Starts the one-time background fetch of already-generated levels, if it
 * hasn't already. Safe to call from anywhere, any number of times. Never rejects. */
export function ensureLevelsLoaded(): Promise<void> {
  if (!loadPromise) loadPromise = loadLevels()
  return loadPromise
}

/** Forces a fresh fetch, replacing the cache instead of reusing the one-time
 * load — same idea as aiContent.ts's refreshAiContent. Gives the bootstrap
 * check another chance every time the level grid is opened, not just once at
 * app startup. */
export function refreshLevels(): Promise<void> {
  loadPromise = loadLevels()
  return loadPromise
}

async function loadLevels(): Promise<void> {
  try {
    const fb = await getFirebase()
    if (!fb) return
    // firestore.rules requires request.auth != null — initAuth()'s anonymous
    // sign-in (kicked off by initCloud()) may still be in flight when this runs.
    const signedIn = await waitForSignedInUser(fb.auth)
    if (!signedIn) return
    const { collection, getDocsFromServer } = await import('firebase/firestore')
    // getDocsFromServer, not getDocs — a plain collection getDocs() can miss a
    // document written moments earlier in the same session (see aiContent.ts's
    // loadAiContent for the confirmed-in-production version of this bug).
    const snap = await getDocsFromServer(collection(fb.db, 'levels'))
    anyLevelEverRequested = !snap.empty
    const next: Record<number, LevelConfig> = {}
    snap.forEach((doc) => {
      const data = doc.data() as { status?: string; config?: LevelConfig }
      const levelNumber = Number(doc.id)
      if (data.status === 'ready' && data.config && Number.isFinite(levelNumber)) {
        next[levelNumber] = data.config
      }
    })
    cache = next
  } catch (err) {
    console.error('[firebase] failed to load generated levels', err)
  }
}

export type GenerateLevelResult = { ok: true; levelNumber: number; config: LevelConfig } | { ok: false; message: string }

function describeCallError(err: unknown): string {
  const code = (err as { code?: string })?.code
  if (code === 'functions/already-exists') return '這一關正在生成中，請稍後再回來看看'
  if (code === 'functions/deadline-exceeded') {
    // The call itself timed out, but generation may still finish server-side
    // and land in Firestore for the next load — see ensureLevelsLoaded().
    return '生成時間較長，請稍後重新整理再確認關卡是否已完成'
  }
  console.error('[firebase] level generation call failed', err)
  return '生成失敗，請稍後再試一次'
}

// Match the server's own onCall({ timeoutSeconds: 300 }) so a real slow run
// isn't reported as "failed" while it's still working server-side.
const CALL_TIMEOUT_MS = 300_000

/** Calls generateLevelNow for a specific level number. Updates the local cache
 * on success so getLoadedLevels() reflects it immediately. */
export async function requestLevelGeneration(levelNumber: number): Promise<GenerateLevelResult> {
  const fb = await getFirebase()
  if (!fb) return { ok: false, message: '雲端同步尚未啟用' }
  try {
    const { httpsCallable } = await import('firebase/functions')
    const call = httpsCallable<{ levelNumber: number }, { levelNumber: number; config: LevelConfig }>(
      fb.functions,
      'generateLevelNow',
      { timeout: CALL_TIMEOUT_MS },
    )
    const result = await call({ levelNumber })
    cache = { ...cache, [levelNumber]: result.data.config }
    return { ok: true, levelNumber, config: result.data.config }
  } catch (err) {
    return { ok: false, message: describeCallError(err) }
  }
}
