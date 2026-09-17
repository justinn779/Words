// Pure fan-layout math for a tableau column — split out of Column.tsx so that
// file can stay component-only (co-locating a plain function export there trips
// Fast Refresh's "only export components" check). Board.tsx also needs
// reservedColumnLen to size every column's reserved height off the same
// layout math this module actually renders with.

import type { Card } from '../engine/types'

/** How much of a hidden card peeks out from behind the one in front of it —
 * in units of a normal (uncollapsed) fan step. A face-down card shows
 * nothing (every card-back looks identical — see CardView.tsx) and a
 * collapsed same-category card's word is already implied by the ones still
 * fully visible, so a thin sliver is enough to read as "there's more here"
 * without eating into the column's height the way a full step would. */
const PEEK_STEP = 1 / 3

/** The fixed number of thin peek steps a collapsed same-category run always
 * reserves once it's long enough to collapse (see getFaceUpSuffixCollapsed)
 * — older members bunch behind a badge, and only the newest
 * COLLAPSED_GROUP_STEPS-1 each get their own peek, no matter how long the
 * run actually is. */
const COLLAPSED_GROUP_STEPS = 3

export interface CardRenderInfo {
  /** Fan-step offset, in units of --card-step. */
  offset: number
  /** Cards hidden directly behind this one at the same offset — see below. */
  stackedCount: number
}

/**
 * The face-down prefix at the bottom of a column: every face-down card gets
 * its own thin (PEEK_STEP) peek, drawn individually — no bunching, no "+N"
 * badge standing in for the ones underneath. A column's face-down count is
 * fixed the moment the level is dealt (flipping a card only ever shrinks it;
 * nothing during play ever adds to it — see gameStore.ts's flipTopCard), so
 * unlike a face-up run it can never grow past what Board.tsx already
 * accounted for when the level started — there's nothing here that needs
 * capping, only keeping thin. Only a column's own top card ever starts (or
 * gets flipped) face-up, so these are always a contiguous run at index 0.
 */
function getFaceDownPrefix(column: Card[]): { info: CardRenderInfo[]; nextIndex: number; nextStep: number } {
  const info: CardRenderInfo[] = []
  let faceDownEnd = -1
  while (faceDownEnd + 1 < column.length && !column[faceDownEnd + 1].faceUp) faceDownEnd++
  for (let k = 0; k <= faceDownEnd; k++) {
    info[k] = { offset: PEEK_STEP * k, stackedCount: 0 }
  }
  return { info, nextIndex: faceDownEnd + 1, nextStep: PEEK_STEP * (faceDownEnd + 1) }
}

/** Every remaining (face-up) card gets its own fan step — no collapsing. */
function getFaceUpSuffixNatural(column: Card[], start: number, startStep: number): CardRenderInfo[] {
  const info: CardRenderInfo[] = []
  for (let i = start; i < column.length; i++) info[i] = { offset: startStep + (i - start), stackedCount: 0 }
  return info
}

/**
 * The face-up suffix, with a same-category word run of COLLAPSED_GROUP_STEPS+
 * cards (optionally capped by that category's own Category Card — see
 * game-rules.md) collapsed down to just 2 thin peek steps (PEEK_STEP): its
 * older members share one step instead of each adding their own, with only
 * the frontmost of that shared group actually visible — flagged with
 * `stackedCount` (how many more are hidden directly behind it) so CardView
 * can badge it, rather than silently disappearing. This one DOES need a real
 * cap, unlike the face-down prefix above: a run grows as the player plays,
 * with no ceiling of its own (a category could need arbitrarily many words),
 * so its rendered footprint has to stop growing once it reaches this shape.
 * Only used once getFaceUpSuffixNatural's height would exceed the column's
 * reserved budget. Clicking/dragging still picks up the whole bound group
 * regardless of any of this (see gameStore.ts's tryPickSelection) — it only
 * changes where cards are drawn from, never what counts as pickable.
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
      if (runLen >= COLLAPSED_GROUP_STEPS) {
        const collapsedFront = runEnd - 2
        for (let k = i; k <= collapsedFront; k++) {
          info[k] = { offset: step, stackedCount: k === collapsedFront ? collapsedFront - i : 0 }
        }
        info[runEnd - 1] = { offset: step + PEEK_STEP, stackedCount: 0 }
        info[runEnd] = { offset: step + PEEK_STEP * 2, stackedCount: 0 }
        step += PEEK_STEP * COLLAPSED_GROUP_STEPS
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
 * rendered (see getFaceDownPrefix) but its face-up suffix left natural — the
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

/** A synthetic same-category run, exactly long enough to trigger its own
 * collapse — used to measure the face-up portion's own worst-case footprint
 * (see reservedColumnLen below). Collapsing already caps this at a fixed
 * number of steps no matter how much longer a real run grows past this
 * length (see getFaceUpSuffixCollapsed), so this one synthetic run's
 * collapsed height is the most a real run can ever add. */
function faceUpWorstCaseOffset(): number {
  const run: Card[] = Array.from({ length: COLLAPSED_GROUP_STEPS }, (_, i) => ({
    id: `worst-case-up-${i}`,
    cardType: 'word',
    wordId: `worst-case-up-${i}`,
    text: '',
    categoryId: 'worst-case',
    faceUp: true,
  }))
  const collapsed = getFaceUpSuffixCollapsed(run, 0, 0)
  return collapsed[collapsed.length - 1]?.offset ?? 0
}

/** Board.tsx's per-level reserved column height: the tallest column's actual
 * face-down count (fixed the moment this level was dealt — see
 * getFaceDownPrefix) plus the face-up portion's own fixed worst case. Meant
 * to be computed once per level (from `columns` read at deal time, not
 * reactively on every render) and then left alone — a column's face-down
 * count can only shrink from here, and a face-up run can grow but is always
 * capped at faceUpWorstCaseOffset's contribution once it does, so this
 * never falls behind no matter how the player plays out the level.
 * Deliberately NOT sourced from any DOM measurement — see Board.tsx's own
 * comment on why a --card-w computed from a measurement that --card-w itself
 * goes on to affect is a resize feedback loop waiting to happen. */
export function reservedColumnLen(columns: Card[][]): number {
  const maxFaceDownStep = Math.max(0, ...columns.map((c) => getFaceDownPrefix(c).nextStep))
  return maxFaceDownStep + faceUpWorstCaseOffset() + 1
}
