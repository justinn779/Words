// Phase 8 — Achievements. Each is a pure predicate over cumulative Statistics;
// playerStore re-evaluates all of them after every win and unlocks any that newly
// pass, so there's exactly one place ("did the stats cross this line") that can
// ever be wrong.

export interface Statistics {
  totalLevelsCompleted: number
  totalCategoriesCompleted: number
  totalStars: number
  levelsCompletedNoHint: number
  hardLevelsCompleted: number
  fastEasyClears: number
  libraryItemsOwned: number
  dailyStreak: number
}

export interface AchievementDef {
  id: string
  name: string
  description: string
  check: (stats: Statistics) => boolean
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-three-star', name: '初次三星', description: '第一次以三星完成關卡', check: (s) => s.totalStars >= 3 && s.totalLevelsCompleted >= 1 },
  { id: 'first-hard-clear', name: '挑戰困難', description: '第一次完成困難難度關卡', check: (s) => s.hardLevelsCompleted >= 1 },
  { id: 'categories-10', name: '分類新手', description: '累積完成 10 個分類', check: (s) => s.totalCategoriesCompleted >= 10 },
  { id: 'categories-100', name: '分類達人', description: '累積完成 100 個分類', check: (s) => s.totalCategoriesCompleted >= 100 },
  { id: 'categories-500', name: '分類大師', description: '累積完成 500 個分類', check: (s) => s.totalCategoriesCompleted >= 500 },
  { id: 'no-hint-10', name: '獨立思考', description: '不使用提示完成 10 關', check: (s) => s.levelsCompletedNoHint >= 10 },
  { id: 'speed-easy-60s', name: '眼明手快', description: '60 秒內完成一個簡單關卡', check: (s) => s.fastEasyClears >= 1 },
  { id: 'library-10', name: '收藏家', description: '取得 10 件圖書館物品', check: (s) => s.libraryItemsOwned >= 10 },
  { id: 'streak-7', name: '持之以恆', description: '連續 7 天完成每日挑戰', check: (s) => s.dailyStreak >= 7 },
]
