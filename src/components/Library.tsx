import { LIBRARY_SLOTS, getItemsForSlot, type LibraryItemDef, type UnlockCondition } from '../data/library'
import { usePlayerStore } from '../store/playerStore'

interface LibraryProps {
  onBack: () => void
}

function unlockLabel(unlock: UnlockCondition): string {
  if (unlock.type === 'default') return '預設'
  if (unlock.type === 'coins') return `${unlock.amount} 金幣`
  if (unlock.type === 'stat') {
    const label = unlock.statKey === 'totalCategoriesCompleted' ? '累積完成分類' : unlock.statKey === 'dailyStreak' ? '每日挑戰連續天數' : '累積星星'
    return `${label} ≥ ${unlock.min}`
  }
  return '特定成就'
}

export default function Library({ onBack }: LibraryProps) {
  const library = usePlayerStore((s) => s.library)
  const coins = usePlayerStore((s) => s.coins)
  const purchaseLibraryItem = usePlayerStore((s) => s.purchaseLibraryItem)
  const equipLibraryItem = usePlayerStore((s) => s.equipLibraryItem)

  const isUnlocked = (item: LibraryItemDef) => library.unlockedItemIds.includes(item.id)

  return (
    <div className="list-screen">
      <div className="list-header">
        <button type="button" className="hud-back" onClick={onBack}>
          ← 返回
        </button>
        <h1>我的圖書館</h1>
        <span className="hud-coins">🪙 {coins}</span>
      </div>
      <ul className="library-slot-list">
        {LIBRARY_SLOTS.map((slot) => {
          const items = getItemsForSlot(slot.id)
          const equippedId = library.equipped[slot.id]
          return (
            <li key={slot.id} className="library-slot">
              <div className="library-slot-name">{slot.name}</div>
              <div className="library-item-options">
                {items.map((item) => {
                  const unlocked = isUnlocked(item)
                  const equipped = equippedId === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={['library-item-chip', equipped ? 'library-item-equipped' : '', unlocked ? '' : 'library-item-locked'].join(' ')}
                      onClick={() => {
                        if (unlocked) equipLibraryItem(slot.id, item.id)
                        else if (item.unlock.type === 'coins') purchaseLibraryItem(item.id)
                      }}
                      title={unlocked ? item.name : `解鎖條件：${unlockLabel(item.unlock)}`}
                    >
                      <span>{item.name}</span>
                      {!unlocked && <span className="library-item-requirement">{unlockLabel(item.unlock)}</span>}
                    </button>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
