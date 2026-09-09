// Auth flow per docs/firebase.md: anonymous by default, with an explicit later
// upgrade to a linked Google account that preserves the same uid and all progress.
//
// All firebase/auth imports below are dynamic (inside the functions that need them)
// so the SDK is never pulled into the bundle for a build that doesn't configure
// Firebase at all — see src/firebase/config.ts's getFirebase().

import type { User } from 'firebase/auth'
import { getFirebase, firebaseEnabled } from './config'

export type AuthStatus = 'disabled' | 'signed-out' | 'anonymous' | 'google'

export interface AuthState {
  status: AuthStatus
  uid: string | null
  displayName: string | null
}

function describeUser(user: User | null): AuthState {
  if (!user) return { status: 'signed-out', uid: null, displayName: null }
  const isGoogleLinked = user.providerData.some((p) => p.providerId === 'google.com')
  return { status: isGoogleLinked ? 'google' : 'anonymous', uid: user.uid, displayName: user.displayName }
}

/**
 * Ensures a signed-in user exists (creating an anonymous one on first launch) and
 * calls `onChange` with the current auth state whenever it changes. Returns an
 * unsubscribe function (synchronously — before the async Firebase setup resolves —
 * so callers can always clean up in a `useEffect` without awaiting). A no-op that
 * immediately reports 'disabled' when Firebase isn't configured.
 */
export function initAuth(onChange: (state: AuthState) => void): () => void {
  if (!firebaseEnabled) {
    onChange({ status: 'disabled', uid: null, displayName: null })
    return () => {}
  }

  let unsubscribed = false
  let unsubscribeFn: (() => void) | null = null

  getFirebase().then(async (fb) => {
    if (!fb || unsubscribed) return
    const { onAuthStateChanged, signInAnonymously } = await import('firebase/auth')
    unsubscribeFn = onAuthStateChanged(fb.auth, (user) => {
      if (!user) {
        signInAnonymously(fb.auth).catch((err) => console.error('[firebase] anonymous sign-in failed', err))
        return
      }
      onChange(describeUser(user))
    })
  })

  return () => {
    unsubscribed = true
    unsubscribeFn?.()
  }
}

/**
 * Links the current anonymous user to a Google account — never creates a fresh
 * account, so existing local/cloud progress under this uid is preserved. If the
 * Google account is already tied to a different Firebase user, this rejects with
 * `auth/credential-already-in-use`; the caller should offer the player a choice
 * rather than silently discarding either side's progress (see docs/firebase.md).
 */
export async function linkGoogleAccount(): Promise<AuthState> {
  const fb = await getFirebase()
  if (!fb || !fb.auth.currentUser) {
    throw new Error('Firebase is not enabled or no user is signed in yet')
  }
  const { linkWithPopup, GoogleAuthProvider } = await import('firebase/auth')
  const result = await linkWithPopup(fb.auth.currentUser, new GoogleAuthProvider())
  return describeUser(result.user)
}
