# Solver

## Current implementation (`src/engine/solver.ts`)

`solve(state, maxStates = 40000)` is a depth-first search over `GameState`s reached
via `getAvailableMoves` (single-card moves, every valid partial/whole stack-run move,
category-slot activation, word-to-slot delivery, deck draw, and deck recycle), with
visited-state pruning via a hash that ignores fields irrelevant to reachability
(`moves`, `startedAt`, coin/hint counters). It returns
`{ solvable, moveCount?, statesExplored }`.

It's deliberately simple — no heuristics, no move ordering beyond whatever
`getAvailableMoves` happens to enumerate. Two things keep that tractable enough to be
useful as an authoring check:

- **Every explored state drops its own undo history** (`{ ...result.state, history:
  [] }` in `applyMove`) before being pushed onto the search stack. Early on this
  solver OOM'd almost immediately, because every single simulated move otherwise
  carried a full deep-cloned snapshot via `moves.ts`'s `withHistory` — accumulating
  up to 500 of them per explored state. The solver never undoes anything, so none of
  that is needed.
- **Dedup happens before pushing, not just before processing** — `solve()` hashes
  each candidate next-state and skips it immediately if already visited or already
  queued, instead of letting duplicates pile up on the stack and only discarding them
  on pop. A `maxQueued` cap (`maxStates * 4`) is a hard backstop against runaway
  memory regardless.

With that fixed, `scripts/generate-levels.ts` (Phase 3, see `docs/level-generator.md`)
runs this solver against every one of the 30 shipped levels — including the largest
"hard" boards (6 columns, 5 categories, a 9-card deck) — inside a few minutes total,
confirming all of them are winnable.

## Known limitation: move count is not a "par"

The DFS returns the length of whatever solution it happens to find *first*, which is
almost never short — some of the generated levels' first-found solutions ran into the
thousands of moves purely from unproductive shuffling before stumbling onto a win.
That number is fine as a solvability witness but useless as a difficulty/scoring
signal, which is why `estimateTargets()` (`src/data/difficultyShapes.ts`) deliberately
scales star thresholds from card count instead of solver output — see
`docs/level-generator.md`.

## What's still open

1. **Better move ordering / heuristics** so the search finds a *short* solution
   instead of just *a* solution — e.g. always try word-to-slot and
   category-activation moves before shuffling cards between columns, since those are
   the moves that actually shrink the state space. This is the prerequisite for ever
   using solver output as a real difficulty/par signal.
2. **A faster or bounded-depth variant** for use inside the generator loop itself
   (today's `maxStates: 60000` default per attempt is generous enough for all 30
   current levels, but would need retuning if level sizes grow further).

None of this requires changing the engine's move functions — `solve()` only ever
calls the same public `moveCard`/`moveStack`/`drawDeckCard`/`recycleDeck` functions
the UI uses, so the engine and the solver can never disagree about what's legal.
