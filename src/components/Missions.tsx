import { MISSIONS } from '../data/missions'
import { usePlayerStore } from '../store/playerStore'

interface MissionsProps {
  onBack: () => void
}

export default function Missions({ onBack }: MissionsProps) {
  const missionsDaily = usePlayerStore((s) => s.missionsDaily)
  const missionsWeekly = usePlayerStore((s) => s.missionsWeekly)
  const claimMission = usePlayerStore((s) => s.claimMission)

  const renderGroup = (title: string, scope: 'daily' | 'weekly') => {
    const period = scope === 'daily' ? missionsDaily : missionsWeekly
    const defs = MISSIONS.filter((m) => m.scope === scope)
    return (
      <>
        <h2 className="mission-group-title">{title}</h2>
        <ul className="mission-list">
          {defs.map((def) => {
            const progress = Math.min(period.progress[def.statKey] ?? 0, def.target)
            const claimed = period.claimed.includes(def.id)
            const complete = progress >= def.target
            return (
              <li key={def.id} className="mission-item">
                <div className="mission-info">
                  <span className="mission-description">{def.description}</span>
                  <span className="mission-progress">{progress} / {def.target}</span>
                </div>
                <button
                  type="button"
                  className={complete && !claimed ? 'mission-claim mission-claim-ready' : 'mission-claim'}
                  disabled={!complete || claimed}
                  onClick={() => claimMission(def.id)}
                >
                  {claimed ? '已領取' : `領取 +${def.rewardCoins}`}
                </button>
              </li>
            )
          })}
        </ul>
      </>
    )
  }

  return (
    <div className="list-screen">
      <div className="list-header">
        <button type="button" className="hud-back" onClick={onBack}>
          ← 返回
        </button>
        <h1>任務</h1>
      </div>
      {renderGroup('每日任務', 'daily')}
      {renderGroup('每週任務', 'weekly')}
    </div>
  )
}
