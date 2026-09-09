import Column from './Column'
import DeckWaste from './DeckWaste'
import CategorySlots from './CategorySlots'
import TodoList from './TodoList'
import HUD from './HUD'
import WinModal from './WinModal'
import { useGameStore } from '../store/gameStore'

export default function Board() {
  const columnCount = useGameStore((s) => s.game?.columns.length ?? 0)

  return (
    <div className="game-screen">
      <HUD />
      <CategorySlots />
      <div className="table-area">
        <div className="columns-row">
          {Array.from({ length: columnCount }, (_, i) => (
            <Column key={i} columnIndex={i} />
          ))}
        </div>
        {/* Outside the horizontally-scrolling columns row so the draw pile is
            always reachable without scrolling, even on wide (6-column) boards. */}
        <DeckWaste />
      </div>
      <TodoList />
      <WinModal />
    </div>
  )
}
