import CardView from './CardView'
import { useGameStore } from '../store/gameStore'
import { getCardRenderInfo } from './columnLayout'

interface ColumnProps {
  columnIndex: number
  /** The height every column is sized for — Board.tsx's RESERVED_COLUMN_LEN.
   * The face-down prefix (see columnLayout.ts) always collapses regardless of
   * this budget; the face-up same-category run only collapses once the
   * column's total height would otherwise exceed it. */
  maxColumnLen: number
}

export default function Column({ columnIndex, maxColumnLen }: ColumnProps) {
  const column = useGameStore((s) => s.game?.columns[columnIndex] ?? [])
  const clickEmptyColumn = useGameStore((s) => s.clickEmptyColumn)

  const renderInfo = getCardRenderInfo(column, maxColumnLen)
  const fanned = renderInfo.length > 0 ? renderInfo[renderInfo.length - 1].offset : 0

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
          style={{ position: 'absolute', top: `calc(${renderInfo[i].offset} * var(--card-step))`, left: 0, right: 0, zIndex: i }}
          stackedCount={renderInfo[i].stackedCount}
        />
      ))}
    </div>
  )
}
