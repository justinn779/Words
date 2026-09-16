# Cloud Functions — AI-generated content

Two related pieces, both built on the same idea: OpenAI only ever produces
*content* (a category name + word list, same shape as `src/data/seed.ts`'s
`SeedRow`), every candidate is re-verified through the same solver-based
"generate → solve → accept/reject" pipeline every hand-authored level goes
through (`src/engine/generator.ts`), and only what passes ever reaches a player.

1. **Category top-up** — `generateAndVerifyCategories` adds a few new categories
   to the shared pool (Firestore's public, read-only `aiCategories` collection —
   see `src/firebase/aiContent.ts` for how the client reads it back).
2. **Chapter generation** — `generateNewChapterNow` builds an entire chapter (a
   full AI-generated difficulty curve) on demand. Every chapter works this way
   now — there is no hand-authored/static content or fixed chapter roster
   anymore (`src/data/levels.ts` and the old `src/data/chapters.ts` are gone);
   chapter ids are `ai-chapter-{order}`, assigned sequentially starting at 1. See
   "Chapter generation" below.

Board layout, dealing, and win-condition logic stay 100% deterministic given a
level's config — but getting that config now requires this pipeline to have run
first, so the game is no longer usable fully offline/without Firebase.

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
   (`dailyAiCategoryRefresh`, `generateAiCategoriesNow`, `generateNewChapterNow` —
   see `src/index.ts`'s `secrets: [OPENAI_API_KEY]`). The functions run fine before
   this step, they just fail (logged, not crashing anything else) whenever they
   actually try to call OpenAI.
4. **Telegram bot token/chat id + (optional) other developer-notification
   secrets** — `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, set the same way via
   `firebase functions:secrets:set`, used by `notifyDeveloper` (chapter
   generation start/success/failure, `reportUnsolvableLevel`, `notifyUserRegistered`).
   Optional — every caller degrades to just logging if these aren't set.

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

## Chapter generation

Every chapter — including the very first one a brand-new player sees —  is
generated on demand by `generateNewChapterNow` (callable, see
`src/firebase/aiChapters.ts` for the client side). There's no fixed roster: the
server reserves the next sequential `order` via a Firestore counter
(`meta/chapterCounter`) and assigns the chapterId `ai-chapter-{order}`.

1. Asks OpenAI for both a short theme/title and a batch of categories to match
   (no per-chapter topic constraint beyond that — an earlier version pinned 3
   chapters to narrow fixed topics, which collided with itself often enough to
   leave a chapter permanently stuck; see the code comment above `AI_CHAPTER_IDS`'s
   old definition in git history). Verifies each candidate exactly like the
   category top-up above, and persists the accepted ones to `aiCategories` too
   (they also enrich the shared pool, not just this chapter).
2. **Never gives up**: if OpenAI is unreachable, or doesn't yield enough
   verified categories to clear `DIFFICULTY_SHAPE.hard.categoryCount`,
   `fillShortfallFromExistingPool` tops up the shortfall from the existing pool
   (built-in `SEED` plus every previously accepted AI category) instead of
   failing outright — chapter generation cannot leave a player stuck on a
   missing chapter. In the extreme case (OpenAI entirely down), the chapter
   still gets built, just with no AI-invented title and entirely
   already-known categories (`src/data/progression.ts`'s `getChapterDisplayTitle`
   renders that as a plain "第N章").
3. Builds a `['easy','easy','normal','normal','hard']` level curve from the
   resulting pool (`buildChapterLevels`). Every level goes through the same
   solver-verified generator every level in the game always has — a level that
   doesn't solve within budget still ships (logged as unsolved) rather than
   blocking the whole chapter; see the player-facing "❗ 回報無解" report flow
   (`reportUnsolvableLevel` below) for the safety net that exists because of this.
4. Writes the result to `aiChapters/{chapterId}` (`status: 'ready'`).

The client (`src/store/contentStore.ts`, wired into `ChapterList.tsx`/
`WinModal.tsx`, and bootstrapped automatically for a player with zero chapters
yet) only offers to generate the next chapter once the current last chapter's
star-gate is already open (`isNextNewChapterGateOpen` in
`src/data/progression.ts`) — 50% of that chapter's stars.

## Developer notifications

`notifyDeveloper` sends a Telegram message (see the secrets section above) for:
chapter generation start/success/failure, a player reporting a level as
unsolvable (`reportUnsolvableLevel`, deduped per level while unresolved), and a
player linking a persistent account (`notifyUserRegistered`, deduped per uid —
not every anonymous first-visit sign-in, which happens far too often to be a
meaningful signal).

## Daily Challenge and AI content

`src/data/dailyChallenge.ts` merges the built-in `SEED` pool with AI-generated
categories, filtered to only those `createdAt` strictly before that day's local
midnight (`loadAiCategoriesCreatedBefore` in `src/firebase/aiContent.ts`) — so
every player who opens a given day's challenge, no matter when during the day,
draws from the exact same category pool. Without that cutoff, a category
accepted mid-day would silently join the pool for players loading afterward but
not before, breaking the "everyone sees the same board on the same day"
guarantee the shared-seed design depends on.
