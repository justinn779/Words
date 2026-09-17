import { useEffect, useRef, useState } from 'react'
import Column from './Column'
import { worstCaseColumnLen } from './columnLayout'
import DeckWaste from './DeckWaste'
import CategorySlots from './CategorySlots'
import TodoList from './TodoList'
import HUD from './HUD'
import WinModal from './WinModal'
import Tutorial from './Tutorial'
import { useGameStore } from '../store/gameStore'

// A fixed ceiling, not measured from any particular level's deal or from the
// player's own moves — see worstCaseColumnLen's own comment for why a
// measured budget both falls behind (can't foresee a run the player hasn't
// built yet) and risks a resize feedback loop (a card size computed from a
// measurement that the card size itself would go on to change). This one
// value is enough for every column, on every difficulty, forever.
const RESERVED_COLUMN_LEN = worstCaseColumnLen()

export default function Board() {
  const columnCount = useGameStore((s) => s.game?.columns.length ?? 0)

  // .table-area (the columns' container) has its actual rendered width AND
  // height measured here so cards can be sized to fill the space really
  // available (viewport minus HUD/top-row/todo-list), not just to avoid a
  // horizontal scrollbar. Without this, a board with few columns/short
  // stacks left most of a tall phone screen empty below a small,
  // width-capped table.
  //
  // Deliberately a window "resize" listener plus a one-off measurement on
  // mount, NOT a ResizeObserver watching .table-area itself. .top-row's
  // category slots and the deck also scale off --card-w (see .slot in
  // App.css), so .table-area's own height isn't independent of the very
  // --card-w this measurement feeds into: growing --card-w grows .top-row,
  // which shrinks the space .game-screen's flex layout leaves for
  // .table-row, which shrinks .table-area — a ResizeObserver here would see
  // that shrink, compute a smaller --card-w, see .table-area grow back, and
  // ping-pong forever (confirmed live: forcing --card-w down by 100px grew
  // .table-area's measured height, not shrank it). A window resize is
  // triggered by the player, never by our own re-render, so listening to it
  // instead reads one honest snapshot per real resize and settles.
  const tableAreaRef = useRef<HTMLDivElement>(null)
  const [tableSize, setTableSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const measure = () => {
      const el = tableAreaRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setTableSize({ width: rect.width, height: rect.height })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Every column always stays on one line — no wrapping onto a second row.
  // Before the first measurement, fall back to fitting them all (capped) so
  // there's no flash of huge/tiny cards.
  const slots = Math.max(1, columnCount)
  const fallbackWidth = `clamp(30px, calc((min(100vw, 1180px) - 40px - ${slots + 1} * var(--card-gap)) / ${slots}), 140px)`

  // A fanned column's height (--card-h + (RESERVED_COLUMN_LEN-1) * --card-step,
  // both proportional to card width — see .game-screen's custom properties)
  // sets how much room the row needs. `1.309` is --card-h's ratio to --card-w;
  // `0.4` is --card-step's.
  const heightFactor = 1.309 + Math.max(0, RESERVED_COLUMN_LEN - 1) * 0.4

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
              <Column key={i} columnIndex={i} maxColumnLen={RESERVED_COLUMN_LEN} />
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
