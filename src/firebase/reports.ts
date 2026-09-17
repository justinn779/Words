// Client side of the "report an unsolvable level" feature: a player-facing escape
// hatch for the rare level the offline/AI solver budget (src/engine/generator.ts)
// didn't manage to verify, or that broke some other way. Reports never block or
// alter gameplay themselves — they just notify the developer (functions/src/
// index.ts's reportUnsolvableLevel relays to Telegram/Email) so the specific
// level can be fixed and re-verified by hand.

import { getFirebase, waitForSignedInUser } from './config'

export type ReportResult = { ok: true } | { ok: false; message: string }

/** Calls reportUnsolvableLevel. Requires Firebase to be configured and signed in
 * (same anonymous-is-fine gate as every other callable here) — without it, there's
 * no way to relay the report anywhere, so this fails softly rather than pretending
 * to succeed. */
export async function reportUnsolvableLevel(levelId: string, difficulty: string): Promise<ReportResult> {
  const fb = await getFirebase()
  if (!fb) return { ok: false, message: '雲端同步尚未啟用，無法送出回報' }
  const signedIn = await waitForSignedInUser(fb.auth)
  if (!signedIn) return { ok: false, message: '尚未登入，請稍後再試' }
  try {
    const { httpsCallable } = await import('firebase/functions')
    const call = httpsCallable<{ levelId: string; difficulty: string }, { ok: true }>(fb.functions, 'reportUnsolvableLevel')
    await call({ levelId, difficulty })
    return { ok: true }
  } catch (err) {
    console.error('[firebase] reportUnsolvableLevel failed', err)
    return { ok: false, message: '回報失敗，請稍後再試' }
  }
}
