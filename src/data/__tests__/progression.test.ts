import { describe, expect, it } from 'vitest'
import {
  CONTENT_CHAPTER_ORDER,
  getChapterLevels,
  getChapterMaxStars,
  hasContent,
  isChapterUnlocked,
  isLevelUnlocked,
} from '../progression'

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
})
