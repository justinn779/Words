import CardView from './CardView'
import { useGameStore } from '../store/gameStore'

interface DeckWasteProps {
  /** Extra class on the root .deck-waste — Board.tsx renders this component
   * twice (once docked beside the category slots, once beside the columns)
   * and uses this to pick which copy a media query shows. */
  className?: string
}

export default function DeckWaste({ className }: DeckWasteProps) {
  const deckCount = useGameStore((s) => s.game?.deck.length ?? 0)
  const waste = useGameStore((s) => s.game?.waste ?? [])
  const deckEnabled = useGameStore((s) => (s.game?.deck.length ?? 0) > 0 || (s.game?.waste.length ?? 0) > 0 || s.levelConfig?.deckEnabled)
  const draw = useGameStore((s) => s.draw)

  if (!deckEnabled) return null

  const wasteTop = waste[waste.length - 1]

  return (
    <div className={className ? `deck-waste ${className}` : 'deck-waste'}>
      <button
        type="button"
        className="deck-pile"
        onClick={draw}
        disabled={deckCount === 0 && waste.length === 0}
        aria-label={deckCount > 0 ? '抽牌' : '重新循環棄牌堆'}
      >
        {deckCount > 0 ? (
          <div className="card card-back">
            <div className="card-back-pattern" />
            <span className="deck-count">{deckCount}</span>
          </div>
        ) : (
          <div className="card card-empty-pile">{waste.length > 0 ? '↺' : ''}</div>
        )}
      </button>
      <div className="waste-pile">
        {wasteTop ? (
          <CardView card={wasteTop} loc={{ zone: 'waste' }} />
        ) : (
          <div className="card card-empty-pile" />
        )}
      </div>
    </div>
  )
}
