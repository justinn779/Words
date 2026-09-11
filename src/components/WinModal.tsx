import { useState } from 'react'
import { motion } from 'framer-motion'
import { useGameStore } from '../store/gameStore'
import { usePlayerStore } from '../store/playerStore'
import { useContentStore } from '../store/contentStore'
import { ACHIEVEMENTS } from '../data/achievements'
import { LIBRARY_ITEMS } from '../data/library'
import { getChapterLevels, getContentChapterOrder, isChapterStarGateOpen, isChapterUnlocked } from '../data/progression'
import { CHAPTERS } from '../data/chapters'
import { AI_CHAPTER_IDS } from '../firebase/aiChapters'
import { DAILY_DIFFICULTIES } from '../data/dailyChallenge'

const DAILY_DIFFICULTY_LABEL: Record<string, string> = { easy: '簡單', normal: '普通', hard: '困難' }

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function MiniStars({ n }: { n: number }) {
  return (
    <span className="mini-stars">
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? 'star-filled' : ''}>
          ★
        </span>
      ))}
    </span>
  )
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
  // recordWin() has already run by the time this renders (gameStore.finalizeMove calls it
  // before setting won/score), so this reflects the just-earned stars from this very win.
  const levelRecords = usePlayerStore((s) => s.levelRecords)
  const aiChapterLevels = useContentStore((s) => s.aiChapterLevels)
  const generatingChapterId = useContentStore((s) => s.generatingChapterId)
  const generateChapter = useContentStore((s) => s.generateChapter)
  const [genError, setGenError] = useState<string | null>(null)
  const extraLevels = Object.values(aiChapterLevels).flat()

  if (!game || game.status !== 'won' || !score || !levelConfig) return null

  const chapterLevels = getChapterLevels(levelConfig.chapterId, extraLevels)
  const levelIndex = chapterLevels.findIndex((l) => l.id === levelConfig.id)
  const nextLevel = !dailyDate ? chapterLevels[levelIndex + 1] : undefined

  // Finished a chapter's last level: offer to jump straight into the next one, if it
  // has content and just got unlocked (or already was).
  const contentOrder = getContentChapterOrder(extraLevels)
  const chapterOrderIndex = contentOrder.indexOf(levelConfig.chapterId)
  const nextChapterId = !dailyDate && !nextLevel && chapterOrderIndex >= 0 ? contentOrder[chapterOrderIndex + 1] : undefined
  const nextChapterFirstLevel = nextChapterId ? getChapterLevels(nextChapterId, extraLevels)[0] : undefined
  const nextChapterUnlocked = nextChapterId ? isChapterUnlocked(nextChapterId, levelRecords, extraLevels) : false
  const nextChapterTitle = nextChapterId ? CHAPTERS.find((c) => c.id === nextChapterId)?.title : undefined
  const showNextChapter = Boolean(nextChapterFirstLevel && nextChapterUnlocked)

  // No next chapter has content yet — if the true next chapter (from the full
  // CHAPTERS roster, not just what's authored/generated so far) is one of the
  // AI-generatable placeholders and its star-gate is already open, offer to
  // generate it right here instead of sending the player hunting through the menu.
  const fullOrder = CHAPTERS.map((c) => c.id)
  const fullOrderIndex = fullOrder.indexOf(levelConfig.chapterId)
  const generatableChapterId =
    !dailyDate && !nextLevel && !nextChapterId && fullOrderIndex >= 0 ? fullOrder[fullOrderIndex + 1] : undefined
  const canGenerateNextChapter =
    Boolean(generatableChapterId) &&
    (AI_CHAPTER_IDS as readonly string[]).includes(generatableChapterId as string) &&
    isChapterStarGateOpen(generatableChapterId as string, levelRecords, extraLevels)
  const generatableChapterTitle = generatableChapterId ? CHAPTERS.find((c) => c.id === generatableChapterId)?.title : undefined
  const generatingNextChapter = Boolean(generatableChapterId) && generatingChapterId === generatableChapterId

  const handleGenerateNextChapter = async () => {
    if (!generatableChapterId) return
    setGenError(null)
    const result = await generateChapter(generatableChapterId)
    if (!result.ok) setGenError(result.message)
  }

  // Daily Challenge has no per-level unlock records (it's rebuilt fresh every day),
  // so "next" here just means the next difficulty in today's fixed easy/normal/hard
  // lineup — offered right after a win instead of making the player go back out to
  // the daily-challenge screen and pick it themselves.
  const dailyDifficultyIndex = dailyDate ? DAILY_DIFFICULTIES.indexOf(levelConfig.difficulty) : -1
  const nextDailyDifficulty =
    dailyDifficultyIndex >= 0 && dailyDifficultyIndex < DAILY_DIFFICULTIES.length - 1
      ? DAILY_DIFFICULTIES[dailyDifficultyIndex + 1]
      : undefined

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

        <div className="win-breakdown">
          <div className="win-breakdown-title">星等 = 步數與時間評分中較低的一項</div>
          {(
            [
              {
                key: 'moves',
                label: '步數',
                value: `${score.moves}`,
                sub: score.moveStars,
                targets: `3★ ≤${levelConfig.targetThreeStarMoves}　2★ ≤${levelConfig.targetTwoStarMoves}`,
              },
              {
                key: 'time',
                label: '時間',
                value: formatTime(score.timeMs),
                sub: score.timeStars,
                targets: `3★ ≤${formatTime(levelConfig.targetThreeStarTime * 1000)}　2★ ≤${formatTime(levelConfig.targetTwoStarTime * 1000)}`,
              },
            ] as const
          ).map((row) => (
            <div
              key={row.key}
              className={`wb-row ${row.sub === score.stars && score.stars < 3 ? 'wb-limiting' : ''}`}
            >
              <span className="wb-label">{row.label}</span>
              <span className="wb-value">{row.value}</span>
              <MiniStars n={row.sub} />
              <span className="wb-targets">{row.targets}</span>
            </div>
          ))}
          {score.stars < 3 && (
            <p className="wb-hint">
              {score.moveStars <= score.timeStars
                ? `減少步數就能提升星等（少 ${Math.max(1, score.moves - levelConfig.targetThreeStarMoves)} 步達 3★）`
                : `加快速度就能提升星等（快 ${Math.max(1, Math.ceil(score.timeMs / 1000) - levelConfig.targetThreeStarTime)} 秒達 3★）`}
            </p>
          )}
        </div>

        <div className="win-stats">
          <div>
            <span className="win-stat-label">完成分類</span>
            <span className="win-stat-value">{game.completedCategories.length}</span>
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
              {nextDailyDifficulty && (
                <button type="button" className="primary" onClick={() => startDailyLevel(nextDailyDifficulty)}>
                  下一關：{DAILY_DIFFICULTY_LABEL[nextDailyDifficulty] ?? nextDailyDifficulty}
                </button>
              )}
              <button type="button" onClick={() => startDailyLevel(levelConfig.difficulty)}>
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
              {showNextChapter && nextChapterFirstLevel && (
                <button type="button" className="primary" onClick={() => startLevel(nextChapterFirstLevel.id)}>
                  下一章節：{nextChapterTitle ?? ''}
                </button>
              )}
              {canGenerateNextChapter && (
                <button type="button" className="primary" disabled={generatingNextChapter} onClick={handleGenerateNextChapter}>
                  {generatingNextChapter ? '生成中…' : `🪄 生成下一章：${generatableChapterTitle ?? ''}`}
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
        {genError && <p className="wb-hint">{genError}</p>}
      </motion.div>
    </div>
  )
}
