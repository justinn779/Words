import { getChapterDisplayTitle, getChapterLevels, getContentChapterOrder, isLevelUnlocked } from '../data/progression'
import { usePlayerStore } from '../store/playerStore'
import { useGameStore } from '../store/gameStore'
import { useContentStore } from '../store/contentStore'

const DIFFICULTY_LABEL: Record<string, string> = { easy: '簡單', normal: '普通', hard: '困難' }

interface LevelListProps {
  chapterId: string
  onBack: () => void
}

export default function LevelList({ chapterId, onBack }: LevelListProps) {
  const aiChapters = useContentStore((s) => s.aiChapters)
  const extraLevels = Object.values(aiChapters).flatMap((e) => e.levels)
  const levels = getChapterLevels(chapterId, extraLevels)
  const chapterTitle = getChapterDisplayTitle(chapterId, getContentChapterOrder(extraLevels), aiChapters[chapterId]?.title)
  const levelRecords = usePlayerStore((s) => s.levelRecords)
  const startLevel = useGameStore((s) => s.startLevel)

  return (
    <div className="list-screen">
      <div className="list-header">
        <button type="button" className="hud-back" onClick={onBack}>
          ← 返回
        </button>
        <h1>{chapterTitle}</h1>
      </div>
      <ul className="level-list">
        {levels.map((level, i) => {
          const record = levelRecords[level.id]
          const unlocked = isLevelUnlocked(chapterId, i, levelRecords, extraLevels)
          return (
            <li key={level.id}>
              <button
                type="button"
                className="level-item"
                disabled={!unlocked}
                onClick={() => startLevel(level.id)}
              >
                <span className="level-number">第 {i + 1} 關</span>
                <span className={`level-difficulty level-difficulty-${level.difficulty}`}>
                  {DIFFICULTY_LABEL[level.difficulty]}
                </span>
                {unlocked ? (
                  <span className="level-stars">
                    {'★'.repeat(record?.bestStars ?? 0)}
                    {'☆'.repeat(3 - (record?.bestStars ?? 0))}
                  </span>
                ) : (
                  <span className="level-stars">🔒</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
