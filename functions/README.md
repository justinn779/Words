# Cloud Functions — AI-generated category content

Generates new word-category content (a category name + word list, same shape as
`src/data/seed.ts`'s `SeedRow`) via OpenAI, re-verifies every candidate through the
same solver-based "generate → solve → accept/reject" pipeline every hand-authored
level goes through (`src/engine/generator.ts`), and writes only the ones that pass
into Firestore's public, read-only `aiCategories` collection.

Nothing about the core game changes: board layout, dealing, and win-condition logic
stay 100% deterministic and offline. This only ever adds *content* (categories a
level's category pool can draw from) — see `src/firebase/aiContent.ts` for how the
client reads it back.

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
   (`dailyAiCategoryRefresh`, `generateAiCategoriesNow` — see `src/index.ts`'s
   `secrets: [OPENAI_API_KEY]`). The functions run fine before this step, they just
   fail (logged, not crashing anything else) whenever they actually try to call
   OpenAI.

## Deploying

```bash
npm install        # first time only
npm run build       # compiles this + the src/engine modules it reuses (see tsconfig.json)
firebase deploy --only functions
```

`firebase deploy --only firestore:rules` publishes `../firestore.rules` (the
`aiCategories` read rule lives there).

## What's here

- `src/openai.ts` — the only file that ever touches `OPENAI_API_KEY`. Builds the
  generation prompt and parses the response into `GeneratedCategory[]`. Does no
  validation beyond basic JSON shape — see `src/index.ts` for that.
- `src/index.ts` — the pipeline:
  1. `dailyAiCategoryRefresh` (scheduled, once a day) and `generateAiCategoriesNow`
     (callable, for manual/future on-demand use) both call `generateAndVerifyCategories`.
  2. That function asks OpenAI for N new categories (distinct from every existing
     `aiCategories` doc and every built-in `SEED` category), format-checks each one
     (word count, length, no duplicates), then re-imports `generateSolvableLevel`
     from `../../src/engine/generator` to confirm each surviving category can, on
     its own, deal into a genuinely winnable board.
  3. Only categories that pass both checks are written to `aiCategories/{categoryId}`.
     Everything rejected is logged with a reason, never silently dropped.

## Known scope limits (intentionally not built yet)

The three ideas that motivated this (auto-generate the next chapter once a player
reaches the frontier, an infinite-challenge mode that pre-generates the next level,
and folding AI categories into Daily Challenge) all need real game-mode/UI work on
top of this pipeline — this is just the content-generation backend they'd share.

Daily Challenge in particular is **not** wired up to `aiCategories` yet on purpose:
every player must see the exact same board for a given date (`src/data/
dailyChallenge.ts`'s whole design), and naively picking from "whatever's in
Firestore right now" would let two players who load the page a few minutes apart —
straddling exactly when a new category lands — see different boards. Fixing that
means filtering by `createdAt` to a date cutoff, not just reading the live
collection. Worth doing before Daily Challenge uses this; skipped for now rather
than shipped with that edge case unhandled.
