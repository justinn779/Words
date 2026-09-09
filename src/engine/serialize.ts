import type { GameState } from './types'

export function serializeGameState(state: GameState): string {
  return JSON.stringify(state)
}

export function deserializeGameState(json: string): GameState {
  return JSON.parse(json) as GameState
}
