# Data Model

All types live in `src/engine/types.ts`. This is a narrative summary — read that file
for the authoritative shapes.

## Content data

- **`WordEntry`** — `{ id, text, possibleCategoryIds, tags?, difficulty? }`. A word's
  `possibleCategoryIds` can list more than one category (the model supports words
  like 企鵝 belonging to bird/antarctic-animal/flightless-bird), but the shipped
  dataset (`src/data/seed.ts`) gives every word exactly one category — see
  `docs/game-design-decisions.md` for why disambiguation logic was deferred.
- **`Category`** — `{ id, name, wordIds, tags?, difficulty? }`. 30 categories ship in
  `src/data/categories.ts`, each with 10 candidate words in `src/data/words.ts`.
- **`LevelConfig`** — author-controlled level definition (category selection, column
  count, category slot count, deck on/off and size, star thresholds, optional seed).
  `src/data/levels.ts` hand-authors 5 Phase-1 test levels.

## Runtime state

- **`Card`** — a discriminated union of `WordCard` (`wordId`, `text`, `categoryId`)
  and `CategoryCard` (`categoryId`, `name`, `requiredWordCount`), both carrying
  `faceUp`.
- **`GameState`** — columns (`Card[][]`), deck, waste, `categorySlots`
  (`(CategorySlotState | null)[]`), `completedCategories`, `categoryMeta` (per-level
  category name/required-count lookup), move count, coins/hints spent this session,
  status, and `history` (see below).
- **`GameStateCore`** vs **`GameState`** — `GameState extends GameStateCore` by adding
  `history: GameStateCore[]`. Splitting these avoids a self-referential `history:
  history[]` type, and keeps undo snapshots cheap to reason about (a snapshot is just
  "the state minus its own history").
- **`Location`** — a tagged union addressing where a card is or is going:
  `{ zone: 'column', index }`, `{ zone: 'waste' }`, or `{ zone: 'slot', index }`.
- **`TodoItem`** — derived (not stored) view of category progress for the UI; see
  `getTodoList` in `src/engine/win.ts`.

## Why `categoryMeta` exists separately from `Category`

`Category` (content data) doesn't know how many words a *specific level* dealt for
it — that's a per-level authoring/generation choice (`LevelConfig.categoryWordCounts`
or a difficulty default). `GameState.categoryMeta[categoryId]` freezes that decision
for the running game (`{ name, required }`), so `checkWin`/`getTodoList`/slot
completion never need to re-consult the static dataset.
