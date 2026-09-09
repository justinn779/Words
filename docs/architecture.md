# Architecture

## Layering

```
src/engine/       Pure TypeScript. Zero React imports. createGame/moveCard/etc. are
                   plain functions: (state, ...args) => new state (or a MoveResult).
                   Fully unit-testable without rendering anything — see
                   src/engine/__tests__. This is the module a future non-React
                   client (a native app, a CLI solver, a server-side validator)
                   could reuse unmodified.

src/data/          Static content: the word/category dataset (src/data/seed.ts is the
                   single source of truth; categories.ts/words.ts are derived views
                   matching the spec's separate-files data model) and LevelConfig
                   authoring (levels.ts, chapters.ts).

src/store/         Zustand. gameStore owns the active session (current GameState,
                   click/drag selection, hint/flash UI state, Daily Challenge context)
                   and is the ONLY place that calls into src/engine for rule decisions.
                   playerStore owns cross-session data (coin wallet, level records,
                   Daily Challenge streak, statistics, missions, achievements, library)
                   — persisted to localStorage, with an optional debounced Firestore
                   mirror once signed in (see docs/firebase.md).

src/components/    React. Reads state via store selectors, dispatches store actions.
                   No component calls an engine function directly — this keeps "how
                   do I validate a move" in exactly one place.

src/firebase/      Auth + Firestore sync, entirely optional (see docs/firebase.md).
                   Every SDK import here is dynamic (`import('firebase/...')` inside
                   an async function) so a build with no Firebase project configured
                   never downloads the SDK at all — see the bundle-size note below.

src/audio/         `sfx.ts` — placeholder sound effects (Web Audio oscillator tones,
                   no shipped audio files yet). gameStore/playerStore call `playSfx`
                   at the same points that already decide what happened (a successful
                   move, a category completing, a win, a purchase), gated by
                   `playerStore.settings.soundOn`.
```

## Bundle size: Firebase is opt-in, not just "disabled"

`firebaseEnabled` (src/firebase/config.ts) is computed from `import.meta.env.VITE_FIREBASE_*`
at module load, but the actual `firebase/app` / `firebase/auth` / `firebase/firestore`
packages are only ever reached through `getFirebase()`'s dynamic `import()`, which
short-circuits to `Promise.resolve(null)` before that import ever executes when
disabled. The production build (`npm run build`) reflects this: the SDK lands in its
own lazily-fetched chunks, and a browser that never configures Firebase never
downloads them — verified by serving `dist/` and checking the network tab shows only
the main chunk. `vite.config.ts`'s PWA `workbox.globIgnores` also excludes those
chunks from the service worker's precache list for the same reason — precaching would
silently force every visitor to download the whole SDK on first load regardless of
whether it's ever used.

This split exists so game rules can change (tune a level, fix a rule bug, add a new
move type) without touching a single `.tsx` file, and so the UI can be redesigned
without ever risking a rule regression — the 39 tests in `src/engine/__tests__`
would catch it either way.

## Selection model (click *and* drag from one state machine)

`gameStore.selection` represents "the card/stack currently picked up," regardless of
whether the player tapped it or is mid-drag. Two entry points feed it:

- **Click-to-move**: `clickCard(loc)` — first tap picks (if the card is liftable),
  second tap either completes a move, re-picks a different liftable card if the move
  was illegal, or deselects if it's the same card again.
- **Drag**: `CardView` tracks pointer-down/move/up locally. Once the pointer moves
  past a small threshold, it calls `selectAt(loc)` (which *only* mutates selection if
  the source is actually liftable — otherwise it leaves any existing selection alone,
  so an accidental micro-drag on a non-pickable card still falls through to a normal
  tap on release) and mirrors the run's card ids into `dragVisual` so every affected
  `CardView` can translate itself via CSS transform. On release, the drop point is
  resolved via `elementFromPoint(...).closest('[data-dropzone]')` and fed into the
  same `moveSelectionTo(destination)` the click flow uses.

Both flows terminate in the same `moveCard`/`moveStack` engine calls — there is no
separate "drag rule" and "click rule."

## Phase plan (status)

- **Phase 1 — done.** Engine, hand-built test levels, full click+drag UI, coin
  economy for hint/undo, win screen, chapter/level navigation shell.
- **Phase 2 — done.** The Phase 1 engine design needed no rework to support later
  phases; hardening since then has been the `solve()` memory fix (see
  `docs/solver.md`) and the `generateSolvableLevel` pipeline's own tests.
- **Phase 3 — done.** `scripts/generate-levels.ts` + `src/engine/generator.ts`
  implement the generate → solve → accept/reject loop end-to-end and produced the 30
  levels in `src/data/levels.ts` across 5 chapters. See `docs/level-generator.md`.
- **Phase 4 — done.** `src/data/progression.ts` gates chapter unlocks on the previous
  chapter's star total and level unlocks on the previous level's completion; coins/
  best-scores/statistics all live in `playerStore`.
- **Phase 5 — done as optional scaffolding.** Anonymous auth, Google account linking,
  and debounced Firestore sync are fully implemented in `src/firebase/` and wired into
  `playerStore`, but only activate when a real Firebase project's keys are present in
  `.env.local` (see `.env.example`) — this repo ships with none, so the shipped build
  runs local-only. Untested against a live project; see `docs/firebase.md` for the
  known simplifications (whole-profile last-write-wins merge).
- **Phase 6 — done.** Daily Challenge (`src/data/dailyChallenge.ts`) builds an Easy/
  Normal/Hard level per calendar day from a date-derived seed — no server needed for
  everyone to get the same puzzle — with streak tracking in `playerStore`.
- **Phase 7 — done.** Library meta-game (`src/data/library.ts`): 11 fixed slots, each
  with a default item plus coin-purchased or stat/achievement-gated alternatives.
- **Phase 8 — done.** Daily/weekly missions (`src/data/missions.ts`) and achievements
  (`src/data/achievements.ts`), both re-evaluated from `playerStore`'s cumulative
  `Statistics` after every win.
- **Phase 9 — done.** Placeholder sound effects (`src/audio/sfx.ts`), a card-reveal/
  category-complete/win-modal animation pass (respecting both `prefers-reduced-motion`
  and an in-app 動畫 toggle), PWA installability (manifest + service worker via
  `vite-plugin-pwa`, offline app-shell precache), and keyboard operability for every
  card (`role="button"`, `tabIndex`, Enter/Space) as an alternative to drag.

None of this changed the Phase 1 engine's public API — every later phase is UI/data/
store work built on top of the same `moveCard`/`moveStack`/etc. functions.
