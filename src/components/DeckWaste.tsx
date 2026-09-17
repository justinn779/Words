import CardView from './CardView'
import { useGameStore } from '../store/gameStore'

/** Shown for both DeckPile and WastePile: neither renders for a level that
 * has no deck at all, but once a deck exists, an emptied-out deck/waste still
 * needs to render (as an empty placeholder) so the layout doesn't jump. */
function useDeckEnabled(): boolean {
  return useGameStore(
    (s) => (s.game?.deck.length ?? 0) > 0 || (s.game?.waste.length ?? 0) > 0 || Boolean(s.levelConfig?.deckEnabled),
  )
}

/** The draw pile — docks beside the category slots (see Board.tsx's .top-row). */
export function DeckPile() {
  const deckCount = useGameStore((s) => s.game?.deck.length ?? 0)
  const wasteLength = useGameStore((s) => s.game?.waste.length ?? 0)
  const draw = useGameStore((s) => s.draw)
  const deckEnabled = useDeckEnabled()

  if (!deckEnabled) return null

  return (
    <button
      type="button"
      className="deck-pile"
      onClick={draw}
      disabled={deckCount === 0 && wasteLength === 0}
      aria-label={deckCount > 0 ? '抽牌' : '重新循環棄牌堆'}
    >
      {deckCount > 0 ? (
        <div className="card card-back">
          <div className="card-back-pattern" />
          <span className="deck-count">{deckCount}</span>
        </div>
      ) : (
        <div className="card card-empty-pile">{wasteLength > 0 ? '↺' : ''}</div>
      )}
    </button>
  )
}

/** The pile of drawn cards — docks beside the tableau columns (see Board.tsx's
 * .table-row), directly below DeckPile so the two read as one draw-and-play
 * flow split across the category/columns rows rather than two unrelated piles. */
export function WastePile() {
  const waste = useGameStore((s) => s.game?.waste ?? [])
  const deckEnabled = useDeckEnabled()

  if (!deckEnabled) return null

  const wasteTop = waste[waste.length - 1]

  return (
    <div className="waste-pile">
      {wasteTop ? <CardView card={wasteTop} loc={{ zone: 'waste' }} /> : <div className="card card-empty-pile" />}
    </div>
  )
}
