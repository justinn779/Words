// Firebase is entirely optional at runtime: every field below must be present in
// the build's env for it to activate. Without them (the default in this repo — no
// .env is committed), `firebaseEnabled` is false and the SDK itself is never even
// downloaded — see getFirebase() below — so a player who never configures Firebase
// pays zero bundle-size cost for it. See docs/firebase.md and .env.example.

import type { FirebaseApp } from 'firebase/app'
import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import type { Functions } from 'firebase/functions'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseEnabled = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId)

interface FirebaseHandles {
  app: FirebaseApp
  auth: Auth
  db: Firestore
  functions: Functions
}

let handlesPromise: Promise<FirebaseHandles | null> | null = null

/** Dynamically imports and initializes the Firebase SDK on first call. Resolves to
 * null (without importing anything) when Firebase isn't configured. */
export function getFirebase(): Promise<FirebaseHandles | null> {
  if (!firebaseEnabled) return Promise.resolve(null)
  if (!handlesPromise) {
    handlesPromise = Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
      import('firebase/functions'),
    ]).then(([{ initializeApp }, { getAuth }, { getFirestore }, { getFunctions }]) => {
      const app = initializeApp(config)
      return { app, auth: getAuth(app), db: getFirestore(app), functions: getFunctions(app) }
    })
  }
  return handlesPromise
}

/** How long to wait for initAuth()'s anonymous sign-in before giving up on a read
 * that needs it — firestore.rules requires a signed-in reader, and that sign-in
 * is in-flight (started by initCloud() in App.tsx) independently of the caller. */
const AUTH_WAIT_TIMEOUT_MS = 8000

/** Waits for a signed-in user (any user — anonymous is fine, everyone gets one,
 * see src/firebase/auth.ts) before a Firestore read that firestore.rules gates on
 * `request.auth != null`. Every such read needs this: without it, a read fired
 * before initAuth()'s anonymous sign-in completes gets rejected outright with
 * `permission-denied` rather than waiting — confirmed in production for both
 * src/firebase/aiContent.ts and src/firebase/aiChapters.ts before each grew its
 * own copy of this wait; shared here so a third caller doesn't have to
 * rediscover the same race. Resolves false (not an error) on timeout — callers
 * should just skip the read rather than throw, matching this module's "Firebase
 * disabled is safe" principle. */
export async function waitForSignedInUser(auth: import('firebase/auth').Auth): Promise<boolean> {
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
