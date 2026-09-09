import CardView from './CardView'
import { useGameStore } from '../store/gameStore'

const CARD_OFFSET = 34

interface ColumnProps {
  columnIndex: number
}

export default function Column({ columnIndex }: ColumnProps) {
  const column = useGameStore((s) => s.game?.columns[columnIndex] ?? [])
  const clickEmptyColumn = useGameStore((s) => s.clickEmptyColumn)

  return (
    <div
      className="column"
      data-dropzone="column"
      data-index={columnIndex}
      style={{ minHeight: 92 + Math.max(0, column.length - 1) * CARD_OFFSET }}
    >
      {column.length === 0 && (
        <button
          type="button"
          className="column-empty-slot"
          onClick={() => clickEmptyColumn(columnIndex)}
          aria-label={`空欄位 ${columnIndex + 1}`}
        />
      )}
      {column.map((card, i) => (
        <CardView
          // Remounting on a faceUp flip (not just card.id) lets the reveal
          // animation replay via CSS `animation` (which only fires on mount).
          key={`${card.id}:${card.faceUp}`}
          card={card}
          loc={{ zone: 'column', columnIndex, cardIndex: i }}
          style={{ position: 'absolute', top: i * CARD_OFFSET, left: 0, right: 0, zIndex: i }}
        />
      ))}
    </div>
  )
}
