import type { Card } from '../engine/types'
import CardView from './CardView'
import { useGameStore } from '../store/gameStore'

interface ColumnProps {
  columnIndex: number
}

/**
 * Fan-step offset (in units of --card-step) for each card in the column. A
 * same-category, face-up word run of 3+ cards (optionally capped by that
 * category's own Category Card — see game-rules.md) collapses down to just 2
 * fan steps: its older members stack flush behind the front instead of each
 * adding their own step. Without this, a player deliberately piling up a
 * whole category before delivering it to a slot could grow a column past the
 * height Board.tsx reserves for it. Clicking/dragging still picks up the
 * whole bound group regardless (see gameStore.ts's tryPickSelection) — this
 * only changes where cards are drawn, not what a click resolves to.
 */
function getCardOffsets(column: Card[]): number[] {
  const offsets: number[] = []
  let step = 0
  let i = 0
  while (i < column.length) {
    const card = column[i]
    if (card.faceUp && card.cardType === 'word') {
      let runEnd = i
      while (runEnd + 1 < column.length) {
        const next = column[runEnd + 1]
        if (next.faceUp && next.cardType === 'word' && next.categoryId === card.categoryId) runEnd++
        else break
      }
      // A capping Category Card (same category) rides along as part of the run.
      const capCandidate = column[runEnd + 1]
      if (capCandidate?.faceUp && capCandidate.cardType === 'category' && capCandidate.categoryId === card.categoryId) {
        runEnd++
      }
      const runLen = runEnd - i + 1
      if (runLen >= 3) {
        for (let k = i; k <= runEnd - 2; k++) offsets[k] = step
        offsets[runEnd - 1] = step + 1
        offsets[runEnd] = step + 2
        step += 2
      } else {
        for (let k = i; k <= runEnd; k++) {
          offsets[k] = step
          step += 1
        }
      }
      i = runEnd + 1
    } else {
      offsets[i] = step
      step += 1
      i++
    }
  }
  return offsets
}

export default function Column({ columnIndex }: ColumnProps) {
  const column = useGameStore((s) => s.game?.columns[columnIndex] ?? [])
  const clickEmptyColumn = useGameStore((s) => s.clickEmptyColumn)

  const offsets = getCardOffsets(column)
  const fanned = offsets.length > 0 ? offsets[offsets.length - 1] : 0

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
          style={{ position: 'absolute', top: `calc(${offsets[i]} * var(--card-step))`, left: 0, right: 0, zIndex: i }}
        />
      ))}
    </div>
  )
}
