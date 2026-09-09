// Firebase is entirely optional at runtime: every field below must be present in
// the build's env for it to activate. Without them (the default in this repo — no
// .env is committed), `firebaseEnabled` is false and the SDK itself is never even
// downloaded — see getFirebase() below — so a player who never configures Firebase
// pays zero bundle-size cost for it. See docs/firebase.md and .env.example.

import type { FirebaseApp } from 'firebase/app'
import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'

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
}

let handlesPromise: Promise<FirebaseHandles | null> | null = null

/** Dynamically imports and initializes the Firebase SDK on first call. Resolves to
 * null (without importing anything) when Firebase isn't configured. */
export function getFirebase(): Promise<FirebaseHandles | null> {
  if (!firebaseEnabled) return Promise.resolve(null)
  if (!handlesPromise) {
    handlesPromise = Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]).then(
      ([{ initializeApp }, { getAuth }, { getFirestore }]) => {
        const app = initializeApp(config)
        return { app, auth: getAuth(app), db: getFirestore(app) }
      },
    )
  }
  return handlesPromise
}
