import { useEffect } from 'react'
import { useGameStore, getElapsedMs } from '../store/gameStore'
import { usePlayerStore } from '../store/playerStore'
import { HINT_LEVEL_1_COST, HINT_LEVEL_2_COST, UNDO_COST } from '../engine'

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

const DIFFICULTY_LABEL: Record<string, string> = { easy: '簡單', normal: '普通', hard: '困難' }

export default function HUD() {
  const game = useGameStore((s) => s.game)
  const levelConfig = useGameStore((s) => s.levelConfig)
  const nowTick = useGameStore((s) => s.nowTick)
  const tick = useGameStore((s) => s.tick)
  const undo = useGameStore((s) => s.undo)
  const requestHint = useGameStore((s) => s.requestHint)
  const exitLevel = useGameStore((s) => s.exitLevel)
  const message = useGameStore((s) => s.message)
  const dismissMessage = useGameStore((s) => s.dismissMessage)
  const coins = usePlayerStore((s) => s.coins)

  useEffect(() => {
    if (!game || game.status !== 'playing') return
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [game, tick])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(dismissMessage, 2200)
    return () => clearTimeout(t)
  }, [message, dismissMessage])

  if (!game || !levelConfig) return null

  return (
    <div className="hud">
      <div className="hud-row">
        <button type="button" className="hud-back" onClick={exitLevel}>
          ← 返回
        </button>
        <span className="hud-difficulty">{DIFFICULTY_LABEL[levelConfig.difficulty]}</span>
        <span className="hud-stat">步數 {game.moves}</span>
        <span className="hud-stat">{formatTime(getElapsedMs(game, nowTick))}</span>
        <span className="hud-coins">🪙 {coins}</span>
      </div>
      <div className="hud-row">
        <button type="button" onClick={undo} disabled={game.history.length === 0}>
          復原 ({UNDO_COST})
        </button>
        <button type="button" onClick={() => requestHint(1)}>
          提示 I ({HINT_LEVEL_1_COST})
        </button>
        <button type="button" onClick={() => requestHint(2)}>
          提示 II ({HINT_LEVEL_2_COST})
        </button>
      </div>
      {message && <div className="hud-message">{message}</div>}
    </div>
  )
}
