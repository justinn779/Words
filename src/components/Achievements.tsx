import { ACHIEVEMENTS } from '../data/achievements'
import { usePlayerStore } from '../store/playerStore'

interface AchievementsProps {
  onBack: () => void
}

export default function Achievements({ onBack }: AchievementsProps) {
  const achievements = usePlayerStore((s) => s.achievements)

  return (
    <div className="list-screen">
      <div className="list-header">
        <button type="button" className="hud-back" onClick={onBack}>
          ← 返回
        </button>
        <h1>成就</h1>
      </div>
      <ul className="achievement-list">
        {ACHIEVEMENTS.map((def) => {
          const unlocked = Boolean(achievements[def.id])
          return (
            <li key={def.id} className={unlocked ? 'achievement-item achievement-unlocked' : 'achievement-item'}>
              <span className="achievement-icon">{unlocked ? '🏆' : '🔒'}</span>
              <div className="achievement-info">
                <span className="achievement-name">{def.name}</span>
                <span className="achievement-description">{def.description}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
