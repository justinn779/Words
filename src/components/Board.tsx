import { useEffect, useRef, useState } from 'react'
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
  // heightFactor comment below. Only the count matters, not identity, so this
  // stays cheap even with Zustand's reference-equality selector check.
  const maxColumnLen = useGameStore((s) => Math.max(1, ...(s.game?.columns.map((c) => c.length) ?? [1])))

  // .table-area (the columns' container, inside .table-row alongside the draw
  // pile — see App.css) has its actual rendered width AND height measured
  // here so cards can be sized to fill the space really available (viewport
  // minus HUD/category-slots/todo-list, and on desktop minus whatever the
  // draw pile takes in the same row), not just to avoid a horizontal
  // scrollbar. Without this, a board with few columns/short stacks left most
  // of a tall phone screen empty below a small, width-capped table.
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
      {/* DeckWaste is rendered twice — once docked beside the category slots
          (shown on a narrow phone, saving the vertical space a whole extra
          row would cost) and once beside the columns (shown on desktop's
          classic side-by-side solitaire layout). A media query in App.css
          (.deck-waste--top / .deck-waste--side) shows exactly one at a time;
          both read the same store, so which copy renders is purely visual. */}
      <div className="top-row">
        <CategorySlots />
        <DeckWaste className="deck-waste--top" />
      </div>
      <div className="table-row">
        <div className="table-area" ref={tableAreaRef}>
          <div className="columns-row">
            {Array.from({ length: columnCount }, (_, i) => (
              <Column key={i} columnIndex={i} />
            ))}
          </div>
        </div>
        <DeckWaste className="deck-waste--side" />
      </div>
      <TodoList />
      <WinModal />
      <Tutorial />
    </div>
  )
}
