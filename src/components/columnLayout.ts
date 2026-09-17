// Pure fan-layout math for a tableau column — split out of Column.tsx so that
// file can stay component-only (co-locating a plain function export there trips
// Fast Refresh's "only export components" check). Board.tsx also needs
// naturalFannedOffset to size every column's reserved height off the same math
// this module actually renders with.

import type { Card } from '../engine/types'

/** How much of a hidden card peeks out from behind the one in front of it,
 * within a collapsed group — in units of a normal (uncollapsed) fan step. A
 * collapsed card shows no information worth spending a full step's peek on
 * (a card-back is identical to every other, and a collapsed same-category
 * card's word is already implied by the ones still fully visible), so a
 * sliver is enough to read as "more cards are stacked here" without eating
 * into the column's height budget the way a full step would. */
const PEEK_STEP = 1 / 3

export interface CardRenderInfo {
  /** Fan-step offset, in units of --card-step. */
  offset: number
  /** Cards hidden directly behind this one at the same offset — see below. */
  stackedCount: number
}

/**
 * The face-down prefix at the bottom of a column, always collapsed to 2 fan
 * steps once it's 3+ cards long — unconditionally, not just once the column
 * outgrows its budget. Only a column's own top card ever starts (or gets
 * flipped) face-up, so these are always a contiguous run at index 0, and since
 * they render identically regardless of category (see CardView.tsx's
 * card-back branch) there's no information lost by collapsing them from the
 * very first render — a wall of identical card-backs has nothing to show
 * anyway. This is what keeps a level's INITIAL deal itself within the
 * reserved height on the larger difficulty shapes (see difficultyShapes.ts);
 * without it, Board.tsx would have to reserve room for the deal's raw card
 * count, which only grows with content and has no ceiling.
 */
function getFaceDownPrefix(column: Card[]): { info: CardRenderInfo[]; nextIndex: number; nextStep: number } {
  const info: CardRenderInfo[] = []
  let faceDownEnd = -1
  while (faceDownEnd + 1 < column.length && !column[faceDownEnd + 1].faceUp) faceDownEnd++
  if (faceDownEnd < 0) return { info, nextIndex: 0, nextStep: 0 }

  const faceDownLen = faceDownEnd + 1
  if (faceDownLen >= 3) {
    const collapsedFront = faceDownEnd - 2
    for (let k = 0; k <= collapsedFront; k++) {
      info[k] = { offset: 0, stackedCount: k === collapsedFront ? collapsedFront : 0 }
    }
    info[faceDownEnd - 1] = { offset: PEEK_STEP, stackedCount: 0 }
    info[faceDownEnd] = { offset: PEEK_STEP * 2, stackedCount: 0 }
    return { info, nextIndex: faceDownEnd + 1, nextStep: PEEK_STEP * 3 }
  }
  for (let k = 0; k <= faceDownEnd; k++) info[k] = { offset: k, stackedCount: 0 }
  return { info, nextIndex: faceDownEnd + 1, nextStep: faceDownLen }
}

/** Every remaining (face-up) card gets its own fan step — no collapsing. */
function getFaceUpSuffixNatural(column: Card[], start: number, startStep: number): CardRenderInfo[] {
  const info: CardRenderInfo[] = []
  for (let i = start; i < column.length; i++) info[i] = { offset: startStep + (i - start), stackedCount: 0 }
  return info
}

/**
 * The face-up suffix, with a same-category word run of 3+ cards (optionally
 * capped by that category's own Category Card — see game-rules.md) collapsed
 * down to just 2 fan steps: its older members share one step instead of each
 * adding their own, with only the frontmost of that shared group actually
 * visible — flagged with `stackedCount` (how many more are hidden directly
 * behind it) so CardView can badge it, rather than silently disappearing.
 * Only used once getFaceUpSuffixNatural's height would exceed the column's
 * reserved budget — unlike the face-down prefix above, a face-up run's word
 * text is actual information, so it stays fully fanned whenever there's room.
 * Clicking/dragging still picks up the whole bound group regardless of any of
 * this (see gameStore.ts's tryPickSelection) — it only changes where cards
 * are drawn from, never what counts as pickable.
 */
function getFaceUpSuffixCollapsed(column: Card[], start: number, startStep: number): CardRenderInfo[] {
  const info: CardRenderInfo[] = []
  let step = startStep
  let i = start
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
        info[runEnd - 1] = { offset: step + PEEK_STEP, stackedCount: 0 }
        info[runEnd] = { offset: step + PEEK_STEP * 2, stackedCount: 0 }
        step += PEEK_STEP * 3
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

/** The fan-step offset of a column's last card with its face-down prefix
 * collapsed (see getFaceDownPrefix) but its face-up suffix left natural — the
 * height a column needs before deciding whether the same-category run also
 * needs to collapse. */
export function naturalFannedOffset(column: Card[]): number {
  if (column.length === 0) return 0
  const prefix = getFaceDownPrefix(column)
  const natural = getFaceUpSuffixNatural(column, prefix.nextIndex, prefix.nextStep)
  return (natural[column.length - 1] ?? prefix.info[column.length - 1]).offset
}

export function getCardRenderInfo(column: Card[], maxColumnLen: number): CardRenderInfo[] {
  const prefix = getFaceDownPrefix(column)
  const natural = getFaceUpSuffixNatural(column, prefix.nextIndex, prefix.nextStep)
  const suffix = naturalFannedOffset(column) > maxColumnLen ? getFaceUpSuffixCollapsed(column, prefix.nextIndex, prefix.nextStep) : natural
  return [...prefix.info.slice(0, prefix.nextIndex), ...suffix.slice(prefix.nextIndex)]
}
