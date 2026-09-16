import { useState } from 'react'
import { motion } from 'framer-motion'
import { useGameStore } from '../store/gameStore'
import { usePlayerStore } from '../store/playerStore'
import { useContentStore } from '../store/contentStore'
import { ACHIEVEMENTS } from '../data/achievements'
import { getChapterDisplayTitle, getChapterLevels, getContentChapterOrder, isChapterUnlocked, isNextNewChapterGateOpen } from '../data/progression'
import { GENERATING_NEW_CHAPTER } from '../store/contentStore'
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
  const aiChapters = useContentStore((s) => s.aiChapters)
  const generatingChapterId = useContentStore((s) => s.generatingChapterId)
  const generateNewChapter = useContentStore((s) => s.generateNewChapter)
  const [genError, setGenError] = useState<string | null>(null)
  const extraLevels = Object.values(aiChapters).flatMap((e) => e.levels)

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
  const nextChapterTitle = nextChapterId ? getChapterDisplayTitle(nextChapterId, contentOrder, aiChapters[nextChapterId]?.title) : undefined
  const showNextChapter = Boolean(nextChapterFirstLevel && nextChapterUnlocked)

  // No next chapter exists yet and the player just finished the actual last
  // chapter anyone has content for: offer to generate the next one right here
  // instead of sending the player hunting through the menu (it also
  // auto-generates on its own the moment they start any level in this chapter —
  // see gameStore.ts's ensureNextChapterGenerating — this is just a shortcut).
  // Once it's ready, nextChapterId/showNextChapter above pick it up on the next
  // render exactly like any other next chapter — no separate navigation needed.
  const isAtFrontier = contentOrder[contentOrder.length - 1] === levelConfig.chapterId
  const canGenerateNewChapter = !dailyDate && !nextLevel && !nextChapterId && isAtFrontier && isNextNewChapterGateOpen(levelRecords, extraLevels)
  const generatingNewChapter = generatingChapterId === GENERATING_NEW_CHAPTER

  const handleGenerateNewChapter = async () => {
    setGenError(null)
    const result = await generateNewChapter()
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
        {unlockedAchievements.length > 0 && (
          <div className="win-unlocks">
            {unlockedAchievements.map((a) => (
              <div key={a.id} className="win-unlock-row">🏆 解鎖成就：{a.name}</div>
            ))}
          </div>
        )}
        <div className="win-actions">
          {dailyDate ? (
            <>
              {nextDailyDifficulty && (
                <button type="button" className="primary" onClick={() => void startDailyLevel(nextDailyDifficulty)}>
                  下一關：{DAILY_DIFFICULTY_LABEL[nextDailyDifficulty] ?? nextDailyDifficulty}
                </button>
              )}
              <button type="button" onClick={() => void startDailyLevel(levelConfig.difficulty)}>
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
              {canGenerateNewChapter && (
                <button type="button" className="primary" disabled={generatingNewChapter} onClick={handleGenerateNewChapter}>
                  {generatingNewChapter ? '生成中…' : '🪄 用 AI 生成全新章節'}
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
