// A best-effort solver used to validate that generated/hand-built levels are winnable.
// See docs/solver.md for its limitations and the Phase 3 plan.

import type { AvailableMove, GameState } from './types'
import { getAvailableMoves } from './hint'
import { moveCard, moveStack, drawDeckCard, recycleDeck } from './moves'
import { checkWin } from './win'

export interface SolveResult {
  solvable: boolean
  moveCount?: number
  statesExplored: number
}

/** Hashes the strategically-relevant parts of state, ignoring counters that don't affect reachability. */
function hashState(state: GameState): string {
  const simplify = (c: { id: string; faceUp: boolean }) => `${c.id}:${c.faceUp ? 1 : 0}`
  return JSON.stringify({
    columns: state.columns.map((col) => col.map(simplify)),
    deck: state.deck.map((c) => c.id),
    waste: state.waste.map((c) => c.id),
    slots: state.categorySlots.map((s) => (s ? `${s.categoryId}:${s.collected}` : null)),
  })
}

function applyMove(state: GameState, move: AvailableMove): GameState | null {
  if (move.kind === 'draw') return drawDeckCard(state)
  if (move.kind === 'recycle') return recycleDeck(state)
  if (!move.cardId || !move.to) return null
  const result =
    move.kind === 'stack' && move.from?.zone === 'column' && move.stackStartIndex !== undefined
      ? moveStack(state, move.from.index, move.stackStartIndex, move.to)
      : moveCard(state, move.cardId, move.to)
  if (!result.success) return null
  // The solver never undoes anything, so drop the accumulated snapshot history
  // (moves.ts's withHistory would otherwise clone the whole board on every single
  // move explored, which blows up memory across a search of any real depth).
  return { ...result.state, history: [] }
}

/**
 * Depth-first search with visited-state pruning. Deduplicates *before* pushing (not
 * just before processing) to keep the stack itself bounded, and caps total queued
 * nodes as a hard memory safety net — usable as an offline authoring check for
 * small-to-medium hand-built/generated levels.
 */
export function solve(initialState: GameState, maxStates = 40000): SolveResult {
  const visited = new Set<string>()
  const stack: { state: GameState; depth: number }[] = [{ state: initialState, depth: 0 }]
  const maxQueued = maxStates * 4
  let statesExplored = 0

  visited.add(hashState(initialState))

  while (stack.length > 0) {
    const { state, depth } = stack.pop()!
    if (checkWin(state)) {
      return { solvable: true, moveCount: depth, statesExplored }
    }
    statesExplored++
    if (statesExplored > maxStates) break

    for (const move of getAvailableMoves(state)) {
      const next = applyMove(state, move)
      if (!next) continue
      const key = hashState(next)
      if (visited.has(key)) continue
      visited.add(key)
      if (visited.size > maxQueued) continue
      stack.push({ state: next, depth: depth + 1 })
    }
  }

  return { solvable: false, statesExplored }
}
