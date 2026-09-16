# 文字接龍 Word Solitaire

A Chinese-language word-sorting solitaire game: players untangle a table of face-down
cards by moving same-category words into stacks and delivering them into a limited
number of active Category Slots. See `/docs` for the full design and architecture.

**Status: all 9 spec phases implemented.** Every chapter is generated on demand by
Cloud Functions (OpenAI content, run through the same solver-verified pipeline every
level always has — see `docs/level-generator.md`) rather than shipped pre-authored;
this requires Firebase to be configured (`docs/firebase.md`) — there is no offline/
no-network mode anymore. Chapter/level progression unlocks, Daily Challenge, Library,
Missions, Achievements, PWA install support, and placeholder sound + animation polish
are all built and playable. See `docs/architecture.md` for what each phase covers and
any known simplifications.

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run test     # run the engine unit test suite (vitest)
npm run build    # type-check (tsc -b), build, and generate the PWA service worker
npm run lint     # oxlint
```

Optional: copy `.env.example` to `.env.local` and fill in a Firebase project's keys
to enable cloud sync (anonymous auth + Google linking + Firestore). Everything works
without this — it's entirely opt-in local-only otherwise.

## Regenerating content

```bash
node scripts/generate-icons.mjs       # re-rasterizes public/app-icon*.svg to PNG
```

There's no offline level-authoring step anymore — every chapter is generated on
demand by Cloud Functions (`functions/src/index.ts`'s `generateNewChapterNow`, see
`functions/README.md`) the first time a player reaches it.

## Project layout

```
src/
  engine/      Pure TypeScript game engine — no React import anywhere in this folder.
               Runnable and testable standalone (see src/engine/__tests__).
  data/        Built-in word/category dataset (seed pool every AI-generated chapter
               falls back on), progression rules, Daily Challenge, missions,
               achievements, library content. No level/chapter configs live here
               anymore — every chapter is generated on demand (see functions/).
  store/       Zustand: gameStore (active session) and playerStore (everything
               persisted — coins, records, streaks, stats, missions, achievements,
               library, settings; optionally mirrored to Firestore).
  components/  React UI. Talks to the engine only through the store — never imports
               engine internals directly for game-rule decisions.
  firebase/    Optional auth + Firestore sync — see docs/firebase.md.
  audio/       Placeholder sound effects (Web Audio oscillator tones).
docs/          Design and architecture documentation (see below).
functions/     Cloud Functions — AI chapter/category generation (see functions/README.md).
scripts/       Icon rasterization only; level authoring is no longer offline.
```

## Documentation

- [docs/game-design.md](docs/game-design.md) — core loop, product principles
- [docs/game-rules.md](docs/game-rules.md) — the full rule set as implemented,
  including progression unlocks, Daily Challenge, missions/achievements, and library
- [docs/architecture.md](docs/architecture.md) — module boundaries, phase-by-phase
  status, the Firebase bundle-size design
- [docs/data-model.md](docs/data-model.md) — TypeScript data model reference
- [docs/level-generator.md](docs/level-generator.md) — the generate → solve →
  accept/reject pipeline every chapter goes through when it's generated
- [docs/solver.md](docs/solver.md) — solvability checking: what it guarantees, what
  it doesn't (it's not a difficulty/par estimator)
- [docs/firebase.md](docs/firebase.md) — auth/sync design, what's built vs. untested
  against a live project
- [docs/game-design-decisions.md](docs/game-design-decisions.md) — judgment calls made
  where the spec was ambiguous or self-contradictory, and why (including a couple of
  bugs caught by manual playtesting, not just unit tests)
