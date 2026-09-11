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

/** Popup-path failures where a full-page redirect is worth trying instead of just
 * surfacing the error — a blocked/cancelled popup doesn't mean the user doesn't
 * want to sign in, just that this browser/setting won't allow the popup. */
const POPUP_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/cancelled-popup-request',
  'auth/operation-not-supported-in-this-environment',
])

/**
 * Links the current anonymous user to a Google account — never creates a fresh
 * account, so existing local/cloud progress under this uid is preserved. If the
 * Google account is already tied to a different Firebase user, this rejects with
 * `auth/credential-already-in-use`; the caller should offer the player a choice
 * rather than silently discarding either side's progress (see docs/firebase.md).
 *
 * Tries a popup first; if the browser won't allow one (POPUP_FALLBACK_CODES —
 * common in Safari, private/incognito windows, or strict popup-blocker settings),
 * falls back to a full-page redirect instead of just failing. A redirect navigates
 * away, so this never resolves in that case — completeGoogleLinkRedirect() picks
 * up the result after Firebase brings the player back to this page.
 */
export async function linkGoogleAccount(): Promise<AuthState> {
  const fb = await getFirebase()
  if (!fb || !fb.auth.currentUser) {
    throw new Error('Firebase is not enabled or no user is signed in yet')
  }
  const { linkWithPopup, linkWithRedirect, GoogleAuthProvider } = await import('firebase/auth')
  const provider = new GoogleAuthProvider()
  try {
    const result = await linkWithPopup(fb.auth.currentUser, provider)
    return describeUser(result.user)
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code && POPUP_FALLBACK_CODES.has(code)) {
      await linkWithRedirect(fb.auth.currentUser, provider) // navigates away — never returns
    }
    throw err
  }
}

/**
 * Call once at app startup, after the current user is available, to pick up a
 * Google link that just completed via linkGoogleAccount()'s redirect fallback.
 * Resolves to null when there's no pending redirect result — the overwhelmingly
 * common case (nothing to do here on a normal page load).
 */
export async function completeGoogleLinkRedirect(): Promise<AuthState | null> {
  const fb = await getFirebase()
  if (!fb) return null
  const { getRedirectResult } = await import('firebase/auth')
  const result = await getRedirectResult(fb.auth).catch((err) => {
    console.error('[firebase] Google redirect link failed', err)
    return null
  })
  if (!result) return null
  return describeUser(result.user)
}
