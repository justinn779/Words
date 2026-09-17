import { useEffect, useState } from 'react'
import { useGameStore, getElapsedMs } from '../store/gameStore'
import { usePlayerStore } from '../store/playerStore'
import { HINT_LEVEL_1_COST, HINT_LEVEL_2_COST, HINT_CATEGORY_COST, UNDO_COST } from '../engine'

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
  const requestCategoryHint = useGameStore((s) => s.requestCategoryHint)
  const awaitingCategoryHint = useGameStore((s) => s.awaitingCategoryHint)
  const reportCurrentLevel = useGameStore((s) => s.reportCurrentLevel)
  const exitLevel = useGameStore((s) => s.exitLevel)
  const message = useGameStore((s) => s.message)
  const dismissMessage = useGameStore((s) => s.dismissMessage)
  const coins = usePlayerStore((s) => s.coins)
  const [confirmingReport, setConfirmingReport] = useState(false)

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
        <button
          type="button"
          className={awaitingCategoryHint ? 'hud-category-hint-active' : ''}
          onClick={requestCategoryHint}
        >
          {awaitingCategoryHint ? '請選擇分類欄…（取消）' : `分類提示 (${HINT_CATEGORY_COST})`}
        </button>
        {confirmingReport ? (
          <span className="hud-report-confirm">
            確定要回報這關無解嗎？
            <button
              type="button"
              onClick={() => {
                setConfirmingReport(false)
                void reportCurrentLevel()
              }}
            >
              確定回報
            </button>
            <button type="button" onClick={() => setConfirmingReport(false)}>
              取消
            </button>
          </span>
        ) : (
          <button type="button" className="hud-report" onClick={() => setConfirmingReport(true)} aria-label="回報這關卡沒有解">
            ❗ 回報無解
          </button>
        )}
      </div>
      {message && <div className="hud-message">{message}</div>}
    </div>
  )
}
