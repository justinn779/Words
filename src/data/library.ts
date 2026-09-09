// Phase 7 — Library meta-game. Fixed slots (spec section 42), each with a few
// swappable items (section 43) unlocked either by coins or by a stat/achievement
// condition. No free furniture placement in v1 — see game-design-decisions.md.

export type UnlockCondition =
  | { type: 'default' }
  | { type: 'coins'; amount: number }
  | { type: 'stat'; statKey: 'totalCategoriesCompleted' | 'dailyStreak' | 'totalStars'; min: number }
  | { type: 'achievement'; achievementId: string }

export interface LibraryItemDef {
  id: string
  slotId: string
  name: string
  unlock: UnlockCondition
}

export interface LibrarySlotDef {
  id: string
  name: string
}

export const LIBRARY_SLOTS: LibrarySlotDef[] = [
  { id: 'bookshelf', name: '書架' },
  { id: 'desk', name: '書桌' },
  { id: 'chair', name: '椅子' },
  { id: 'rug', name: '地毯' },
  { id: 'window', name: '窗戶' },
  { id: 'lamp', name: '燈' },
  { id: 'plant', name: '植物' },
  { id: 'table', name: '咖啡桌' },
  { id: 'painting', name: '掛畫' },
  { id: 'clock', name: '時鐘' },
  { id: 'gramophone', name: '留聲機' },
]

export const LIBRARY_ITEMS: LibraryItemDef[] = [
  { id: 'bookshelf-wood', slotId: 'bookshelf', name: '木質書架', unlock: { type: 'default' } },
  { id: 'bookshelf-white', slotId: 'bookshelf', name: '白色書架', unlock: { type: 'coins', amount: 150 } },
  { id: 'bookshelf-vintage', slotId: 'bookshelf', name: '老式書櫃', unlock: { type: 'stat', statKey: 'totalCategoriesCompleted', min: 100 } },

  { id: 'desk-walnut', slotId: 'desk', name: '胡桃木桌', unlock: { type: 'default' } },
  { id: 'desk-oak', slotId: 'desk', name: '白橡木桌', unlock: { type: 'coins', amount: 150 } },
  { id: 'desk-classic', slotId: 'desk', name: '古典書桌', unlock: { type: 'achievement', achievementId: 'no-hint-10' } },

  { id: 'chair-simple', slotId: 'chair', name: '素色椅', unlock: { type: 'default' } },
  { id: 'chair-cushion', slotId: 'chair', name: '軟墊椅', unlock: { type: 'coins', amount: 100 } },

  { id: 'rug-plain', slotId: 'rug', name: '素面地毯', unlock: { type: 'default' } },
  { id: 'rug-pattern', slotId: 'rug', name: '花紋地毯', unlock: { type: 'coins', amount: 120 } },

  { id: 'window-plain', slotId: 'window', name: '普通窗戶', unlock: { type: 'default' } },
  { id: 'window-morning', slotId: 'window', name: '晨光窗戶', unlock: { type: 'stat', statKey: 'totalStars', min: 60 } },

  { id: 'lamp-simple', slotId: 'lamp', name: '簡約檯燈', unlock: { type: 'default' } },
  { id: 'lamp-vintage', slotId: 'lamp', name: '復古檯燈', unlock: { type: 'stat', statKey: 'dailyStreak', min: 7 } },

  { id: 'plant-small', slotId: 'plant', name: '小盆栽', unlock: { type: 'default' } },
  { id: 'plant-large', slotId: 'plant', name: '大型植栽', unlock: { type: 'coins', amount: 180 } },

  { id: 'table-simple', slotId: 'table', name: '素色咖啡桌', unlock: { type: 'default' } },
  { id: 'table-marble', slotId: 'table', name: '大理石咖啡桌', unlock: { type: 'coins', amount: 200 } },

  { id: 'painting-none', slotId: 'painting', name: '留白', unlock: { type: 'default' } },
  { id: 'painting-landscape', slotId: 'painting', name: '風景畫', unlock: { type: 'coins', amount: 120 } },

  { id: 'clock-simple', slotId: 'clock', name: '素面時鐘', unlock: { type: 'default' } },
  { id: 'clock-antique', slotId: 'clock', name: '古董時鐘', unlock: { type: 'achievement', achievementId: 'first-hard-clear' } },

  { id: 'gramophone-none', slotId: 'gramophone', name: '（未擺放）', unlock: { type: 'default' } },
  { id: 'gramophone-classic', slotId: 'gramophone', name: '古典留聲機', unlock: { type: 'coins', amount: 250 } },
]

export function getItemsForSlot(slotId: string): LibraryItemDef[] {
  return LIBRARY_ITEMS.filter((i) => i.slotId === slotId)
}

export function getDefaultItemForSlot(slotId: string): LibraryItemDef {
  const item = LIBRARY_ITEMS.find((i) => i.slotId === slotId && i.unlock.type === 'default')
  if (!item) throw new Error(`Slot ${slotId} has no default item`)
  return item
}
