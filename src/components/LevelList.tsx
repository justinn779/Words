import { CHAPTERS } from '../data/chapters'
import { getChapterLevels, isLevelUnlocked } from '../data/progression'
import { usePlayerStore } from '../store/playerStore'
import { useGameStore } from '../store/gameStore'

const DIFFICULTY_LABEL: Record<string, string> = { easy: '簡單', normal: '普通', hard: '困難' }

interface LevelListProps {
  chapterId: string
  onBack: () => void
}

export default function LevelList({ chapterId, onBack }: LevelListProps) {
  const chapter = CHAPTERS.find((c) => c.id === chapterId)
  const levels = getChapterLevels(chapterId)
  const levelRecords = usePlayerStore((s) => s.levelRecords)
  const startLevel = useGameStore((s) => s.startLevel)

  return (
    <div className="list-screen">
      <div className="list-header">
        <button type="button" className="hud-back" onClick={onBack}>
          ← 返回
        </button>
        <h1>{chapter?.title ?? '關卡'}</h1>
      </div>
      <ul className="level-list">
        {levels.map((level, i) => {
          const record = levelRecords[level.id]
          const unlocked = isLevelUnlocked(chapterId, i, levelRecords)
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
