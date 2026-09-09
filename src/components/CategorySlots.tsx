import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../store/gameStore'

type SlotFx =
  | { kind: 'receive'; key: number; delta: number }
  | { kind: 'complete'; key: number; name: string }

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
        const effect = fx[i]
        return (
          <button
            key={i}
            type="button"
            className={[
              'slot',
              slot ? 'slot-active' : 'slot-empty',
              isHintTarget ? 'slot-hinted' : '',
              effect?.kind === 'receive' ? 'slot-receiving' : '',
            ].join(' ')}
            data-dropzone="slot"
            data-index={i}
            onClick={() => clickSlot(i)}
          >
            {slot ? (
              <>
                <span className="slot-name">【{slot.name}】</span>
                <div className="slot-progress-track">
                  <div
                    className="slot-progress-fill"
                    style={{ width: `${(slot.collected / slot.required) * 100}%` }}
                  />
                </div>
                <span className="slot-count">
                  {slot.collected} / {slot.required}
                </span>
              </>
            ) : (
              <span className="slot-placeholder">空分類欄</span>
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
      })}
    </div>
  )
}
