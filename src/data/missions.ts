// Phase 8 — Missions. Definitions are pure data; playerStore tracks progress
// against them and resets it when the mission's period (day/week) rolls over.

export type MissionScope = 'daily' | 'weekly'

export type MissionStatKey =
  | 'levelsCompleted'
  | 'categoriesCompleted'
  | 'levelsCompletedNoHint'
  | 'hardLevelsCompleted'
  | 'starsEarned'

export interface MissionDef {
  id: string
  scope: MissionScope
  description: string
  statKey: MissionStatKey
  target: number
  rewardCoins: number
}

export const MISSIONS: MissionDef[] = [
  { id: 'daily-clear-3', scope: 'daily', description: '完成 3 關', statKey: 'levelsCompleted', target: 3, rewardCoins: 20 },
  { id: 'daily-categories-5', scope: 'daily', description: '完成 5 個分類', statKey: 'categoriesCompleted', target: 5, rewardCoins: 20 },
  { id: 'daily-no-hint-1', scope: 'daily', description: '不使用提示完成 1 關', statKey: 'levelsCompletedNoHint', target: 1, rewardCoins: 15 },
  { id: 'daily-hard-1', scope: 'daily', description: '完成一個困難關卡', statKey: 'hardLevelsCompleted', target: 1, rewardCoins: 25 },
  { id: 'weekly-categories-30', scope: 'weekly', description: '完成 30 個分類', statKey: 'categoriesCompleted', target: 30, rewardCoins: 80 },
  { id: 'weekly-stars-15', scope: 'weekly', description: '獲得 15 顆星', statKey: 'starsEarned', target: 15, rewardCoins: 80 },
  { id: 'weekly-clear-10', scope: 'weekly', description: '完成 10 關', statKey: 'levelsCompleted', target: 10, rewardCoins: 100 },
]

/** ISO-ish week key ("2026-W23") so weekly missions reset every Monday. */
export function getWeekKey(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const dayNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
