import { describe, expect, it } from 'vitest'
import {
  getChapterLevels,
  getChapterMaxStars,
  getContentChapterOrder,
  hasContent,
  isChapterUnlocked,
  isLevelUnlocked,
  isNextNewChapterGateOpen,
  getChapterDisplayTitle,
} from '../progression'
import type { LevelConfig } from '../../engine/types'

function fakeLevel(chapterId: string, id: string): LevelConfig {
  return {
    id,
    chapterId,
    difficulty: 'easy',
    categoryIds: ['x'],
    columnCount: 3,
    categorySlotCount: 2,
    deckEnabled: false,
    deckSize: 0,
    targetThreeStarMoves: 10,
    targetTwoStarMoves: 12,
    targetThreeStarTime: 60,
    targetTwoStarTime: 90,
  }
}

function fakeChapterLevels(chapterId: string, count: number): LevelConfig[] {
  return Array.from({ length: count }, (_, i) => fakeLevel(chapterId, `${chapterId}-${String(i + 1).padStart(2, '0')}`))
}

describe('progression', () => {
  it('an empty extraLevels means no chapters have content', () => {
    expect(getContentChapterOrder([])).toEqual([])
    expect(hasContent('ai-chapter-1', [])).toBe(false)
  })

  it('the first chapter is always unlocked once it has content', () => {
    const extraLevels = fakeChapterLevels('ai-chapter-1', 3)
    expect(isChapterUnlocked('ai-chapter-1', {}, extraLevels)).toBe(true)
  })

  it('a later chapter is locked with no progress', () => {
    const extraLevels = [...fakeChapterLevels('ai-chapter-1', 3), ...fakeChapterLevels('ai-chapter-2', 3)]
    expect(isChapterUnlocked('ai-chapter-2', {}, extraLevels)).toBe(false)
  })

  it('a later chapter unlocks once the previous chapter has enough stars', () => {
    const extraLevels = [...fakeChapterLevels('ai-chapter-1', 3), ...fakeChapterLevels('ai-chapter-2', 3)]
    const levels = getChapterLevels('ai-chapter-1', extraLevels)
    const maxStars = getChapterMaxStars('ai-chapter-1', extraLevels)

    // Award 3 stars per level until we cross the 50% threshold.
    const records: Record<string, { bestStars: 0 | 1 | 2 | 3 }> = {}
    let earned = 0
    for (const level of levels) {
      if (earned >= Math.ceil(maxStars * 0.5)) break
      records[level.id] = { bestStars: 3 }
      earned += 3
    }
    expect(isChapterUnlocked('ai-chapter-2', records, extraLevels)).toBe(true)
  })

  it('a chapter that has not been generated yet is never unlockable', () => {
    const extraLevels = fakeChapterLevels('ai-chapter-1', 3)
    expect(hasContent('ai-chapter-2', extraLevels)).toBe(false)
    expect(isChapterUnlocked('ai-chapter-2', {}, extraLevels)).toBe(false)
  })

  it('within a chapter, only the first level starts unlocked', () => {
    const extraLevels = fakeChapterLevels('ai-chapter-1', 3)
    expect(isLevelUnlocked('ai-chapter-1', 0, {}, extraLevels)).toBe(true)
    expect(isLevelUnlocked('ai-chapter-1', 1, {}, extraLevels)).toBe(false)
  })

  it('completing a level unlocks the next one', () => {
    const extraLevels = fakeChapterLevels('ai-chapter-1', 3)
    const records = { [extraLevels[0].id]: { bestStars: 1 as const } }
    expect(isLevelUnlocked('ai-chapter-1', 1, records, extraLevels)).toBe(true)
  })

  it('orders chapters by their numeric ai-chapter-N suffix, not extraLevels array order', () => {
    // chapter 10's levels appear BEFORE chapter 9's here — exactly the case a
    // Firestore query with no orderBy could produce. The combined order must
    // still put chapter 9 first.
    const extraLevels = [fakeLevel('ai-chapter-10', 'ai-chapter-10-01'), fakeLevel('ai-chapter-9', 'ai-chapter-9-01')]
    const order = getContentChapterOrder(extraLevels)
    expect(order.indexOf('ai-chapter-9')).toBeLessThan(order.indexOf('ai-chapter-10'))
  })

  it('the new-chapter gate is open when nothing has been generated yet, then tracks the last chapter\'s stars', () => {
    expect(isNextNewChapterGateOpen({}, [])).toBe(true)

    const extraLevels = fakeChapterLevels('ai-chapter-1', 3)
    expect(isNextNewChapterGateOpen({}, extraLevels)).toBe(false)
    const records = Object.fromEntries(extraLevels.map((l) => [l.id, { bestStars: 3 as const }]))
    expect(isNextNewChapterGateOpen(records, extraLevels)).toBe(true)
  })

  it('display title falls back to "第N章" when a chapter has no AI-invented title', () => {
    const order = ['ai-chapter-1', 'ai-chapter-2']
    expect(getChapterDisplayTitle('ai-chapter-2', order)).toBe('第2章')
    expect(getChapterDisplayTitle('ai-chapter-2', order, '復古科技')).toBe('第2章 復古科技')
  })
})
