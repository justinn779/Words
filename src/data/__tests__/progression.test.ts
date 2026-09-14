import { describe, expect, it } from 'vitest'
import {
  CONTENT_CHAPTER_ORDER,
  getChapterLevels,
  getChapterMaxStars,
  getContentChapterOrder,
  hasContent,
  isChapterUnlocked,
  isLevelUnlocked,
  isNextNewChapterGateOpen,
} from '../progression'
import type { LevelConfig } from '../../engine/types'

function fakeLevel(chapterId: string, id: string): LevelConfig {
  return {
    id,
    chapterId,
    difficulty: 'easy',
    categoryIds: ['x'],
    columnCount: 4,
    categorySlotCount: 2,
    deckEnabled: false,
    deckSize: 0,
    targetThreeStarMoves: 10,
    targetTwoStarMoves: 12,
    targetThreeStarTime: 60,
    targetTwoStarTime: 90,
  }
}

describe('progression', () => {
  it('every content chapter has at least one level', () => {
    for (const chapterId of CONTENT_CHAPTER_ORDER) {
      expect(getChapterLevels(chapterId).length).toBeGreaterThan(0)
    }
  })

  it('the first content chapter is always unlocked', () => {
    expect(isChapterUnlocked(CONTENT_CHAPTER_ORDER[0], {})).toBe(true)
  })

  it('a later content chapter is locked with no progress', () => {
    expect(isChapterUnlocked(CONTENT_CHAPTER_ORDER[1], {})).toBe(false)
  })

  it('a later chapter unlocks once the previous chapter has enough stars', () => {
    const chapterId = CONTENT_CHAPTER_ORDER[0]
    const nextId = CONTENT_CHAPTER_ORDER[1]
    const levels = getChapterLevels(chapterId)
    const maxStars = getChapterMaxStars(chapterId)

    // Award 3 stars per level until we cross the 50% threshold.
    const records: Record<string, { bestStars: 0 | 1 | 2 | 3 }> = {}
    let earned = 0
    for (const level of levels) {
      if (earned >= Math.ceil(maxStars * 0.5)) break
      records[level.id] = { bestStars: 3 }
      earned += 3
    }
    expect(isChapterUnlocked(nextId, records)).toBe(true)
  })

  it('a chapter with no authored levels is never unlockable', () => {
    expect(hasContent('science-world')).toBe(false)
    expect(isChapterUnlocked('science-world', {})).toBe(false)
  })

  it('within a chapter, only the first level starts unlocked', () => {
    const chapterId = CONTENT_CHAPTER_ORDER[0]
    expect(isLevelUnlocked(chapterId, 0, {})).toBe(true)
    expect(isLevelUnlocked(chapterId, 1, {})).toBe(false)
  })

  it('completing a level unlocks the next one', () => {
    const chapterId = CONTENT_CHAPTER_ORDER[0]
    const levels = getChapterLevels(chapterId)
    const records = { [levels[0].id]: { bestStars: 1 as const } }
    expect(isLevelUnlocked(chapterId, 1, records)).toBe(true)
  })

  it('orders AI-filled placeholder chapters by their canonical position, not extraLevels array order', () => {
    // history-culture's levels appear BEFORE science-world's in extraLevels here —
    // exactly the case a Firestore query with no orderBy could produce. The
    // combined order must still put science-world first (its canonical position
    // in src/data/chapters.ts).
    const extraLevels = [fakeLevel('history-culture', 'history-culture-01'), fakeLevel('science-world', 'science-world-01')]
    const order = getContentChapterOrder(extraLevels)
    expect(order.indexOf('science-world')).toBeLessThan(order.indexOf('history-culture'))
  })

  it('orders entirely new ai-chapter-N chapters after every chapters.ts entry, by numeric order', () => {
    const extraLevels = [fakeLevel('ai-chapter-10', 'ai-chapter-10-01'), fakeLevel('ai-chapter-9', 'ai-chapter-9-01')]
    const order = getContentChapterOrder(extraLevels)
    expect(order.indexOf('ai-chapter-9')).toBeLessThan(order.indexOf('ai-chapter-10'))
    expect(order.indexOf('ai-chapter-9')).toBeGreaterThan(order.indexOf(CONTENT_CHAPTER_ORDER[CONTENT_CHAPTER_ORDER.length - 1]))
  })

  it('the new-chapter gate stays closed until the last known chapter has enough stars', () => {
    const extraLevels = [fakeLevel('ai-chapter-9', 'ai-chapter-9-01')]
    expect(isNextNewChapterGateOpen({}, extraLevels)).toBe(false)
    const records = { 'ai-chapter-9-01': { bestStars: 3 as const } }
    expect(isNextNewChapterGateOpen(records, extraLevels)).toBe(true)
  })
})
