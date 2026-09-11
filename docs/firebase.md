# Firebase (Phase 5 — built, but off by default)

The code is complete and wired into `playerStore`, but it only activates when a real
Firebase project's keys are present at build time (`.env.local` — see
`.env.example`). This repo ships with none configured, so by default the game runs
entirely local-only and **none of this has been exercised against a live Firebase
project** — treat it as implemented-but-unverified, not battle-tested.

## Turning it on

This is the one part of the project that needs an action only you can take — a real
Firebase project tied to your own Google account. Claude Code can't create that for
you (or sign in on your behalf), but everything else is already wired up.

1. **Create the project.** [console.firebase.google.com](https://console.firebase.google.com)
   → Add project (the free Spark plan is enough for a game this size).
2. **Enable Authentication.** Build > Authentication > Get started > Sign-in method:
   turn on **Anonymous** (required — every player gets one on first launch) and
   **Google** (optional — lets a player link an account across devices).
3. **Create Firestore.** Build > Firestore Database > Create database (production
   mode is fine). Then publish this repo's [`firestore.rules`](../firestore.rules)
   (Firestore > Rules tab, paste and Publish) — it restricts each profile document to
   its own signed-in owner. Skipping this leaves the default rules in place, which
   depending on your console choice may allow anyone to read/write any profile.
4. **Get the web config.** Project settings (⚙️) > General > Your apps > add a Web
   app (</> icon) > copy the four values from the `firebaseConfig` object shown:
   `apiKey`, `authDomain`, `projectId`, `appId`. (These aren't secrets by Firebase's
   own design — access control is the Firestore rules above, not hiding this
   config — but there's no reason to commit them either.)
5. **Wire them in:**
   - Local dev: copy `.env.example` to `.env.local` and paste the four values in.
   - The deployed GitHub Pages build (`.github/workflows/deploy.yml`): add the same
     four values as repo secrets — GitHub repo > Settings > Secrets and variables >
     Actions > New repository secret — named exactly `VITE_FIREBASE_API_KEY`,
     `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.
     The workflow already reads them; the next push (or a manual re-run) picks them
     up with no other changes needed.
6. Rebuild (`npm run build` locally, or just push for the deployed site). Settings in
   the running app will show "帳號狀態" go from "未啟用雲端同步" to a signed-in state,
   confirming it's live.

## Why disabled-by-default is safe

`src/firebase/config.ts` computes `firebaseEnabled` from
`import.meta.env.VITE_FIREBASE_*` and gates everything else behind it. Critically,
the actual `firebase/app`/`firebase/auth`/`firebase/firestore` packages are only ever
reached through dynamic `import()` calls inside `getFirebase()`, `initAuth()`,
`linkGoogleAccount()`, `loadProfile()`, and `saveProfile()` — never a top-level
`import`. When disabled, none of those imports ever execute, so the SDK is never even
downloaded (confirmed by inspecting the production build's network requests — see
`docs/architecture.md`'s bundle-size note).

## Auth (`src/firebase/auth.ts`)

- `initAuth(onChange)`: on first launch, signs in anonymously (spec section 46) and
  reports `AuthStatus` (`disabled` | `signed-out` | `anonymous` | `google`) to the
  caller. `App.tsx` calls this once via `playerStore.initCloud()` in a top-level
  effect.
- `linkGoogleAccount()`: called from Settings once `authStatus === 'anonymous'`. Uses
  `linkWithPopup(auth.currentUser, googleProvider)` on the *existing* anonymous user
  — deliberately a **link**, not a fresh `signInWithPopup`, so the player keeps their
  existing uid and progress instead of starting a new account. If the Google account
  is already tied to a different Firebase user (`auth/credential-already-in-use`),
  this currently just surfaces the error to the console; the spec's intended
  resolution (offer the player a choice, keep whichever side has more progress) is
  not yet built — see "Known simplifications" below.

## Firestore shape

One document per user, all top-level fields at `users/{uid}` (not subcollections —
`playerStore`'s entire `PersistedShape` is written as one document):

```
users/{uid}
  coins, levelRecords, daily, statistics, achievements,
  missionsDaily, missionsWeekly, library, settings, updatedAt
```

This mirrors `playerStore.ts`'s own shape exactly (see that file for the authoritative
field types) rather than the finer-grained subcollection layout originally sketched
here — one document is simpler to reason about at this scale and matches the
"sync the whole profile at checkpoints" policy below.

## Sync policy (`src/store/playerStore.ts`)

Per spec section 47/48: the in-progress `GameState` (every drag, every flip) never
touches Firestore — it isn't even in `playerStore`, which only holds
already-checkpointed data (coins, best scores, stats, missions, achievements,
library, settings). Every mutating `playerStore` action funnels through one `commit(get,
set)` helper that:

1. Writes `localStorage` immediately (unconditionally, so the game works fully
   offline / with Firebase disabled).
2. Schedules a debounced (2s) Firestore write via `scheduleCloudPush`, only once
   `cloudUid` is set (i.e. after `initCloud()`'s anonymous sign-in resolves).

On sign-in, `initCloud()` does a one-time merge: it loads the remote profile and
compares its `updatedAt` against the local copy's, adopting whichever is newer
wholesale. This is a deliberately simple last-write-wins policy, not a field-level
merge — see "Known simplifications."

## Known simplifications (would need work before shipping this for real)

- **Last-write-wins, not merged.** If a player has unsynced local progress on two
  devices and opens both before either syncs, one device's session is silently
  discarded rather than combined. Fine for a single-device player (the common case);
  risky for true multi-device use.
- **No `auth/credential-already-in-use` recovery flow.** Linking a Google account
  already tied to another Firebase user fails without offering the player a way to
  choose which side to keep.
- **No retry/backoff on failed cloud writes** beyond a console error — a dropped
  connection mid-sync doesn't get automatically retried until the next local write
  happens to trigger `commit()` again.

None of these affect the local-only experience at all; they only matter once a real
Firebase project is wired in via `.env.local`.
