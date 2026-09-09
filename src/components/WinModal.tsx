import { motion } from 'framer-motion'
import { useGameStore } from '../store/gameStore'
import { usePlayerStore } from '../store/playerStore'
import { LEVELS } from '../data/levels'
import { ACHIEVEMENTS } from '../data/achievements'
import { LIBRARY_ITEMS } from '../data/library'

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function WinModal() {
  const game = useGameStore((s) => s.game)
  const levelConfig = useGameStore((s) => s.levelConfig)
  const score = useGameStore((s) => s.score)
  const dailyDate = useGameStore((s) => s.dailyDate)
  const winUnlocks = useGameStore((s) => s.winUnlocks)
  const startLevel = useGameStore((s) => s.startLevel)
  const startDailyLevel = useGameStore((s) => s.startDailyLevel)
  const exitLevel = useGameStore((s) => s.exitLevel)
  const animationsOn = usePlayerStore((s) => s.settings.animationsOn)

  if (!game || game.status !== 'won' || !score || !levelConfig) return null

  const chapterLevels = LEVELS.filter((l) => l.chapterId === levelConfig.chapterId)
  const levelIndex = chapterLevels.findIndex((l) => l.id === levelConfig.id)
  const nextLevel = !dailyDate ? chapterLevels[levelIndex + 1] : undefined

  const unlockedAchievements = (winUnlocks?.achievementIds ?? [])
    .map((id) => ACHIEVEMENTS.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
  const unlockedLibraryItems = (winUnlocks?.libraryItemIds ?? [])
    .map((id) => LIBRARY_ITEMS.find((i) => i.id === id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i))

  return (
    <div className="modal-overlay">
      <motion.div
        className="modal win-modal"
        initial={animationsOn ? { opacity: 0, scale: 0.85, y: 12 } : false}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: animationsOn ? 0.28 : 0, ease: 'easeOut' }}
      >
        <h2>完成！</h2>
        <div className="win-stars">
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= score.stars ? 'star star-filled' : 'star'}>
              ★
            </span>
          ))}
        </div>
        <div className="win-stats">
          <div>
            <span className="win-stat-label">步數</span>
            <span className="win-stat-value">{score.moves}</span>
          </div>
          <div>
            <span className="win-stat-label">時間</span>
            <span className="win-stat-value">{formatTime(score.timeMs)}</span>
          </div>
          <div>
            <span className="win-stat-label">分類</span>
            <span className="win-stat-value">{game.completedCategories.length} / {game.completedCategories.length}</span>
          </div>
          <div>
            <span className="win-stat-label">金幣</span>
            <span className="win-stat-value">+{score.coinsEarned}</span>
          </div>
        </div>
        {(unlockedAchievements.length > 0 || unlockedLibraryItems.length > 0) && (
          <div className="win-unlocks">
            {unlockedAchievements.map((a) => (
              <div key={a.id} className="win-unlock-row">🏆 解鎖成就：{a.name}</div>
            ))}
            {unlockedLibraryItems.map((i) => (
              <div key={i.id} className="win-unlock-row">📚 解鎖圖書館物品：{i.name}</div>
            ))}
          </div>
        )}
        <div className="win-actions">
          {dailyDate ? (
            <>
              <button type="button" className="primary" onClick={() => startDailyLevel(levelConfig.difficulty)}>
                再玩一次
              </button>
              <button type="button" onClick={exitLevel}>
                返回每日挑戰
              </button>
            </>
          ) : (
            <>
              {nextLevel && (
                <button type="button" className="primary" onClick={() => startLevel(nextLevel.id)}>
                  下一關
                </button>
              )}
              <button type="button" onClick={() => startLevel(levelConfig.id)}>
                再玩一次
              </button>
              <button type="button" onClick={exitLevel}>
                返回章節
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}
