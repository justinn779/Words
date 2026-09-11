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
import { getFirebase } from './config'

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

/** How long to wait for initAuth()'s anonymous sign-in before giving up on this
 * load — firestore.rules requires a signed-in reader, and that sign-in is
 * in-flight (started by initCloud() in App.tsx) independently of this call. */
const AUTH_WAIT_TIMEOUT_MS = 8000

async function waitForSignedInUser(auth: import('firebase/auth').Auth): Promise<boolean> {
  if (auth.currentUser) return true
  const { onAuthStateChanged } = await import('firebase/auth')
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe()
      resolve(false)
    }, AUTH_WAIT_TIMEOUT_MS)
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) return
      clearTimeout(timer)
      unsubscribe()
      resolve(true)
    })
  })
}

async function loadAiContent(): Promise<void> {
  try {
    const fb = await getFirebase()
    if (!fb) return
    // firestore.rules requires request.auth != null — initAuth()'s anonymous
    // sign-in (kicked off by initCloud()) may still be in flight when this runs.
    const signedIn = await waitForSignedInUser(fb.auth)
    if (!signedIn) return
    const { collection, getDocs } = await import('firebase/firestore')
    const snap = await getDocs(collection(fb.db, 'aiCategories'))

    const categories: Category[] = []
    const words: WordEntry[] = []
    snap.forEach((doc) => {
      const data = doc.data() as { categoryId?: unknown; name?: unknown; words?: unknown }
      const categoryId = typeof data.categoryId === 'string' ? data.categoryId : doc.id
      const name = typeof data.name === 'string' ? data.name : categoryId
      const wordTexts = Array.isArray(data.words) ? data.words.filter((w): w is string => typeof w === 'string') : []
      if (wordTexts.length === 0) return

      const wordIds = wordTexts.map((_, i) => `${categoryId}-ai-${i + 1}`)
      categories.push({ id: categoryId, name, wordIds })
      wordTexts.forEach((text, i) => words.push({ id: wordIds[i], text, possibleCategoryIds: [categoryId] }))
    })

    cache = { categories, words }
  } catch (err) {
    // Never let a network/permission hiccup here affect the rest of the game.
    console.error('[firebase] failed to load AI-generated categories', err)
  }
}
