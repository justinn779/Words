# Game Design Decisions

Judgment calls made where the spec was ambiguous, or where two of its requirements
pulled in different directions. Per the spec's own instruction (section 69): when in
doubt, prefer whatever keeps the core Solitaire logic simplest and most consistent,
and record the reasoning here rather than silently picking one.

## Undo is snapshot-based, not a reverse-move log

The spec (section 31) requires undo to correctly restore card moves, stack moves,
category card moves, deck draws, category slot moves, category completion, and flips
— i.e. everything. Writing a hand-rolled inverse for each of those (especially
"un-complete a category and restore its exact slot count") is real surface area for
subtle bugs. Instead, every mutating engine function pushes a deep-cloned snapshot of
the prior `GameStateCore` onto `history` before it changes anything, and `undo()`
just pops and restores one. This is trivially correct by construction and cheap at
this game's scale (a few dozen cards, a capped 500-entry history). Trade-off: higher
memory use per undo step than a diff-based log — irrelevant here.

## Category Cards are never part of a multi-card stack move

The spec is explicit that a Category Card can rest on top of a matching Word
stack (section 15), but never says whether a *mixed* run (Category Card at the
bottom, Words above it) can then be picked up and moved together as one unit
elsewhere. Treating "stack" as word-only-same-category keeps `canMoveStack`'s
invariant simple (a stack is always a uniform run you could also complete into a
slot card-by-card) and matches every worked example in the spec, which always shows
the Category Card moved by itself. A Category Card is always a single-card move
(`moveCategoryCard`), even when it happens to be sitting on top of a longer word run.

## The To-do List is derived, never stored

Section 58 lists `todoList` as if it were state alongside `columns`/`deck`/etc. It's
implemented instead as a pure function of `categoryMeta` + `categorySlots` +
`completedCategories` (`getTodoList` in `src/engine/win.ts`). Storing it separately
would just create a second place that could disagree with the actual board — this
was the explicit maintainability principle the spec itself leads with (section 1).

## Hint/undo coin spend is not itself undoable

`recordHintUsed`/`recordCoinsSpent` update `hintsUsed`/`coinsSpent` directly, outside
the snapshot history. If a player uses a hint and then undoes the move it suggested,
the hint's coin cost stays spent — consistent with how solitaire hint/undo economies
normally work (you paid to see the information; getting it doesn't un-happen), and
avoids the stranger alternative of undo silently refunding coins.

## Score = the *worse* of the moves-star and time-star ratings

Section 60 asks for a rating that "considers both moves and time" but doesn't specify
how they combine. Taking `min(moveStars, timeStars)` means 3 stars requires being
efficient on both axes — the common convention in solitaire-likes, and it avoids the
edge case of a very slow-but-low-move (or fast-but-flailing) clear scoring 3 stars on
a technicality.

## Deck draws count toward `moves`; recycling the deck does not

Draws are a real strategic choice the player makes repeatedly, so counting them
keeps score meaningful (a level cleared by discarding all skill and drawing the deck
forty times should show a worse `moves` figure than a clean solve). Recycling is a
free, unlimited system action with no decision attached (section 20), so it isn't
counted — it would only ever inflate the move count for players who happened to run
the deck out more than once.

## v1 word content is single-category only

Section 22 asks the data model to support words with multiple plausible categories
(`WordEntry.possibleCategoryIds: string[]`) while also requiring the *Level
Generator* to never actually create an ambiguous level. Building that constraint
solver is real Phase 3 work (disambiguating "is this the bird-category penguin or
the antarctic-animal-category penguin" requires knowing the full category mix chosen
for a level, not just the word). The type supports multi-category words today; the
shipped dataset (`src/data/seed.ts`) simply gives every one of the 300 words exactly
one category, which satisfies the *outcome* the spec actually cares about (no
ambiguous levels) without needing the solver machinery yet.

## Dealing is round-robin, not triangular/Klondike-style

Cards are dealt evenly across columns (`i % columnCount`) rather than in an
increasing-depth triangle. Round-robin is simpler to reason about and test, and
column-depth variety is already achievable by tuning `columnCount` /
`categoryWordCounts` per level. Swapping the dealing strategy later is a
localized change inside `createGame` and wouldn't touch move rules, the store, or the
UI.

## Home screen shows locked/disabled entries for unbuilt systems

In the initial Phase 1 build, Daily Challenge / Library / Missions / Achievements
were present as visibly disabled home-screen buttons rather than omitted outright,
previewing the intended navigation shape (section 61) before those systems existed.
All four are now fully built (Phases 6–8) and the buttons are live.

## Solver move count is never used as a difficulty/scoring signal

`solve()`'s plain DFS returns the length of the first solution it happens to find,
not a shortest one — several generated levels' first-found solutions ran into the
thousands of moves. Using that as `targetThreeStarMoves` would have made 3 stars
either trivial (thousands of moves "allowed") or impossible to calibrate sensibly.
`estimateTargets()` (`src/data/difficultyShapes.ts`) instead scales star/time
thresholds purely from card count, using the ratios the original Phase 1
hand-authored levels landed on. The solver's role stays strictly binary — solvable or
not — which is exactly what spec section 29 asks for; a smarter solver with real move
minimization is left as future work (`docs/solver.md`).

## Chapter unlock threshold: 50% of a chapter's max stars

The spec asks for star-gated chapter unlocks (section 37) without specifying a
fraction. 50% means a player can move on after a solid-but-imperfect run through a
chapter rather than needing every level three-starred, while still requiring more
than just *touching* every level once. Levels within a chapter unlock sequentially
(finish one to open the next) rather than all being open — this keeps the "book"
navigation metaphor (section 33) meaningful as a chapter-by-chapter progression
rather than a flat level-select grid.

## Daily Challenge streak counts days, not individual clears

Completing Easy, Normal, and Hard on the same day only advances the streak once, on
the first completion of that date — re-completing a difficulty (or finishing the
other two) later that day is a no-op for streak purposes (`playerStore.recordWin`'s
`isFirstCompletionToday` check). This matches the everyday sense of a "daily streak"
(the spec calls it 每日挑戰連續天數) rather than rewarding grinding a single day for
streak progress.

## Library "items owned" excludes the free defaults

Every one of the 11 library slots starts with a default item already unlocked, so a
brand-new save already "owns" 11 items before the player does anything. The 收藏家
(Collector) achievement's threshold (section 45: "取得 10 件圖書館物品") is checked
against `unlockedItemIds.length - 11`, not the raw count — otherwise it would unlock
on a save with literally zero purchases, which manual testing caught (playing a
level immediately showed "🏆 解鎖成就：收藏家" on a fresh profile). This is the kind
of bug that's invisible from reading the achievement definition alone and only shows
up by actually running the flow — worth calling out as a reminder to playtest
progression-gated content, not just unit-test it in isolation.

## Firebase SDK imports are all dynamic, never top-level

Every module in `src/firebase/` reaches the actual `firebase/app` / `firebase/auth` /
`firebase/firestore` packages through an `import()` call inside a function, never a
top-level `import`. The first implementation used top-level imports and added ~500KB
(gzipped ~160KB) to the main bundle even though this build ships with no Firebase
project configured and `firebaseEnabled` is `false` — the SDK was being downloaded by
every visitor for a feature that could never activate. Switching to dynamic imports
gated behind `firebaseEnabled` cut the main chunk back down and moved Firebase into
chunks that are only fetched if a project is actually configured. The PWA service
worker's precache list also has to explicitly exclude those chunks
(`workbox.globIgnores` in `vite.config.ts`) — precaching would otherwise force every
visitor to download the whole SDK on first load regardless of whether it's used,
silently undoing the lazy-loading work.
