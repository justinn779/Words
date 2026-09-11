// Phase 4 meta-progression rules: which chapters/levels are unlocked given the
// player's saved best stars per level. Kept as pure functions over data (no store
// dependency) so they're trivially testable and reusable from both the UI and, later,
// from a Firestore-backed profile without any change in shape.

import { LEVELS } from './levels'
import { CHAPTERS } from './chapters'
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

/** Every function below takes an optional `extraLevels` (default none) so
 * AI-generated chapters (src/firebase/aiChapters.ts, src/store/contentStore.ts —
 * fetched/generated at runtime, so they can't live in the static LEVELS import)
 * can be merged in without this module taking on a store dependency. Passing
 * nothing keeps every function's behavior identical to the hand-authored-only game. */
function allLevels(extraLevels: LevelConfig[] = []): LevelConfig[] {
  return extraLevels.length > 0 ? [...LEVELS, ...extraLevels] : LEVELS
}

/** CONTENT_CHAPTER_ORDER plus any AI-generated chapter ids that have content
 * loaded, in extraLevels' chapter-appearance order. */
export function getContentChapterOrder(extraLevels: LevelConfig[] = []): string[] {
  if (extraLevels.length === 0) return CONTENT_CHAPTER_ORDER
  const extraIds: string[] = []
  for (const level of extraLevels) {
    if (!CONTENT_CHAPTER_ORDER.includes(level.chapterId) && !extraIds.includes(level.chapterId)) {
      extraIds.push(level.chapterId)
    }
  }
  return [...CONTENT_CHAPTER_ORDER, ...extraIds]
}

export function getChapterLevels(chapterId: string, extraLevels: LevelConfig[] = []): LevelConfig[] {
  return allLevels(extraLevels).filter((l) => l.chapterId === chapterId)
}

export function getChapterStars(chapterId: string, records: LevelRecords, extraLevels: LevelConfig[] = []): number {
  return getChapterLevels(chapterId, extraLevels).reduce((sum, l) => sum + (records[l.id]?.bestStars ?? 0), 0)
}

export function getChapterMaxStars(chapterId: string, extraLevels: LevelConfig[] = []): number {
  return getChapterLevels(chapterId, extraLevels).length * 3
}

/** Chapters outside getContentChapterOrder() (no levels authored or AI-generated
 * yet) are never unlockable. */
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

/** Star-gate check against the FULL chapter roster from src/data/chapters.ts
 * (including chapters with no content yet, like the AI-generated placeholders) —
 * unlike isChapterUnlocked, this doesn't require chapterId itself to have content.
 * Used to decide whether a not-yet-generated AI chapter is eligible to be
 * generated right now (its predecessor must exist and be far enough along). */
export function isChapterStarGateOpen(chapterId: string, records: LevelRecords, extraLevels: LevelConfig[] = []): boolean {
  const order = CHAPTERS.map((c) => c.id)
  const index = order.indexOf(chapterId)
  if (index <= 0) return index === 0
  const previousId = order[index - 1]
  if (!hasContent(previousId, extraLevels)) return false
  const required = Math.ceil(getChapterMaxStars(previousId, extraLevels) * UNLOCK_STAR_FRACTION)
  return getChapterStars(previousId, records, extraLevels) >= required
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
