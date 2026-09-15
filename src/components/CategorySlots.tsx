import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../store/gameStore'
import type { CategorySlotState } from '../engine/types'

type SlotFx =
  | { kind: 'receive'; key: number; delta: number }
  | { kind: 'complete'; key: number; name: string }

/** Animates .slot-count/.slot-progress-fill counting up one card at a time
 * instead of jumping straight to the new value — most noticeable (and most the
 * point) when a whole same-category stack lands at once and collected jumps by
 * more than 1. Snaps instantly on any decrease (undo) or when the slot starts a
 * different category (index reused after a previous one completed). Stepped via
 * setInterval rather than requestAnimationFrame: this only ever counts through
 * a handful of integers, so a discrete per-card tick reads as "counting cards"
 * more literally than a smooth tween would anyway. */
function useCountUp(target: number): number {
  const [displayed, setDisplayed] = useState(target)
  const prevTarget = useRef(target)

  useEffect(() => {
    const from = prevTarget.current
    prevTarget.current = target
    if (target <= from) {
      setDisplayed(target)
      return
    }
    let current = from
    const id = setInterval(() => {
      current += 1
      setDisplayed(current)
      if (current >= target) clearInterval(id)
    }, 120)
    return () => clearInterval(id)
  }, [target])

  return displayed
}

interface SlotViewProps {
  index: number
  slot: CategorySlotState | null
  isHintTarget: boolean
  effect: SlotFx | undefined
  onClick: () => void
}

function SlotView({ index, slot, isHintTarget, effect, onClick }: SlotViewProps) {
  const displayedCollected = useCountUp(slot?.collected ?? 0)

  return (
    <button
      type="button"
      className={[
        'slot',
        slot ? 'slot-active' : 'slot-empty',
        isHintTarget ? 'slot-hinted' : '',
        effect?.kind === 'receive' ? 'slot-receiving' : '',
      ].join(' ')}
      data-dropzone="slot"
      data-index={index}
      aria-label={slot ? undefined : '空分類欄'}
      onClick={onClick}
    >
      {slot && (
        <>
          <span className="slot-name">【{slot.name}】</span>
          <div className="slot-progress-track">
            <div className="slot-progress-fill" style={{ width: `${(displayedCollected / slot.required) * 100}%` }} />
          </div>
          <span className="slot-count">
            {displayedCollected} / {slot.required}
          </span>
          {slot.lastCard && <span className="slot-last-card">{slot.lastCard.text}</span>}
        </>
      )}
      {effect?.kind === 'receive' && (
        <span key={effect.key} className="slot-plus">
          +{effect.delta}
        </span>
      )}
      {effect?.kind === 'complete' && (
        <span key={effect.key} className="slot-complete-burst">
          ✓ {effect.name}
        </span>
      )}
    </button>
  )
}

export default function CategorySlots() {
  const slots = useGameStore((s) => s.game?.categorySlots ?? [])
  const completed = useGameStore((s) => s.game?.completedCategories ?? [])
  const clickSlot = useGameStore((s) => s.clickSlot)
  const hint = useGameStore((s) => s.hint)

  // Transient per-slot effects (a "+N" bump when cards land, a burst when a
  // category finishes) so a stack vanishing into a slot reads as "collected"
  // rather than "the game glitched".
  const [fx, setFx] = useState<Record<number, SlotFx>>({})
  const prevSlots = useRef(slots)
  const prevCompleted = useRef(completed)

  useEffect(() => {
    const before = prevSlots.current
    const beforeDone = prevCompleted.current
    const added: Record<number, SlotFx> = {}

    slots.forEach((slot, i) => {
      const was = before[i]
      if (slot && was && slot.categoryId === was.categoryId && slot.collected > was.collected) {
        added[i] = { kind: 'receive', key: Date.now() + i, delta: slot.collected - was.collected }
      }
      if (!slot && was && completed.includes(was.categoryId) && !beforeDone.includes(was.categoryId)) {
        added[i] = { kind: 'complete', key: Date.now() + i, name: was.name }
      }
    })

    prevSlots.current = slots
    prevCompleted.current = completed

    if (Object.keys(added).length === 0) return
    setFx((cur) => ({ ...cur, ...added }))
    const timer = setTimeout(() => {
      setFx((cur) => {
        const nextFx = { ...cur }
        for (const [k, v] of Object.entries(added)) {
          const i = Number(k)
          if (nextFx[i]?.key === v.key) delete nextFx[i]
        }
        return nextFx
      })
    }, 950)
    return () => clearTimeout(timer)
  }, [slots, completed])

  return (
    <div className="category-slots">
      {slots.map((slot, i) => {
        const isHintTarget = hint?.to?.zone === 'slot' && hint.to.index === i
        return (
          <SlotView
            key={i}
            index={i}
            slot={slot}
            isHintTarget={isHintTarget}
            effect={fx[i]}
            onClick={() => clickSlot(i)}
          />
        )
      })}
    </div>
  )
}
