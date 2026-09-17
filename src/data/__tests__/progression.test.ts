import { describe, expect, it } from 'vitest'
import { getDifficultyForLevel, isLevelUnlocked, levelId, levelIdToNumber } from '../progression'
import type { LevelRecords } from '../progression'

describe('getDifficultyForLevel', () => {
  it('cycles easy/normal/normal/hard/normal every 5 levels', () => {
    expect(getDifficultyForLevel(1)).toBe('easy')
    expect(getDifficultyForLevel(2)).toBe('normal')
    expect(getDifficultyForLevel(3)).toBe('normal')
    expect(getDifficultyForLevel(4)).toBe('hard')
    expect(getDifficultyForLevel(5)).toBe('normal')
    expect(getDifficultyForLevel(6)).toBe('easy')
    expect(getDifficultyForLevel(9)).toBe('hard')
    expect(getDifficultyForLevel(10)).toBe('normal')
    expect(getDifficultyForLevel(11)).toBe('easy')
  })
})

describe('levelId / levelIdToNumber', () => {
  it('round-trips a level number through its id', () => {
    expect(levelId(42)).toBe('level-42')
    expect(levelIdToNumber('level-42')).toBe(42)
  })

  it('returns undefined for an id in a different shape (e.g. Daily Challenge)', () => {
    expect(levelIdToNumber('daily-2026-01-01-easy')).toBeUndefined()
  })
})

describe('isLevelUnlocked', () => {
  it('the first level is always unlocked', () => {
    expect(isLevelUnlocked(1, {})).toBe(true)
  })

  it('a later level is locked with no progress', () => {
    expect(isLevelUnlocked(2, {})).toBe(false)
  })

  it('a level unlocks once the previous one has at least 1 star', () => {
    const records: LevelRecords = { [levelId(4)]: { bestStars: 1 } }
    expect(isLevelUnlocked(5, records)).toBe(true)
    expect(isLevelUnlocked(6, records)).toBe(false)
  })
})
