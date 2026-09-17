import { useEffect, useRef } from 'react'
import { getDifficultyForLevel, isLevelUnlocked, levelId } from '../data/progression'
import { usePlayerStore } from '../store/playerStore'
import { useGameStore } from '../store/gameStore'
import { useContentStore } from '../store/contentStore'

interface LevelGridProps {
  onBack: () => void
}

/** How many level tiles to always keep visible past the player's own frontier —
 * matches contentStore.ts's AHEAD_BUFFER (the grid shows exactly what's been
 * generated, so if that constant changes this adjusts automatically; this cap
 * only matters before anything has loaded yet). */
const MIN_TILES_BEFORE_LOAD = 4

export default function LevelGrid({ onBack }: LevelGridProps) {
  const levelRecords = usePlayerStore((s) => s.levelRecords)
  const levels = useContentStore((s) => s.levels)
  const generatingLevelNumbers = useContentStore((s) => s.generatingLevelNumbers)
  const refreshAndEnsureAhead = useContentStore((s) => s.refreshAndEnsureAhead)
  const startLevel = useGameStore((s) => s.startLevel)

  // Every level is independent now — no chapter grouping, no per-chapter theme.
  // The player's frontier is just "the lowest level they haven't unlocked yet";
  // re-checking Firestore fresh here (not just relying on App.tsx's one-time
  // load) gives the ahead-buffer bootstrap another chance every time this
  // screen opens — see contentStore.ts's refreshAndEnsureAhead and
  // src/firebase/levels.ts's hasAnyLevelEverBeenRequested for why that matters.
  const generatedNumbers = Object.keys(levels).map(Number)
  const highestGenerated = generatedNumbers.length > 0 ? Math.max(...generatedNumbers) : 0
  let frontier = 1
  while (isLevelUnlocked(frontier + 1, levelRecords) && frontier < highestGenerated) frontier++

  useEffect(() => {
    void refreshAndEnsureAhead(frontier || undefined)
    // Intentionally once per mount only — this is a deliberate extra chance to
    // notice missing content, not a poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tileCount = Math.max(highestGenerated, frontier + MIN_TILES_BEFORE_LOAD)
  const tiles = Array.from({ length: tileCount }, (_, i) => i + 1)

  const currentRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' })
  }, [frontier])

  return (
    <div className="list-screen">
      <div className="list-header">
        <button type="button" className="hud-back" onClick={onBack}>
          ← 返回
        </button>
        <h1>關卡</h1>
      </div>
      <ul className="level-grid">
        {tiles.map((n) => {
          const unlocked = isLevelUnlocked(n, levelRecords)
          const stars = levelRecords[levelId(n)]?.bestStars ?? 0
          const ready = Boolean(levels[n])
          const generating = generatingLevelNumbers.includes(n)
          const difficulty = getDifficultyForLevel(n)
          const clickable = unlocked && ready
          return (
            <li key={n} ref={n === frontier ? currentRef : undefined}>
              <button
                type="button"
                className={`level-tile level-tile-${difficulty}`}
                disabled={!clickable}
                onClick={() => startLevel(levelId(n))}
                aria-label={`第 ${n} 關${unlocked ? '' : '（未解鎖）'}`}
              >
                <span className="level-tile-number">{unlocked ? n : '🔒'}</span>
                {unlocked ? (
                  ready ? (
                    <span className="level-tile-stars">
                      {[1, 2, 3].map((i) => (
                        <span key={i} className={i <= stars ? 'star-filled' : ''}>
                          ★
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="level-tile-stars level-tile-pending">{generating ? '生成中' : '⋯'}</span>
                  )
                ) : (
                  <span className="level-tile-stars" aria-hidden />
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
