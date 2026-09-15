import type { Card } from '../engine/types'
import CardView from './CardView'
import { useGameStore } from '../store/gameStore'

interface ColumnProps {
  columnIndex: number
}

interface CardRenderInfo {
  /** Fan-step offset, in units of --card-step. */
  offset: number
  /** Cards hidden directly behind this one at the same offset — see below. */
  stackedCount: number
}

/**
 * Per-card fan position for a column. A same-category, face-up word run of 3+
 * cards (optionally capped by that category's own Category Card — see
 * game-rules.md) collapses down to just 2 fan steps: its older members share
 * one step instead of each adding their own, with only the frontmost of that
 * shared group actually visible — flagged with `stackedCount` (how many more
 * are hidden directly behind it) so CardView can badge it, rather than
 * silently disappearing. Without the collapse itself, a player deliberately
 * piling up a whole category before delivering it to a slot could grow a
 * column past the height Board.tsx reserves for it. Clicking/dragging still
 * picks up the whole bound group regardless of any of this (see
 * gameStore.ts's tryPickSelection) — it only changes where cards are drawn.
 */
function getCardRenderInfo(column: Card[]): CardRenderInfo[] {
  const info: CardRenderInfo[] = []
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
        const collapsedFront = runEnd - 2
        for (let k = i; k <= collapsedFront; k++) {
          info[k] = { offset: step, stackedCount: k === collapsedFront ? collapsedFront - i : 0 }
        }
        info[runEnd - 1] = { offset: step + 1, stackedCount: 0 }
        info[runEnd] = { offset: step + 2, stackedCount: 0 }
        step += 2
      } else {
        for (let k = i; k <= runEnd; k++) {
          info[k] = { offset: step, stackedCount: 0 }
          step += 1
        }
      }
      i = runEnd + 1
    } else {
      info[i] = { offset: step, stackedCount: 0 }
      step += 1
      i++
    }
  }
  return info
}

export default function Column({ columnIndex }: ColumnProps) {
  const column = useGameStore((s) => s.game?.columns[columnIndex] ?? [])
  const clickEmptyColumn = useGameStore((s) => s.clickEmptyColumn)

  const renderInfo = getCardRenderInfo(column)
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
