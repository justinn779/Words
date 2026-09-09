import type { Location } from '../engine/types'

/** Reads the nearest `data-dropzone` ancestor under a point into an engine Location. */
export function findDropzoneAt(x: number, y: number): Location | null {
  const el = document.elementFromPoint(x, y)
  const zoneEl = el?.closest<HTMLElement>('[data-dropzone]')
  if (!zoneEl) return null
  const zone = zoneEl.dataset.dropzone
  const index = Number(zoneEl.dataset.index)
  if (zone === 'column' && Number.isInteger(index)) return { zone: 'column', index }
  if (zone === 'slot' && Number.isInteger(index)) return { zone: 'slot', index }
  return null
}

export const DRAG_THRESHOLD = 6
