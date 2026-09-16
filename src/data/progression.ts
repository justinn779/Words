// Phase 4 meta-progression rules: which chapters/levels are unlocked given the
// player's saved best stars per level. Kept as pure functions over data (no store
// dependency) so they're trivially testable and reusable from both the UI and,
// later, from a Firestore-backed profile without any change in shape.
//
// Every chapter is now AI-generated on demand (functions/src/index.ts's
// generateNewChapterNow) — there is no fixed roster or hand-authored content
// anymore. Chapters are named `ai-chapter-{order}`, order assigned sequentially
// server-side starting at 1, and this module never sees a chapter it doesn't
// already have `extraLevels` for.

import type { LevelConfig } from '../engine/types'

export interface LevelRecordLike {
  bestStars: 0 | 1 | 2 | 3
}

export type LevelRecords = Record<string, LevelRecordLike | undefined>

/** Fraction of a chapter's max stars required to unlock the next chapter. */
const UNLOCK_STAR_FRACTION = 0.5

/** Chapter ids are `ai-chapter-{order}` — see functions/src/index.ts's
 * generateNewChapterNow. */
const CHAPTER_ID_RE = /^ai-chapter-(\d+)$/

function chapterOrder(chapterId: string): number {
  const match = CHAPTER_ID_RE.exec(chapterId)
  return match ? Number(match[1]) : Infinity
}

/** Every chapter with content, in play order — derived purely from whichever
 * chapterIds appear in `extraLevels` (sourced from Firestore's `aiChapters`
 * collection via src/store/contentStore.ts), sorted by their numeric order.
 * extraLevels' own array order isn't guaranteed (a Firestore collection query
 * has no `orderBy` here), so this always re-derives order from the id itself
 * rather than trusting array position — see git history for the corruption a
 * naive "trust array order" version caused. */
export function getContentChapterOrder(extraLevels: LevelConfig[] = []): string[] {
  const ids = new Set<string>()
  for (const level of extraLevels) ids.add(level.chapterId)
  return [...ids].sort((a, b) => chapterOrder(a) - chapterOrder(b))
}

export function getChapterLevels(chapterId: string, extraLevels: LevelConfig[] = []): LevelConfig[] {
  return extraLevels.filter((l) => l.chapterId === chapterId)
}

export function getChapterStars(chapterId: string, records: LevelRecords, extraLevels: LevelConfig[] = []): number {
  return getChapterLevels(chapterId, extraLevels).reduce((sum, l) => sum + (records[l.id]?.bestStars ?? 0), 0)
}

export function getChapterMaxStars(chapterId: string, extraLevels: LevelConfig[] = []): number {
  return getChapterLevels(chapterId, extraLevels).length * 3
}

/** Chapters outside getContentChapterOrder() (not generated yet) are never
 * unlockable. */
export function hasContent(chapterId: string, extraLevels: LevelConfig[] = []): boolean {
  return getContentChapterOrder(extraLevels).includes(chapterId)
}

export function isChapterUnlocked(chapterId: string, records: LevelRecords, extraLevels: LevelConfig[] = []): boolean {
  const order = getContentChapterOrder(extraLevels)
  const index = order.indexOf(chapterId)
  if (index === -1) return false
  if (index === 0) return true
  const previousId = order[index - 1]
  const required = Math.ceil(getChapterMaxStars(previousId, extraLevels) * UNLOCK_STAR_FRACTION)
  return getChapterStars(previousId, records, extraLevels) >= required
}

/** Whether the player has earned enough stars in the last existing chapter to
 * justify generating the next one — the single gate every chapter transition
 * now goes through (there's no separate "fill a pre-named placeholder" case
 * anymore; every chapter, including the very first, is invented on demand). No
 * chapters generated yet at all (a brand-new install) counts as open, so
 * src/store/contentStore.ts's bootstrap generation can fire immediately. */
export function isNextNewChapterGateOpen(records: LevelRecords, extraLevels: LevelConfig[] = []): boolean {
  const order = getContentChapterOrder(extraLevels)
  const lastId = order[order.length - 1]
  if (!lastId) return true
  const required = Math.ceil(getChapterMaxStars(lastId, extraLevels) * UNLOCK_STAR_FRACTION)
  return getChapterStars(lastId, records, extraLevels) >= required
}

/** Display title for a chapter: "第N章" (from its actual position in `order`)
 * plus whatever short theme title OpenAI invented for it, if any (a chapter
 * that fell back to the existing category pool with no AI-invented theme —
 * see functions/src/index.ts's fillShortfallFromExistingPool — has no title of
 * its own and just shows "第N章"). */
export function getChapterDisplayTitle(chapterId: string, order: string[], aiTitle?: string): string {
  const index = order.indexOf(chapterId)
  const chapterNumber = index === -1 ? '' : `第${index + 1}章`
  return [chapterNumber, aiTitle].filter(Boolean).join(' ') || chapterId
}

/** Within an unlocked chapter, the first level is always open; each further level
 * unlocks once the previous one has been completed at least once (>= 1 star). */
export function isLevelUnlocked(chapterId: string, levelIndex: number, records: LevelRecords, extraLevels: LevelConfig[] = []): boolean {
  if (levelIndex === 0) return true
  const levels = getChapterLevels(chapterId, extraLevels)
  const previous = levels[levelIndex - 1]
  if (!previous) return true
  return (records[previous.id]?.bestStars ?? 0) >= 1
}
