// Pure fan-layout math for a tableau column — split out of Column.tsx so that
// file can stay component-only (co-locating a plain function export there trips
// Fast Refresh's "only export components" check). Board.tsx also needs
// worstCaseColumnLen to size every column's reserved height off the same
// collapse logic this module actually renders with.

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
 * The face-down prefix at the bottom of a column: at most the last 2 cards
 * get their own (thin, PEEK_STEP) offset, and everything before that sits
 * bunched at offset 0 behind a badge — the SAME fixed shape regardless of
 * how many face-down cards there actually are, from 1 all the way up. Only a
 * column's own top card ever starts (or gets flipped) face-up, so these are
 * always a contiguous run at index 0, and since they render identically
 * regardless of category (see CardView.tsx's card-back branch) there's no
 * information lost by using this fixed shape from the very first render — a
 * wall of identical card-backs has nothing to show anyway, so there's no
 * reason its rendered footprint should depend on the deal's card count at
 * all. This is what keeps a level's INITIAL deal itself within the reserved
 * height on the larger difficulty shapes (see difficultyShapes.ts); without
 * it, Board.tsx would have to reserve room for the deal's raw card count,
 * which only grows with content and has no ceiling.
 */
function getFaceDownPrefix(column: Card[]): { info: CardRenderInfo[]; nextIndex: number; nextStep: number } {
  const info: CardRenderInfo[] = []
  let faceDownEnd = -1
  while (faceDownEnd + 1 < column.length && !column[faceDownEnd + 1].faceUp) faceDownEnd++
  if (faceDownEnd < 0) return { info, nextIndex: 0, nextStep: 0 }

  const faceDownLen = faceDownEnd + 1
  const peekCount = Math.min(faceDownLen, 3)
  const bunchEnd = faceDownEnd - (peekCount - 1)
  for (let k = 0; k <= bunchEnd; k++) {
    info[k] = { offset: 0, stackedCount: k === bunchEnd ? bunchEnd : 0 }
  }
  for (let j = 1; j < peekCount; j++) {
    info[bunchEnd + j] = { offset: PEEK_STEP * j, stackedCount: 0 }
  }
  return { info, nextIndex: faceDownEnd + 1, nextStep: PEEK_STEP * peekCount }
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
function naturalFannedOffset(column: Card[]): number {
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

/** A synthetic worst case: enough face-down cards to trigger their collapse,
 * then a same-category face-up run long enough to trigger its own — both
 * collapse policies cap their contribution at a fixed number of steps no
 * matter how many cards they're actually hiding (see getFaceDownPrefix and
 * getFaceUpSuffixCollapsed), so this one synthetic column's collapsed length
 * is the most ANY real column, on ANY difficulty, can ever need. */
function buildWorstCaseColumn(): Card[] {
  const faceDown: Card[] = Array.from({ length: 3 }, (_, i) => ({
    id: `worst-case-down-${i}`,
    cardType: 'word',
    wordId: `worst-case-down-${i}`,
    text: '',
    categoryId: 'worst-case',
    faceUp: false,
  }))
  const faceUp: Card[] = Array.from({ length: 3 }, (_, i) => ({
    id: `worst-case-up-${i}`,
    cardType: 'word',
    wordId: `worst-case-up-${i}`,
    text: '',
    categoryId: 'worst-case',
    faceUp: true,
  }))
  return [...faceDown, ...faceUp]
}

/** The reserved column length (Board.tsx's reservedColumnLen) that's always
 * enough — computed once, from the collapse logic itself, rather than
 * measured from whatever a level happens to deal or a player happens to
 * build. A budget derived from the CURRENT board can only be as generous as
 * that snapshot: it can't foresee a run the player hasn't built yet, and
 * feeding a live measurement back into the very card size that measurement
 * depends on risks a resize feedback loop. This has neither problem — it
 * never changes, so it can't fall behind and can't oscillate. */
export function worstCaseColumnLen(): number {
  const column = buildWorstCaseColumn()
  const info = getCardRenderInfo(column, 0)
  return (info[info.length - 1]?.offset ?? 0) + 1
}
