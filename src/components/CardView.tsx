import { useRef } from 'react'
import type { Card } from '../engine/types'
import { useGameStore, type CardLoc } from '../store/gameStore'
import { findDropzoneAt, DRAG_THRESHOLD } from '../utils/dropzone'

interface CardViewProps {
  card: Card
  loc: CardLoc
  style?: React.CSSProperties
}

export default function CardView({ card, loc, style }: CardViewProps) {
  const selection = useGameStore((s) => s.selection)
  const hint = useGameStore((s) => s.hint)
  const invalidFlash = useGameStore((s) => s.invalidFlash)
  const dragVisual = useGameStore((s) => s.dragVisual)
  const clickCard = useGameStore((s) => s.clickCard)
  const selectAt = useGameStore((s) => s.selectAt)
  const moveSelectionTo = useGameStore((s) => s.moveSelectionTo)
  const cancelDrag = useGameStore((s) => s.cancelDrag)
  const setDragVisual = useGameStore((s) => s.setDragVisual)
  const game = useGameStore((s) => s.game)

  const press = useRef<{ x: number; y: number; dragStarted: boolean; pointerId: number } | null>(null)
  const rafPending = useRef(false)

  // The store clears invalidFlash on its own timer, so this is derived purely from
  // state during render — no local timer/effect needed to animate the shake.
  const shake = invalidFlash?.cardId === card.id
  const isSelected = selection?.cardId === card.id
  const isHinted = hint?.cardId === card.id
  const dragOffset = dragVisual?.cardIds.includes(card.id) ? dragVisual : null

  if (!card.faceUp) {
    return (
      <div className="card card-back" style={style} aria-hidden>
        <div className="card-back-pattern" />
      </div>
    )
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    press.current = { x: e.clientX, y: e.clientY, dragStarted: false, pointerId: e.pointerId }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent) {
    const p = press.current
    if (!p || p.pointerId !== e.pointerId) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y

    if (!p.dragStarted) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      const picked = selectAt(loc)
      if (!picked) return // source not pickable — fall through to a tap on release instead
      p.dragStarted = true
      const g = useGameStore.getState().game
      const sel = useGameStore.getState().selection
      if (g && sel) {
        const cardIds =
          sel.kind === 'waste' ? [sel.cardId] : g.columns[sel.columnIndex].slice(sel.cardIndex).map((c) => c.id)
        setDragVisual({ cardIds, dx: 0, dy: 0 })
      }
    }

    if (p.dragStarted && !rafPending.current) {
      rafPending.current = true
      requestAnimationFrame(() => {
        rafPending.current = false
        const sel = useGameStore.getState().selection
        const g = useGameStore.getState().game
        if (!sel || !g) return
        const cardIds =
          sel.kind === 'waste' ? [sel.cardId] : g.columns[sel.columnIndex].slice(sel.cardIndex).map((c) => c.id)
        setDragVisual({ cardIds, dx, dy })
      })
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    const p = press.current
    press.current = null
    if (!p || p.pointerId !== e.pointerId) return

    if (p.dragStarted) {
      const dropLoc = findDropzoneAt(e.clientX, e.clientY)
      const moved = dropLoc ? moveSelectionTo(dropLoc) : false
      if (!moved) cancelDrag()
      setDragVisual(null)
    } else {
      clickCard(loc)
    }
  }

  function handlePointerCancel() {
    const p = press.current
    press.current = null
    if (p?.dragStarted) cancelDrag()
    setDragVisual(null)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    clickCard(loc)
  }

  const isCategory = card.cardType === 'category'
  const label = isCategory ? `【${card.name}】` : card.text
  const progress = isCategory && game ? game.categoryMeta[card.categoryId] : null
  const ariaLabel = `${isCategory ? '分類卡' : '文字卡'} ${label}${isSelected ? '（已選取）' : ''}`

  const combinedStyle: React.CSSProperties = {
    ...style,
    transform: dragOffset ? `translate(${dragOffset.dx}px, ${dragOffset.dy}px)` : undefined,
    zIndex: dragOffset ? 500 : style?.zIndex,
  }

  return (
    <div
      className={[
        'card',
        isCategory ? 'card-category' : 'card-word',
        isSelected ? 'card-selected' : '',
        isHinted ? 'card-hinted' : '',
        shake ? 'card-shake' : '',
        dragOffset ? 'card-dragging' : '',
        'card-reveal',
      ]
        .filter(Boolean)
        .join(' ')}
      style={combinedStyle}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
    >
      <span className="card-label">{label}</span>
      {isCategory && progress && <span className="card-sub">{progress.required} 張</span>}
    </div>
  )
}
