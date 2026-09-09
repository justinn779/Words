import CardView from './CardView'
import { useGameStore } from '../store/gameStore'

interface ColumnProps {
  columnIndex: number
}

export default function Column({ columnIndex }: ColumnProps) {
  const column = useGameStore((s) => s.game?.columns[columnIndex] ?? [])
  const clickEmptyColumn = useGameStore((s) => s.clickEmptyColumn)

  const fanned = Math.max(0, column.length - 1)

  return (
    <div
      className="column"
      data-dropzone="column"
      data-index={columnIndex}
      // Cover the full height of the last (absolutely-positioned) card: its top
      // is fanned * --card-step, and the card itself is --card-h tall. All in
      // CSS units so it tracks the viewport-scaled --card-w.
      style={{ minHeight: `calc(var(--card-h) + ${fanned} * var(--card-step))` }}
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
          style={{ position: 'absolute', top: `calc(${i} * var(--card-step))`, left: 0, right: 0, zIndex: i }}
        />
      ))}
    </div>
  )
}
