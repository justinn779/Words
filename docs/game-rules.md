# Game Rules (as implemented)

This describes the rules exactly as `src/engine` enforces them. If UI behavior and
this document ever disagree, the engine (and its tests) are the source of truth.

## Board

- The table has `columnCount` columns, each a pile of cards. The **top** of a pile is
  the last element of its array.
- Only the top card of a column (or of the waste pile) can be picked up.
- Every card starts face-down except the top card of each column.
- Removing a column's top card automatically flips the new top card face-up
  (`flipTopCard`), if it was face-down.

## Word Card stacking

- A Word Card may be placed on: an empty column, or a Word Card/stack of the **same
  category**.
- A Word Card may **never** be placed on a Category Card, active or not.
- A contiguous, face-up run of same-category Word Cards at the top of a column forms a
  **stack** and can be moved together in one action (`moveStack`). A face-down card
  underneath a run is never included.
- Recognizing a same-category pair (e.g. stacking 鯨魚 onto 海豚) is accepted
  immediately — the player gets real-time confirmation their categorization is
  correct, without waiting for the Category Card (spec section 23).

## Category Card — the asymmetric rule

This is the game's central mechanic:

- A **Word Card can never be placed on a Category Card.**
- A **Category Card can be placed on a Word Card/stack of its own category** (this
  lets the player temporarily park it out of the way instead of it blocking a
  column).
- A Category Card can also be placed into an **empty Category Slot**, which
  *activates* that category (slot starts at `0 / required`).
- A Category Card can never be placed on another Category Card.
- Word Cards can be freely organized into same-category stacks on the table even
  before their Category Card is activated — but the category cannot be *completed*
  until it has an active slot to receive cards into.

## Category Slots

- There are fewer Category Slots than categories in most levels — this is the
  intentional bottleneck (spec section 12/14).
- Sending a Word Card to an active slot for its category **removes it from the
  table** and increments that slot's `collected` count.
- When `collected === required`, the category is complete: it's recorded in
  `completedCategories`, and the slot is freed for another Category Card.
- The To-do List (`getTodoList`) is derived from `categoryMeta` + `categorySlots` +
  `completedCategories` — it is not separately stored state, so it can never drift
  out of sync with the board.

## Deck / Waste

- `deckEnabled` levels start with some cards face-down in a deck.
- Drawing (`drawDeckCard`) flips the top deck card face-up onto the waste pile; only
  the waste pile's top card is playable.
- When the deck is empty, recycling (`recycleDeck`) rebuilds it from the waste pile
  (face-down again) at no cost and with no limit — the game can never hard-lock on
  deck order (spec section 20/26).
- A card can move off the waste pile onto a column or slot using the same rules as a
  column-top card. Waste is never a valid *destination*.

## Winning and scoring

- A level is won when every category listed in the level's `categoryIds` has been
  completed.
- Stars (0–3) come from comparing final `moves` and elapsed time against the level's
  `targetThreeStarMoves`/`targetTwoStarMoves` and `targetThreeStarTime`/
  `targetTwoStarTime`. The awarded star count is the **minimum** of the moves-based
  and time-based ratings (i.e. both must be good to earn 3 stars).
- Coins earned = `10 + stars * 10`.

## Undo / Hint economy

- **Undo** costs a flat 10 coins and restores the entire previous game state
  (`undo()` pops a full state snapshot) — this guarantees perfect consistency across
  every possible undo-able action (move, stack move, category card move, draw,
  recycle, slot delivery, category completion, flip) without needing bespoke
  "reverse" logic per action type.
- **Hint I** (10 coins) highlights a card that has *some* legal move, without
  revealing the destination.
- **Hint II** (25 coins) also reveals the destination.
- Hints prioritize suggesting a move that makes real progress: delivering a word to
  an active slot, then activating a category card, then any other legal card/stack
  move, then drawing/recycling the deck as a last resort.
- Coins spent on hints/undo are **not** refunded by a later undo — they are treated
  as a sunk wallet cost, independent of the board-state history stack.

## Chapter and level unlocking (`src/data/progression.ts`)

- Chapters play in a fixed order (`CONTENT_CHAPTER_ORDER`). The first is always
  unlocked; each later one unlocks once the *previous* chapter has earned at least
  50% of its maximum possible stars (`isChapterUnlocked`).
- A chapter with no authored levels (science-world, history-culture, curious-facts —
  see `scripts/generate-levels.ts`'s `PLAN`) is never unlockable regardless of stars;
  it's shown as permanently "coming soon."
- Within an unlocked chapter, the first level is always open; each further level
  unlocks once the previous one has been completed at least once, i.e. ≥ 1 star
  (`isLevelUnlocked`).

## Daily Challenge (`src/data/dailyChallenge.ts`)

- Every calendar day offers one Easy, one Normal, and one Hard level, built by
  `buildDailyLevelConfig(date, difficulty)` — a `LevelConfig` seeded from
  `daily-${date}-${difficulty}`, drawing its category mix from *all* categories
  (not chapter-themed). Because dealing is a pure function of the seed, every player
  who opens the app on the same day sees the exact same table for a given
  difficulty, with no server coordination required.
- Completing at least one difficulty on a given date advances the streak by 1 if the
  previous streak day was exactly yesterday, or resets it to 1 otherwise
  (`playerStore.recordWin`'s daily-streak logic). Completing more than one difficulty
  on the same date does not advance it further — the streak counts days, not clears.
- A Daily Challenge win records into `playerStore.daily`, never into the chapter
  `levelRecords` map (`WinRecordInput.levelId` is left `undefined` for daily runs) —
  it has no chapter/level-list entry to attach to.

## Missions and Achievements (`src/data/missions.ts`, `src/data/achievements.ts`)

- Missions track *period-scoped* progress (reset when the day/week rolls over — see
  `rollPeriod` in `playerStore.ts`), separate from the *lifetime* `Statistics` object
  achievements check. The same per-win deltas (categories completed, stars earned,
  hint-free clears, etc.) feed both simultaneously.
- Achievements are pure predicates over `Statistics`, re-evaluated in full after every
  win — there's no per-achievement "did X just happen" tracking, so a newly added
  achievement retroactively unlocks correctly the next time stats update rather than
  only from that point forward.

## Library (`src/data/library.ts`)

- 11 fixed slots, each with exactly one default item unlocked from the start. Other
  items per slot unlock by coin purchase, or automatically once a stat/achievement
  condition is met (checked alongside achievements after every win).
- **"Items owned" for scoring purposes excludes the 11 free defaults** — see
  `extraLibraryItemsOwned` in `playerStore.ts`. Counting the defaults would make the
  "收藏家" (Collector) achievement (≥10 items) unlock on a brand-new save with zero
  purchases, which defeats its purpose; this was caught and fixed during manual
  testing (see `docs/game-design-decisions.md`).
