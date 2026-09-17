import { useMemo } from 'react'
import Column from './Column'
import { reservedColumnLen } from './columnLayout'
import { DeckPile, WastePile } from './DeckWaste'
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
  // deliberately: the category slots and the deck/waste piles also scale off
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
  // The columns row now shares its grid row with the fixed-width waste pile
  // (see .board-grid in App.css), so the available width has to fit `slots`
  // columns PLUS that one extra card-width column, not just `slots` alone —
  // otherwise the columns overflow past the reserved waste-pile column. The
  // category slots row is symmetric (slots slots + 1 deck pile), so the same
  // count of gaps (slots-1 internal + 1 before the side column) applies there too.
  const widthPart = `calc((min(100vw, 1180px) - 40px - ${slots} * var(--card-gap)) / ${slots + 1})`
  const heightFactor = 1.309 + Math.max(0, reservedLen - 1) * 0.4
  // How much of the viewport's height is actually left for the table, once
  // HUD/board-grid/TodoList take their share, isn't knowable without measuring
  // them — and TodoList's own share grows with how many categories this
  // difficulty has (more categories -> more wrapped chip rows), which is why
  // this shrinks with column count (columnCount tracks difficulty, and
  // difficulty tracks category count — see difficultyShapes.ts) rather than
  // using one flat guess for every difficulty. Deliberately conservative: a
  // bit of empty space below a short/easy table is fine; a hard table tall
  // enough to get clipped by .table-row's own overflow:hidden is not.
  const availableVh = Math.max(24, 46 - slots * 3)
  const heightPart = `calc(${availableVh}vh / ${heightFactor})`
  const cardWidth = `clamp(30px, min(${widthPart}, ${heightPart}), 140px)`

  return (
    <div className="game-screen" style={{ '--card-w': cardWidth } as React.CSSProperties}>
      <HUD />
      {/* .board-grid is a 2-column grid (see App.css) so the draw pile
          (DeckPile, beside the category slots) and the waste pile it deals
          into (WastePile, beside the columns) land in the exact same
          right-hand column across both rows — a shared grid column tracks
          width identically for every row, unlike flex, so the two piles
          always read as one stack: draw pile on top, waste pile below it. */}
      <div className="board-grid">
        <div className="top-row">
          <CategorySlots />
        </div>
        <DeckPile />
        <div className="table-row">
          <div className="table-area">
            <div className="columns-row">
              {Array.from({ length: columnCount }, (_, i) => (
                <Column key={i} columnIndex={i} maxColumnLen={reservedLen} />
              ))}
            </div>
          </div>
        </div>
        <WastePile />
      </div>
      <TodoList />
      <WinModal />
      <Tutorial />
    </div>
  )
}
