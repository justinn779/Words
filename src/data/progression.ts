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

/** Chapter ids beyond CHAPTERS' fixed roster (see functions/src/index.ts's
 * generateNewChapterNow) are named `ai-chapter-{order}`, order assigned
 * sequentially server-side. */
const DYNAMIC_CHAPTER_ID_RE = /^ai-chapter-(\d+)$/

/** Sort key for getContentChapterOrder: chapters.ts entries sort by their fixed
 * position; anything beyond that (an `ai-chapter-{n}` id) sorts after every
 * chapters.ts entry, ordered by its numeric suffix. */
function chapterSortKey(chapterId: string): number {
  const staticIndex = CHAPTERS.findIndex((c) => c.id === chapterId)
  if (staticIndex !== -1) return staticIndex
  const dynamicMatch = DYNAMIC_CHAPTER_ID_RE.exec(chapterId)
  if (dynamicMatch) return CHAPTERS.length + Number(dynamicMatch[1])
  return Infinity
}

/** CONTENT_CHAPTER_ORDER plus any AI-generated chapter ids that have content
 * loaded, ordered by chapterSortKey — NOT by extraLevels' array order.
 * extraLevels is ultimately sourced from a Firestore collection query
 * (src/firebase/aiChapters.ts) with no `orderBy`, so its result order isn't
 * guaranteed; trusting it here previously let e.g. history-culture end up ahead
 * of science-world whenever Firestore happened to return them in that order,
 * corrupting the sequential unlock chain (a chapter generated later could
 * unlock before one generated earlier). */
export function getContentChapterOrder(extraLevels: LevelConfig[] = []): string[] {
  if (extraLevels.length === 0) return CONTENT_CHAPTER_ORDER
  const extraIds = new Set<string>()
  for (const level of extraLevels) {
    if (!CONTENT_CHAPTER_ORDER.includes(level.chapterId)) extraIds.add(level.chapterId)
  }
  const sortedExtras = [...extraIds].sort((a, b) => chapterSortKey(a) - chapterSortKey(b))
  return [...CONTENT_CHAPTER_ORDER, ...sortedExtras]
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

/** Whether the player has earned enough stars in the last known chapter (in
 * getContentChapterOrder's combined order — static or AI-generated, whichever is
 * furthest) to justify generating an entirely new one beyond it. Same 50%
 * threshold as every other chapter-to-chapter unlock; unlike isChapterStarGateOpen
 * this doesn't target a specific next chapterId, since a brand-new chapter has no
 * id yet — the server assigns one (see functions/src/index.ts's
 * generateNewChapterNow and src/store/contentStore.ts's generateNewChapter). */
export function isNextNewChapterGateOpen(records: LevelRecords, extraLevels: LevelConfig[] = []): boolean {
  const order = getContentChapterOrder(extraLevels)
  const lastId = order[order.length - 1]
  if (!lastId) return false
  const required = Math.ceil(getChapterMaxStars(lastId, extraLevels) * UNLOCK_STAR_FRACTION)
  return getChapterStars(lastId, records, extraLevels) >= required
}

/** Display title for a chapter: chapters.ts entries already bake in their own
 * "第N章 ..." prefix; an AI-generated chapter beyond that roster has no such
 * prefix (its own `title`, if any, is just the short theme OpenAI invented), so
 * this derives "第N章" from the chapter's actual position in `order` instead of
 * trusting the AI to know its own number. */
export function getChapterDisplayTitle(chapterId: string, order: string[], aiTitle?: string): string {
  const staticTitle = CHAPTERS.find((c) => c.id === chapterId)?.title
  if (staticTitle) return staticTitle
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
