# Cloud Functions — AI-generated content

Two related pieces, both built on the same idea: OpenAI only ever produces
*content* (a category name + word list, same shape as `src/data/seed.ts`'s
`SeedRow`), every candidate is re-verified through the same solver-based
"generate → solve → accept/reject" pipeline every hand-authored level goes
through (`src/engine/generator.ts`), and only what passes ever reaches a player.

1. **Category top-up** — `generateAndVerifyCategories` adds a few new categories
   to the shared pool (Firestore's public, read-only `aiCategories` collection —
   see `src/firebase/aiContent.ts` for how the client reads it back).
2. **Auto-generated chapters** — `generateNextChapterNow` fills in one of the 3
   placeholder chapters (`science-world`, `history-culture`, `curious-facts` —
   see `src/data/chapters.ts`) with a full AI-generated difficulty curve, the
   first time any player reaches that far. See "Auto-generated chapters" below.

Nothing about the core game changes: board layout, dealing, and win-condition logic
stay 100% deterministic and offline.

## One-time setup (needs your own accounts — can't be done for you)

1. **Firebase Blaze plan.** Cloud Functions calling out to the internet (OpenAI)
   requires the pay-as-you-go Blaze plan — the free Spark plan can't do this.
   Firebase console → your project → upgrade plan.
2. **An OpenAI API key.** [platform.openai.com/api-keys](https://platform.openai.com/api-keys) →
   create a new key. Also set a usage limit under Settings → Limits so a bug here
   can't run up an unbounded bill.
3. **Store the key as a Firebase secret** (never in this repo, never in an env
   file, never pasted anywhere Claude Code can see it) — run this yourself in a
   terminal from the repo root:

   ```bash
   firebase functions:secrets:set OPENAI_API_KEY
   ```

   It prompts for the value with hidden input. Firebase stores it in Google Cloud
   Secret Manager and injects it only into the functions that declare it
   (`dailyAiCategoryRefresh`, `generateAiCategoriesNow`, `generateNextChapterNow` —
   see `src/index.ts`'s `secrets: [OPENAI_API_KEY]`). The functions run fine before
   this step, they just fail (logged, not crashing anything else) whenever they
   actually try to call OpenAI.

## Deploying

```bash
npm install        # first time only
npm run build       # compiles this + the src/engine modules it reuses (see tsconfig.json)
firebase deploy --only functions
```

`firebase deploy --only firestore:rules` publishes `../firestore.rules` (the
`aiCategories`/`aiChapters` read rules live there).

## What's here

- `src/openai.ts` — the only file that ever touches `OPENAI_API_KEY`. Builds the
  generation prompt (optionally themed — see chapters below) and parses the
  response into `GeneratedCategory[]`. Does no validation beyond basic JSON shape
  — see `src/index.ts` for that.
- `src/index.ts` — category top-up pipeline:
  1. `dailyAiCategoryRefresh` (scheduled, once a day) and `generateAiCategoriesNow`
     (callable, for manual/on-demand use) both call `generateAndVerifyCategories`.
  2. That function asks OpenAI for N new categories (distinct from every existing
     `aiCategories` doc and every built-in `SEED` category), format-checks each one
     (word count, length, no duplicates), then re-imports `generateSolvableLevel`
     from `../../src/engine/generator` to confirm each surviving category can, on
     its own, deal into a genuinely winnable board.
  3. Only categories that pass both checks are written to `aiCategories/{categoryId}`.
     Everything rejected is logged with a reason, never silently dropped.

## Auto-generated chapters

`src/data/chapters.ts` pre-declares 3 chapter themes — `science-world`,
`history-culture`, `curious-facts` — that `scripts/generate-levels.ts`'s `PLAN`
deliberately leaves with zero hand-authored levels. `generateNextChapterNow`
(callable, see `src/firebase/aiChapters.ts` for the client side) fills one of
these in on demand, the first time any player reaches it:

1. Checks Firestore `aiChapters/{chapterId}` first — if another player already
   triggered this chapter, its stored levels are returned as-is (no OpenAI call).
   A short-lived `status: 'generating'` lock avoids two simultaneous callers both
   paying for generation (not a strict distributed lock — see the code comment on
   `GENERATING_LOCK_TIMEOUT_MS` for the accepted trade-off).
2. Otherwise asks OpenAI for a themed batch of categories (the chapter's title
   hints the theme — see `CHAPTER_THEME_HINT`), verifies each exactly like the
   category top-up above, and persists the accepted ones to `aiCategories` too
   (they also enrich the shared pool, not just this chapter).
3. Builds a `['easy','easy','normal','normal','hard']` level curve from the
   accepted pool — the same shape `scripts/generate-levels.ts`'s `generateChapter`
   uses for hand-authored chapters, just reused in `buildChapterLevels` over
   freshly-generated categories instead of the static built-in ones. Every level
   goes through the same solver-verified generator, exactly like every other
   level in the game.
4. Writes the result to `aiChapters/{chapterId}` (`status: 'ready'`) so every
   later player reuses it via step 1.

The client (`src/store/contentStore.ts`, wired into `ChapterList.tsx`/
`WinModal.tsx`) only offers to generate a chapter once its star-gate is already
open (see `isChapterStarGateOpen` in `src/data/progression.ts`) — same 50%-of-
previous-chapter's-stars rule as the hand-authored chapters.

## Known scope limits (intentionally not built yet)

An infinite-challenge mode that pre-generates the next level on the fly, and
folding AI categories into Daily Challenge, still need real game-mode/UI work —
this pipeline is content-generation only, reused by whatever calls it.

Daily Challenge in particular is **not** wired up to `aiCategories`/`aiChapters`
yet on purpose: every player must see the exact same board for a given date
(`src/data/dailyChallenge.ts`'s whole design), and naively picking from
"whatever's in Firestore right now" would let two players who load the page a
few minutes apart — straddling exactly when new content lands — see different
boards. Fixing that means filtering by `createdAt` to a date cutoff, not just
reading the live collection. Worth doing before Daily Challenge uses this;
skipped for now rather than shipped with that edge case unhandled.
