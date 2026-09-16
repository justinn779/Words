import { useEffect, useMemo, useRef, useState } from 'react'
import Column from './Column'
import DeckWaste from './DeckWaste'
import CategorySlots from './CategorySlots'
import TodoList from './TodoList'
import HUD from './HUD'
import WinModal from './WinModal'
import Tutorial from './Tutorial'
import { useGameStore } from '../store/gameStore'

export default function Board() {
  const columnCount = useGameStore((s) => s.game?.columns.length ?? 0)
  // The tallest column decides how tall a fanned stack gets — see the
  // heightFactor comment below. Fixed once per level (from its initial deal,
  // read imperatively so this isn't a reactive dependency) rather than
  // tracking the *current* longest column — cards moving between columns
  // during play would otherwise constantly nudge the card size, making the
  // whole board visibly resize on every move instead of just when a new
  // level actually starts. A player piling a whole category onto one column
  // could in principle still grow past this, but Column.tsx collapses a run
  // of 3+ same-category cards down to 2 fan steps (see getCardOffsets), so
  // the initial deal's own tallest column remains the real ceiling.
  const levelKey = useGameStore((s) => (s.game ? `${s.game.levelId}:${s.game.startedAt}` : null))
  const maxColumnLen = useMemo(() => {
    const columns = useGameStore.getState().game?.columns ?? []
    return Math.max(1, ...columns.map((c) => c.length))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelKey])

  // .table-area (the columns' container) has its actual rendered width AND
  // height measured here so cards can be sized to fill the space really
  // available (viewport minus HUD/top-row/todo-list), not just to avoid a
  // horizontal scrollbar. Without this, a board with few columns/short
  // stacks left most of a tall phone screen empty below a small,
  // width-capped table.
  const tableAreaRef = useRef<HTMLDivElement>(null)
  const [tableSize, setTableSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const el = tableAreaRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setTableSize({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Every column always stays on one line — no wrapping onto a second row.
  // Before the first measurement, fall back to fitting them all (capped) so
  // there's no flash of huge/tiny cards.
  const slots = Math.max(1, columnCount)
  const fallbackWidth = `clamp(30px, calc((min(100vw, 1180px) - 40px - ${slots + 1} * var(--card-gap)) / ${slots}), 140px)`

  // A fanned column's height (--card-h + (maxColumnLen-1) * --card-step, both
  // proportional to card width — see .game-screen's custom properties) sets
  // how much room the row needs. `1.309` is --card-h's ratio to --card-w;
  // `0.4` is --card-step's.
  const heightFactor = 1.309 + Math.max(0, maxColumnLen - 1) * 0.4

  let cardWidth = fallbackWidth
  if (tableSize && columnCount > 0) {
    const gapPx = window.innerWidth <= 720 ? 6 : 8
    const widthCandidate = (tableSize.width - (slots + 1) * gapPx) / slots
    const heightCandidate = tableSize.height / heightFactor
    cardWidth = `${Math.max(30, Math.min(widthCandidate, heightCandidate, 140))}px`
  }

  return (
    <div className="game-screen" style={{ '--card-w': cardWidth } as React.CSSProperties}>
      <HUD />
      {/* The draw pile docks beside the category slots on every device now —
          it used to sit beside the columns on desktop instead, but sharing
          the (small, card-shaped) slots' row saves a whole extra row of
          vertical space there too. */}
      <div className="top-row">
        <CategorySlots />
        <DeckWaste />
      </div>
      <div className="table-row">
        <div className="table-area" ref={tableAreaRef}>
          <div className="columns-row">
            {Array.from({ length: columnCount }, (_, i) => (
              <Column key={i} columnIndex={i} maxColumnLen={maxColumnLen} />
            ))}
          </div>
        </div>
      </div>
      <TodoList />
      <WinModal />
      <Tutorial />
    </div>
  )
}
