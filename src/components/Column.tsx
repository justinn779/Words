import CardView from './CardView'
import { useGameStore } from '../store/gameStore'

const CARD_OFFSET = 34
const CARD_HEIGHT = 110

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
      // Must cover the full height of the last (absolutely-positioned) card —
      // its top is (n-1)*CARD_OFFSET, so the pile ends CARD_HEIGHT below that.
      // Undershooting here let the bottom card overflow .columns-row, which then
      // (overflow-x:auto forces overflow-y:auto) showed a stray vertical scrollbar.
      style={{ minHeight: CARD_HEIGHT + Math.max(0, column.length - 1) * CARD_OFFSET }}
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
