// Phase 4 meta-progression rules: which chapters/levels are unlocked given the
// player's saved best stars per level. Kept as pure functions over data (no store
// dependency) so they're trivially testable and reusable from both the UI and, later,
// from a Firestore-backed profile without any change in shape.

import { LEVELS } from './levels'
import type { LevelConfig } from '../engine/types'

export interface LevelRecordLike {
  bestStars: 0 | 1 | 2 | 3
}

export type LevelRecords = Record<string, LevelRecordLike | undefined>

/** Content chapters in play order. Chapters not listed here have no levels yet and
 * are always shown as locked/"coming soon" regardless of player progress. */
export const CONTENT_CHAPTER_ORDER = ['daily-life', 'natural-world', 'food-culture', 'world-travel', 'arts-entertainment']

/** Fraction of a chapter's max stars required to unlock the next chapter. */
const UNLOCK_STAR_FRACTION = 0.5

export function getChapterLevels(chapterId: string): LevelConfig[] {
  return LEVELS.filter((l) => l.chapterId === chapterId)
}

export function getChapterStars(chapterId: string, records: LevelRecords): number {
  return getChapterLevels(chapterId).reduce((sum, l) => sum + (records[l.id]?.bestStars ?? 0), 0)
}

export function getChapterMaxStars(chapterId: string): number {
  return getChapterLevels(chapterId).length * 3
}

/** Chapters outside CONTENT_CHAPTER_ORDER (no levels authored yet) are never unlockable. */
export function hasContent(chapterId: string): boolean {
  return CONTENT_CHAPTER_ORDER.includes(chapterId)
}

export function isChapterUnlocked(chapterId: string, records: LevelRecords): boolean {
  const index = CONTENT_CHAPTER_ORDER.indexOf(chapterId)
  if (index === -1) return false
  if (index === 0) return true
  const previousId = CONTENT_CHAPTER_ORDER[index - 1]
  const required = Math.ceil(getChapterMaxStars(previousId) * UNLOCK_STAR_FRACTION)
  return getChapterStars(previousId, records) >= required
}

/** Within an unlocked chapter, the first level is always open; each further level
 * unlocks once the previous one has been completed at least once (>= 1 star). */
export function isLevelUnlocked(chapterId: string, levelIndex: number, records: LevelRecords): boolean {
  if (levelIndex === 0) return true
  const levels = getChapterLevels(chapterId)
  const previous = levels[levelIndex - 1]
  if (!previous) return true
  return (records[previous.id]?.bestStars ?? 0) >= 1
}
