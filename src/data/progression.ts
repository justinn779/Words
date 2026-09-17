// Flat level-progression rules: which level is unlocked given the player's saved
// best stars per level, and what difficulty a given level number is. Kept as pure
// functions over data (no store dependency) so they're trivially testable and
// reusable from both the UI and functions/src/index.ts (see getDifficultyForLevel).
//
// There is no chapter grouping anymore — every level is generated independently
// on demand (functions/src/index.ts's generateLevelNow) with its own randomly
// picked categories, and the whole game is one flat, endlessly-numbered sequence:
// level 1, 2, 3, .... Difficulty cycles easy/normal/hard every 3 levels.

import type { Difficulty } from '../engine/types'

export interface LevelRecordLike {
  bestStars: 0 | 1 | 2 | 3
}

export type LevelRecords = Record<string, LevelRecordLike | undefined>

const DIFFICULTY_CYCLE: Difficulty[] = ['easy', 'normal', 'hard']

/** Level numbers are 1-based; difficulty repeats in a fixed 3-level cycle
 * (1=easy, 2=normal, 3=hard, 4=easy, ...). */
export function getDifficultyForLevel(levelNumber: number): Difficulty {
  return DIFFICULTY_CYCLE[(levelNumber - 1) % DIFFICULTY_CYCLE.length]
}

const LEVEL_ID_PREFIX = 'level-'

/** The id a generated level is stored/looked up under. */
export function levelId(levelNumber: number): string {
  return `${LEVEL_ID_PREFIX}${levelNumber}`
}

/** Inverse of levelId — undefined for anything not in that shape (e.g. a Daily
 * Challenge id, which has its own unrelated format). */
export function levelIdToNumber(id: string): number | undefined {
  if (!id.startsWith(LEVEL_ID_PREFIX)) return undefined
  const n = Number(id.slice(LEVEL_ID_PREFIX.length))
  return Number.isFinite(n) ? n : undefined
}

/** The first level is always open; each further level unlocks once the
 * previous one has been completed at least once (>= 1 star). Unlike the old
 * per-chapter rule, this now applies across the entire flat sequence. */
export function isLevelUnlocked(levelNumber: number, records: LevelRecords): boolean {
  if (levelNumber <= 1) return true
  return (records[levelId(levelNumber - 1)]?.bestStars ?? 0) >= 1
}

/** The highest level number the player has actually unlocked so far (>= 1). */
export function furthestUnlockedLevel(records: LevelRecords, maxToCheck: number): number {
  let n = 1
  while (n < maxToCheck && isLevelUnlocked(n + 1, records)) n++
  return n
}
