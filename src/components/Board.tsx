import { useMemo } from 'react'
import Column from './Column'
import { reservedColumnLen } from './columnLayout'
import DeckWaste from './DeckWaste'
import CategorySlots from './CategorySlots'
import TodoList from './TodoList'
import HUD from './HUD'
import WinModal from './WinModal'
import Tutorial from './Tutorial'
import { useGameStore } from '../store/gameStore'

export default function Board() {
  const columnCount = useGameStore((s) => s.game?.columns.length ?? 0)
  // Computed once per level, from the deal itself, not re-measured every
  // render — a column's face-down count only ever shrinks from here (see
  // columnLayout.ts's getFaceDownPrefix), and a face-up run is always capped
  // at its own fixed worst case once it collapses, so this never falls
  // behind no matter how the player plays out the level. Read imperatively
  // (not a selector) so this isn't a reactive dependency on every move.
  const levelKey = useGameStore((s) => (s.game ? `${s.game.levelId}:${s.game.startedAt}` : null))
  const reservedLen = useMemo(() => {
    const columns = useGameStore.getState().game?.columns ?? []
    return reservedColumnLen(columns)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelKey])

  // Card width is a plain CSS formula, not anything measured off the DOM —
  // deliberately: .top-row's category slots and the deck also scale off
  // --card-w (see .slot in App.css), so a width computed from a *measured*
  // .table-area size fed back into the very variable that measurement
  // depends on, and once resized itself, the width the next measurement saw
  // — a resize loop, confirmed live earlier. Once the level starts, card
  // size is fixed for that level and never reacts to anything happening on
  // screen again: `slots` (this level's own column count) and `reservedLen`
  // (this level's own deal, see above) are both known synchronously, so the
  // whole formula is just plain CSS clamp()/calc() over those two numbers
  // and the viewport's own vw/vh units — nothing here ever measures a
  // rendered element. If an especially tall column still doesn't fit,
  // .game-screen's overflow:hidden and TodoList's own max-height/overflow-y
  // (see App.css) clip or scroll internally rather than the page.
  const slots = Math.max(1, columnCount)
  const widthPart = `calc((min(100vw, 1180px) - 40px - ${slots + 1} * var(--card-gap)) / ${slots})`
  const heightFactor = 1.309 + Math.max(0, reservedLen - 1) * 0.4
  const heightPart = `calc(52vh / ${heightFactor})`
  const cardWidth = `clamp(30px, min(${widthPart}, ${heightPart}), 140px)`

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
        <div className="table-area">
          <div className="columns-row">
            {Array.from({ length: columnCount }, (_, i) => (
              <Column key={i} columnIndex={i} maxColumnLen={reservedLen} />
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
