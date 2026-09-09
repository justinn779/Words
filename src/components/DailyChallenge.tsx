import { DAILY_DIFFICULTIES, getTodayDateString } from '../data/dailyChallenge'
import { usePlayerStore } from '../store/playerStore'
import { useGameStore } from '../store/gameStore'

const DIFFICULTY_LABEL: Record<string, string> = { easy: '簡單', normal: '普通', hard: '困難' }

interface DailyChallengeProps {
  onBack: () => void
}

export default function DailyChallenge({ onBack }: DailyChallengeProps) {
  const today = getTodayDateString()
  const daily = usePlayerStore((s) => s.daily)
  const startDailyLevel = useGameStore((s) => s.startDailyLevel)
  const todayResults = daily.days[today] ?? {}

  return (
    <div className="list-screen">
      <div className="list-header">
        <button type="button" className="hud-back" onClick={onBack}>
          ← 返回
        </button>
        <h1>每日挑戰</h1>
      </div>
      <div className="daily-streak">🔥 連續挑戰 {daily.streak} 天</div>
      <ul className="level-list">
        {DAILY_DIFFICULTIES.map((difficulty) => {
          const result = todayResults[difficulty]
          return (
            <li key={difficulty}>
              <button type="button" className="level-item" onClick={() => startDailyLevel(difficulty)}>
                <span className={`level-difficulty level-difficulty-${difficulty}`}>{DIFFICULTY_LABEL[difficulty]}</span>
                <span className="level-stars">
                  {result ? '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars) : '尚未完成'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="daily-note">每天的題目對所有玩家都相同，可反覆挑戰刷新紀錄。</p>
    </div>
  )
}
