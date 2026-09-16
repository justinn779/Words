// Optional, additive category content generated server-side by Cloud Functions
// (functions/src/index.ts) from OpenAI, then solver-verified before ever landing
// in Firestore's public, read-only `aiCategories` collection (see firestore.rules).
//
// This module is a small module-level cache, not a store: the game must keep
// working with zero AI content (Firebase disabled, offline, or the collection
// simply empty) exactly as it always has — see docs/firebase.md's "disabled by
// default is safe" principle. Callers read the synchronous getter and get
// whatever's loaded so far (initially nothing); ensureAiContentLoaded() kicks off
// the one-time fetch in the background and never throws.

import type { Category, WordEntry } from '../engine/types'
import { getFirebase, waitForSignedInUser } from './config'

interface AiContent {
  categories: Category[]
  words: WordEntry[]
}

let cache: AiContent = { categories: [], words: [] }
let loadPromise: Promise<void> | null = null

/** Whatever AI-generated categories/words have been loaded so far. Empty until
 * (and unless) ensureAiContentLoaded() resolves with something. */
export function getLoadedAiContent(): AiContent {
  return cache
}

/** Starts the one-time background fetch of aiCategories, if it hasn't already.
 * Safe to call from anywhere, any number of times — later calls just await the
 * same in-flight (or already-settled) load. Never rejects: a disabled/misconfigured
 * Firebase, or a read that fails, just leaves the cache empty. */
export function ensureAiContentLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = loadAiContent()
  }
  return loadPromise
}

/** Forces a fresh fetch, replacing the cache instead of reusing the one-time
 * load. Call this right after generating a new AI chapter (src/store/
 * contentStore.ts) — that chapter's own categories were just written to
 * `aiCategories` server-side (functions/src/index.ts's persistAcceptedCategories),
 * but this module's cache was already settled before then, so without a refresh
 * createGame() would throw "Unknown category id" the moment the player opens a
 * level in that chapter, in the same session, before any page reload. */
export function refreshAiContent(): Promise<void> {
  loadPromise = loadAiContent()
  return loadPromise
}

interface AiCategoryDocLike {
  categoryId?: unknown
  name?: unknown
  words?: unknown
  createdAt?: { toMillis?: () => number }
}

function parseCategoryDoc(docId: string, data: AiCategoryDocLike): { category: Category; words: WordEntry[] } | null {
  const categoryId = typeof data.categoryId === 'string' ? data.categoryId : docId
  const name = typeof data.name === 'string' ? data.name : categoryId
  const wordTexts = Array.isArray(data.words) ? data.words.filter((w): w is string => typeof w === 'string') : []
  if (wordTexts.length === 0) return null
  const wordIds = wordTexts.map((_, i) => `${categoryId}-ai-${i + 1}`)
  return {
    category: { id: categoryId, name, wordIds },
    words: wordTexts.map((text, i) => ({ id: wordIds[i], text, possibleCategoryIds: [categoryId] })),
  }
}

async function loadAiContent(): Promise<void> {
  try {
    const fb = await getFirebase()
    if (!fb) return
    // firestore.rules requires request.auth != null — initAuth()'s anonymous
    // sign-in (kicked off by initCloud()) may still be in flight when this runs.
    const signedIn = await waitForSignedInUser(fb.auth)
    if (!signedIn) return
    const { collection, getDocsFromServer } = await import('firebase/firestore')
    // getDocs() on a collection query can resolve from the SDK's local
    // cache/watch state instead of the server — confirmed by testing: a plain
    // getDocs() here missed a category written moments earlier in the same
    // session (refreshAiContent's whole reason for existing), while a direct
    // getDocFromServer() on that exact document saw it immediately. Force a real
    // server round-trip so a chapter just generated in this session is visible
    // right away, not just after a reload re-establishes a fresh cache.
    const snap = await getDocsFromServer(collection(fb.db, 'aiCategories'))

    const categories: Category[] = []
    const words: WordEntry[] = []
    snap.forEach((doc) => {
      const parsed = parseCategoryDoc(doc.id, doc.data() as AiCategoryDocLike)
      if (!parsed) return
      categories.push(parsed.category)
      words.push(...parsed.words)
    })

    cache = { categories, words }
  } catch (err) {
    // Never let a network/permission hiccup here affect the rest of the game.
    console.error('[firebase] failed to load AI-generated categories', err)
  }
}

const dailyPoolCache = new Map<number, Promise<AiContent>>()

/** Same category source as getLoadedAiContent, but only categories created
 * strictly before `cutoffMs` — used by Daily Challenge (src/data/
 * dailyChallenge.ts) so every player who opens a given day's challenge, no
 * matter when during that day, draws from the exact same category pool.
 * Without this cutoff, a category accepted mid-day would silently join the
 * pool for players who load after it but not before, breaking the "everyone
 * gets the same board on the same day" guarantee a shared-seed daily challenge
 * depends on. Memoized per cutoff so replaying the same day doesn't re-query. */
export function loadAiCategoriesCreatedBefore(cutoffMs: number): Promise<AiContent> {
  const cached = dailyPoolCache.get(cutoffMs)
  if (cached) return cached
  const promise = (async (): Promise<AiContent> => {
    try {
      const fb = await getFirebase()
      if (!fb) return { categories: [], words: [] }
      const signedIn = await waitForSignedInUser(fb.auth)
      if (!signedIn) return { categories: [], words: [] }
      const { collection, getDocsFromServer } = await import('firebase/firestore')
      const snap = await getDocsFromServer(collection(fb.db, 'aiCategories'))
      const categories: Category[] = []
      const words: WordEntry[] = []
      snap.forEach((doc) => {
        const data = doc.data() as AiCategoryDocLike
        const createdAtMs = data.createdAt?.toMillis?.() ?? 0
        if (createdAtMs >= cutoffMs) return // too new — not part of that day's shared pool
        const parsed = parseCategoryDoc(doc.id, data)
        if (!parsed) return
        categories.push(parsed.category)
        words.push(...parsed.words)
      })
      return { categories, words }
    } catch (err) {
      console.error('[firebase] failed to load date-cutoff AI categories', err)
      return { categories: [], words: [] }
    }
  })()
  dailyPoolCache.set(cutoffMs, promise)
  return promise
}
