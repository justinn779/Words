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

  // .table-area (the columns' container) is a flex:1 child of .game-screen
  // (see App.css) — its actual rendered width AND height are measured here so
  // cards can be sized to fill the space really available (viewport minus
  // HUD/category-slots/deck-waste/todo-list), not just to avoid a horizontal
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

  // Before the first measurement, fall back to fitting every column on one
  // line (capped) so there's no flash of huge/tiny cards.
  const fallbackSlots = Math.max(1, columnCount)
  const fallbackWidth = `clamp(30px, calc((min(100vw, 1180px) - 40px - ${fallbackSlots + 1} * var(--card-gap)) / ${fallbackSlots}), 140px)`

  // A fanned column's height (--card-h + (maxColumnLen-1) * --card-step, both
  // proportional to card width — see .game-screen's custom properties) sets
  // how much room one row of columns needs. `1.309` is --card-h's ratio to
  // --card-w; `0.4` is --card-step's.
  const heightFactor = 1.309 + Math.max(0, maxColumnLen - 1) * 0.4

  let cardWidth = fallbackWidth
  if (tableSize && columnCount > 0) {
    // .columns-row wraps (see App.css), so on a narrow phone with many
    // columns, forcing everything onto one line leaves cards tiny even
    // though there's plenty of unused height below. Try every row count and
    // keep whichever lets a card be biggest, honoring both that row's width
    // and the fanned stack's height. Matches App.css's responsive --card-gap.
    const gapPx = window.innerWidth <= 720 ? 6 : 8
    let best = 0
    for (let rows = 1; rows <= columnCount; rows++) {
      const cols = Math.ceil(columnCount / rows)
      const widthCandidate = (tableSize.width - (cols + 1) * gapPx) / cols
      const heightCandidate = (tableSize.height - (rows - 1) * gapPx) / rows / heightFactor
      const candidate = Math.min(widthCandidate, heightCandidate, 140)
      if (candidate > best) best = candidate
    }
    cardWidth = `${Math.max(30, best)}px`
  }

  return (
    <div className="game-screen" style={{ '--card-w': cardWidth } as React.CSSProperties}>
      <HUD />
      <CategorySlots />
      {/* Its own row (not inside .table-area) with an independently-sized
          --card-w (see App.css) so the draw pile never shrinks the columns'
          width budget on narrow phones. */}
      <DeckWaste />
      <div className="table-area" ref={tableAreaRef}>
        <div className="columns-row">
          {Array.from({ length: columnCount }, (_, i) => (
            <Column key={i} columnIndex={i} />
          ))}
        </div>
      </div>
      <TodoList />
      <WinModal />
      <Tutorial />
    </div>
  )
}
