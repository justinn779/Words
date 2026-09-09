import { useGameStore } from '../store/gameStore'

export default function CategorySlots() {
  const slots = useGameStore((s) => s.game?.categorySlots ?? [])
  const clickSlot = useGameStore((s) => s.clickSlot)
  const hint = useGameStore((s) => s.hint)

  return (
    <div className="category-slots">
      {slots.map((slot, i) => {
        const isHintTarget = hint?.to?.zone === 'slot' && hint.to.index === i
        return (
          <button
            key={i}
            type="button"
            className={['slot', slot ? 'slot-active' : 'slot-empty', isHintTarget ? 'slot-hinted' : ''].join(' ')}
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
          </button>
        )
      })}
    </div>
  )
}
