// Checkpoint-based Firestore sync (spec section 47/48): the in-progress board never
// touches this file — only src/store/playerStore.ts's already-checkpointed writes
// (level win, coin spend, mission claim, settings change) flow through here, and
// only when firebaseEnabled. firebase/firestore is imported dynamically so it never
// enters the bundle for a build that doesn't configure Firebase (see config.ts).

import { getFirebase } from './config'

export async function loadProfile<T>(uid: string): Promise<(T & { updatedAt?: number }) | null> {
  const fb = await getFirebase()
  if (!fb) return null
  const { doc, getDoc } = await import('firebase/firestore')
  const snap = await getDoc(doc(fb.db, 'users', uid))
  if (!snap.exists()) return null
  return snap.data() as T & { updatedAt?: number }
}

export async function saveProfile(uid: string, data: unknown): Promise<void> {
  const fb = await getFirebase()
  if (!fb) return
  const { doc, setDoc, serverTimestamp } = await import('firebase/firestore')
  await setDoc(doc(fb.db, 'users', uid), { ...(data as object), updatedAt: serverTimestamp() }, { merge: true })
}
