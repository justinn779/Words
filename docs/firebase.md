# Firebase（第 5 階段 — 已完成開發，但預設關閉）

程式碼已經寫完並接進 `playerStore`，但只有在建置時環境變數裡有一組真正的 Firebase
專案金鑰（`.env.local`，格式見 `.env.example`）才會啟用。這個 repo 本身沒有附上任何
金鑰，所以預設情況下遊戲完全走本機儲存，而且**目前從沒對著一個真正上線的 Firebase
專案跑過**——把它當作「功能已寫好但未經實測」，而不是「久經考驗」。

## 怎麼打開它

這是整個專案裡唯一一個必須由你自己動手的部分——需要一個綁在你自己 Google 帳號下的
真正 Firebase 專案。Claude Code 沒辦法幫你建立這個專案（也不該代替你登入），但除此
之外的其他部分都已經接好了。

1. **建立專案。** 到 [console.firebase.google.com](https://console.firebase.google.com)
   → 新增專案（免費的 Spark 方案對這種規模的遊戲就夠用了）。
2. **開啟驗證功能（Authentication）。** Build > Authentication > 開始使用 > 登入方式：
   打開**匿名登入（Anonymous）**（必要——每個玩家第一次啟動遊戲時都會拿到一個匿名帳號）
   和**Google 登入**（選用——可以讓玩家把帳號綁定到 Google，跨裝置保留進度）。
3. **建立 Firestore。** Build > Firestore Database > 建立資料庫（正式環境模式即可）。
   接著把這個 repo 裡的 [`firestore.rules`](../firestore.rules) 發布上去（Firestore >
   規則分頁，貼上內容並按「發布」）——它會限制每份個人資料文件只有本人（已登入者）能
   讀寫。如果跳過這步，就會維持主控台預設的規則，視你當初選的模式，有可能任何人都能
   讀寫任何人的資料。
4. **取得 Web 設定值。** 專案設定（⚙️齒輪）> 一般 > 你的應用程式 > 新增一個 Web
   應用程式（</> 圖示）> 從畫面上顯示的 `firebaseConfig` 物件複製這四個值：
   `apiKey`、`authDomain`、`projectId`、`appId`。（依 Firebase 自己的設計，這幾個值
   本來就不是機密——存取控制是靠上面那份 Firestore 規則，而不是靠把設定值藏起來——
   不過沒必要的話還是不要把它們提交進版本控制。）
5. **把這四個值接進去：**
   - 本機開發：把 `.env.example` 複製成 `.env.local`，把四個值貼進去。
   - 部署到 GitHub Pages 的版本（`.github/workflows/deploy.yml`）：把同樣四個值加成
     repo 的 secrets——GitHub repo > Settings > Secrets and variables > Actions >
     New repository secret，名稱要完全對應：`VITE_FIREBASE_API_KEY`、
     `VITE_FIREBASE_AUTH_DOMAIN`、`VITE_FIREBASE_PROJECT_ID`、`VITE_FIREBASE_APP_ID`。
     workflow 已經會去讀這些 secrets，下次 push（或手動重跑一次）就會自動生效，不用
     再改任何東西。
6. 重新建置（本機執行 `npm run build`，或部署版直接 push 就會自動跑）。遊戲裡「設定」
   頁面的「帳號狀態」會從「未啟用雲端同步」變成已登入狀態，代表雲端同步真的動起來了。

## 為什麼「預設關閉」是安全的

`src/firebase/config.ts` 會用 `import.meta.env.VITE_FIREBASE_*` 這幾個環境變數算出
`firebaseEnabled`，其他所有東西都被這個開關擋住。關鍵是：`firebase/app`、
`firebase/auth`、`firebase/firestore` 這幾個套件全部都只透過 `getFirebase()`、
`initAuth()`、`linkGoogleAccount()`、`loadProfile()`、`saveProfile()` 裡面的動態
`import()` 載入——完全沒有頂層 `import`。所以沒設定 Firebase 的時候，這些
`import()` 一次都不會被執行，連 SDK 本身都不會被下載（實際檢查過正式建置的網路請求
可以確認這點——見 `docs/architecture.md` 裡關於 bundle 大小的說明）。

## 驗證（`src/firebase/auth.ts`）

- `initAuth(onChange)`：第一次啟動時會自動匿名登入（對應規格書第 46 節），並把
  `AuthStatus`（`disabled` | `signed-out` | `anonymous` | `google` 其中之一）回報給
  呼叫者。`App.tsx` 會在最上層的一個 effect 裡透過 `playerStore.initCloud()` 呼叫一次。
- `linkGoogleAccount()`：在「設定」頁面裡，當 `authStatus === 'anonymous'` 時可以呼叫。
  它是對*現有*的匿名使用者呼叫 `linkWithPopup(auth.currentUser, googleProvider)`——
  刻意用「綁定（link）」而不是重新 `signInWithPopup`，這樣玩家才能保留原本的 uid 和
  進度，而不是變成一個全新帳號。如果這個 Google 帳號已經綁定過另一個 Firebase 使用者
  （會丟出 `auth/credential-already-in-use`），目前只會把錯誤印到 console——規格書
  預期的處理方式（讓玩家自己選要保留哪一邊的進度）還沒做，詳見下面「目前簡化掉的部分」。

## Firestore 資料結構

每個使用者一份文件，所有欄位都攤平放在 `users/{uid}` 底下（不是用子集合——
`playerStore` 整個 `PersistedShape` 就是一份文件）：

```
users/{uid}
  coins, levelRecords, daily, statistics, achievements,
  missionsDaily, missionsWeekly, library, settings, updatedAt
```

這個結構完全比照 `playerStore.ts` 自己的資料形狀（正確的欄位型別以那個檔案為準），
而不是這份文件當初粗略構想的、切得更細的子集合版本——以這個遊戲的規模來說，單一
文件比較容易理解，也符合下面「在檢查點同步整份個人資料」的策略。

## 同步策略（`src/store/playerStore.ts`）

依照規格書第 47/48 節：正在進行中的 `GameState`（每一次拖曳、每一次翻牌）完全不會
碰到 Firestore——它甚至根本不在 `playerStore` 裡，`playerStore` 只保存已經「存檔」
的資料（金幣、最佳成績、統計、任務、成就、圖書館、設定）。每一個會修改資料的
`playerStore` action 都會經過同一個 `commit(get, set)` 函式：

1. 立刻寫入 `localStorage`（無條件執行，所以就算完全離線、或 Firebase 沒開啟，
   遊戲依然能正常運作）。
2. 只有在 `cloudUid` 已經設定好的情況下（也就是 `initCloud()` 的匿名登入完成之後），
   才會透過 `scheduleCloudPush` 排一個防抖動（2 秒）的 Firestore 寫入。

登入的當下，`initCloud()` 會做一次性的合併：讀取雲端的個人資料，比較它的
`updatedAt` 跟本機那份的新舊，整份採用比較新的那一邊。這是刻意做得很單純的
「後寫入者全贏（last-write-wins）」策略，不是逐欄位合併——詳見下方「目前簡化掉的
部分」。

## 目前簡化掉的部分（真的要正式上線前還需要補強）

- **後寫入者全贏，而不是合併。** 如果玩家在兩台裝置上都有還沒同步的本機進度，並且
  在任何一邊同步之前就把兩台都打開，其中一台的那段遊戲紀錄會被直接蓋掉，而不是
  合併起來。單一裝置的玩家（大多數情況）完全不受影響；真的要多裝置同時玩才會有風險。
- **沒有處理 `auth/credential-already-in-use` 的復原流程。** 如果要綁定的 Google
  帳號已經綁在另一個 Firebase 使用者身上，綁定會直接失敗，不會讓玩家選要保留哪一邊
  的進度。
- **雲端寫入失敗沒有重試機制**，除了在 console 印一個錯誤以外什麼都不會做——連線
  中斷導致同步失敗後，要等到下一次本機寫入剛好又觸發 `commit()`，才會再試一次。

以上這些完全不影響「純本機」的遊戲體驗；只有在透過 `.env.local` 接上一個真正的
Firebase 專案之後，這些限制才會實際發生影響。
