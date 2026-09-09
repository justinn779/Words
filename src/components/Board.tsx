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
  const hasDeck = useGameStore(
    (s) =>
      (s.levelConfig?.deckEnabled ?? false) ||
      (s.game?.deck.length ?? 0) > 0 ||
      (s.game?.waste.length ?? 0) > 0,
  )

  // Every column (plus the draw pile, which is ~2 card-widths) must fit the
  // viewport without a horizontal scrollbar. Derive the card width from the
  // slot count so the whole table always fits — never scrolls, just scales.
  const slots = Math.max(1, columnCount + (hasDeck ? 2 : 0))
  // -40px absorbs .game-screen's padding plus any desktop scrollbar width that
  // 100vw includes; the 84px cap keeps cards from ballooning on wide screens.
  const cardWidth = `clamp(30px, calc((min(100vw, 1180px) - 40px - ${slots + 1} * var(--card-gap)) / ${slots}), 84px)`

  return (
    <div className="game-screen" style={{ '--card-w': cardWidth } as React.CSSProperties}>
      <HUD />
      <CategorySlots />
      <div className="table-area">
        <div className="columns-row">
          {Array.from({ length: columnCount }, (_, i) => (
            <Column key={i} columnIndex={i} />
          ))}
        </div>
        {/* Sibling of the columns row (not inside it) so the draw pile is always
            on screen without scrolling. */}
        <DeckWaste />
      </div>
      <TodoList />
      <WinModal />
      <Tutorial />
    </div>
  )
}
