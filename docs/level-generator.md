# Level Generator

## What exists today (`src/engine/createGame.ts`)

`createGame(config: LevelConfig, categories, words)`:

1. For each `categoryId` in `config.categoryIds`, picks a word count (explicit
   `categoryWordCounts[categoryId]` or a difficulty default: 4/5/6 for easy/normal/
   hard), clamped to `[3, 8]` per spec section 4, and to however many words that
   category actually has.
2. Builds one `CategoryCard` plus N `WordCard`s per selected category.
3. Shuffles the full card list with a seeded PRNG (`src/engine/rng.ts`, a small
   mulberry32 implementation keyed off `config.seed ?? config.id`) — same seed always
   deals the same table. This determinism is what will let Daily Challenge (Phase 6)
   give every player the same board for a given day.
4. Splits off `deckSize` cards into the deck (if `deckEnabled`) and deals the rest
   round-robin across `columnCount` columns.
5. Flips only the top card of each column face-up.

This is "author picks the category mix and knobs, generator deals the cards" — the
authoring side of spec section 28. `LevelConfig` is the knob set; nothing about
column count, slot count, or deck size is hardcoded into a component. This
determinism is also what lets Daily Challenge (Phase 6, `src/data/dailyChallenge.ts`)
give every player the same board for a given day without any server coordination —
it just seeds `createGame` from the calendar date.

## The generate → solve → accept/reject pipeline (Phase 3 — built)

Spec section 29 requires that no unsolvable board ever reaches a player.
`src/engine/generator.ts`'s `generateSolvableLevel(base, categories, words)` is the
loop that guarantees it: given a `LevelConfig` missing only its `seed`, it deals the
table with seed `${id}-s0`, runs `solve()` against it, and on failure retries with
`${id}-s1`, `${id}-s2`, ... up to `maxAttempts` (default 8) before giving up and
returning the last attempt flagged `solvable: false`.

`scripts/generate-levels.ts` is the offline authoring tool built on top of this:

```bash
npx tsx scripts/generate-levels.ts
```

For each of 5 chapters it defines a category pool and a difficulty curve (e.g.
daily-life: easy ×3, normal ×4, hard ×1), picks a random category subset per level
from that chapter's pool (seeded, so re-running without code changes reproduces the
same plan), calls `generateSolvableLevel` for each, and — only for levels the solver
actually confirmed — writes the result to `src/data/levels.ts`. All 30 currently
shipped levels were accepted this way on the first or second seed attempt; the script
prints a warning for any level it had to accept unverified (none, currently).

**Star targets are deliberately not derived from the solver's move count** — see
`docs/solver.md` for why a plain DFS's first-found solution is a poor "par" estimate.
Instead `src/data/difficultyShapes.ts`'s `estimateTargets(cardCount)` scales from card
count using the ratios the original Phase 1 hand-authored levels landed on, shared by
both the generator script and Daily Challenge's runtime level construction.

## Still open

`createGame`'s word-selection step doesn't yet consult `WordEntry.possibleCategoryIds`
to avoid ambiguity when a word could fit more than one category *in the categories a
level actually selected* — the shipped dataset sidesteps this by giving every word
exactly one category (see `docs/game-design-decisions.md`). Wiring that check in only
matters once the dataset grows multi-category words.
