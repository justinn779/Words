// Talks to the OpenAI API to generate new category content (a category name plus
// a word list) for the game's category pool. This is the ONLY place in the whole
// project that ever sees the OPENAI_API_KEY — it's injected via Firebase Functions
// Secrets (see functions/README.md), never committed, never sent to the client.
//
// AI output is content only (a category name + word list), matching the shape of
// src/data/seed.ts's SeedRow. It is never trusted to hand-place cards or guarantee
// solvability — see generateAndVerifyCategories in index.ts, which always re-runs
// the same generate -> solve -> accept/reject pipeline (src/engine/generator.ts)
// that every hand-authored level goes through before anything reaches a player.

export interface GeneratedCategory {
  categoryId: string
  name: string
  words: string[]
}

const OPENAI_MODEL = 'gpt-4o-mini'
const WORDS_PER_CATEGORY = 10

/** Shared request/parse plumbing for every OpenAI call in this file — a single
 * user-message chat completion asked to return one JSON object. Throws on any
 * network/format failure; callers parse the specific shape they expect out of
 * the returned object. */
async function callOpenAiJson(apiKey: string, prompt: string): Promise<unknown> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.9,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`OpenAI request failed: ${response.status} ${response.statusText} ${body.slice(0, 500)}`)
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenAI response had no content')

  try {
    return JSON.parse(content)
  } catch {
    throw new Error('OpenAI response was not valid JSON')
  }
}

function parseGeneratedCategory(c: unknown, i: number): GeneratedCategory {
  const cat = c as Partial<GeneratedCategory>
  if (typeof cat.categoryId !== 'string' || typeof cat.name !== 'string' || !Array.isArray(cat.words)) {
    throw new Error(`Malformed category at index ${i}`)
  }
  return {
    categoryId: cat.categoryId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    name: cat.name.trim(),
    words: cat.words.filter((w): w is string => typeof w === 'string').map((w) => w.trim()),
  }
}

function buildPrompt(existingCategoryIds: string[], count: number, theme?: string): string {
  return `你是「文字接龍」這款繁體中文文字分類接龍遊戲的內容設計師。
${theme ? `\n這批分類是為了新章節「${theme}」設計。這個主題底下要能同時容納好幾個彼此角度完全不同的分類——例如同一個主題若拆成「A的種類一」「A的種類二」這種只是範圍大小不同的分類，玩家會分不清一個詞該歸哪個，這樣不合格；分類之間應該像是這個主題的不同「面向」（例如器材 vs. 人物 vs. 場所 vs. 事件），彼此天生就不會混淆。\n` : ''}
請設計 ${count} 個全新的詞語分類，每個分類需要：
- categoryId：英文 slug（小寫字母、可用連字號，例如 "space-object"），不可與下列已存在的 ID 重複：${existingCategoryIds.join(', ') || '（無）'}
- name：分類的繁體中文顯示名稱（例如「水果」「動物」），2-6 個字，要具體到玩家一看就知道範圍，不能是「特殊道具」「經典人物」這種模糊到什麼都能塞的名稱
- words：${WORDS_PER_CATEGORY} 個繁體中文詞語，每個詞語必須：
  - 明確、毫無疑義地只屬於這一個分類（玩家看到這個詞不需要猜測分類，遊戲的挑戰在於排列卡片、不在於分類判斷）
  - 讀者看到這個詞時，不會聯想到這批分類中的「另一個」分類——如果某個詞放進另一個分類也說得通，就不合格，換一個更專屬的詞
  - 2-5 個中文字
  - 彼此不重複
  - 避免地域敏感、爭議性、或需要專業知識才懂的冷僻詞彙
  - 避免與常見分類（水果、動物、樂器、國家、城市、交通工具、運動、職業、飲料、甜點、海洋生物、鳥類、昆蟲、花卉、家具、家電、衣物、文具、天氣、風景、行星、料理、節慶、電影類型、音樂類型、建築、身體部位、顏色、學科、工具）明顯重疊

只回傳一個 JSON 物件，格式為 {"categories":[{"categoryId":"...","name":"...","words":["...", ...]}]}，不要有任何其他文字、解說或 markdown 標記。`
}

/** Calls OpenAI to generate `count` brand-new categories, distinct from
 * `existingCategoryIds`. Throws on any network/format failure — the caller decides
 * whether to retry, since this function does no validation of its own beyond
 * parsing the JSON shape. */
export async function generateCategories(
  apiKey: string,
  existingCategoryIds: string[],
  count: number,
  theme?: string,
): Promise<GeneratedCategory[]> {
  const parsed = await callOpenAiJson(apiKey, buildPrompt(existingCategoryIds, count, theme))
  const categories = (parsed as { categories?: unknown }).categories
  if (!Array.isArray(categories)) throw new Error('OpenAI response missing a "categories" array')
  return categories.map(parseGeneratedCategory)
}

export interface GeneratedChapterContent {
  chapterTitle: string
  categories: GeneratedCategory[]
}

function buildNewChapterPrompt(existingCategoryIds: string[], existingChapterTitles: string[], count: number): string {
  return `你是「文字接龍」這款繁體中文文字分類接龍遊戲的內容設計師。

玩家已經破完所有現有章節，需要一個全新的章節主題。請先想一個範圍夠大的新主題（2-6 個字），大到底下能同時放進好幾個彼此角度完全不同的分類——參考等級是「日常生活」「自然世界」「飲食文化」「世界旅行」「藝術與娛樂」這種涵蓋很多面向的大主題，而不是「復古電玩」「懷舊遊戲」這種範圍太窄、底下的分類只能圍繞同一件事拆來拆去（拆出來的分類會長得很像、玩家分不出詞該歸哪個）的小眾主題。不可與下列已存在的章節主題重複或高度相似：${existingChapterTitles.join('、') || '（無）'}

接著圍繞這個主題，設計 ${count} 個全新的詞語分類，每個分類要代表主題底下明顯不同的「面向」（例如器材 vs. 人物 vs. 場所 vs. 事件），而不是同一個小範圍拆成好幾份：
- categoryId：英文 slug（小寫字母、可用連字號，例如 "space-object"），不可與下列已存在的 ID 重複：${existingCategoryIds.join(', ') || '（無）'}
- name：分類的繁體中文顯示名稱（例如「水果」「動物」），2-6 個字，要具體到玩家一看就知道範圍，不能是「特殊道具」「經典人物」這種模糊到什麼都能塞的名稱
- words：${WORDS_PER_CATEGORY} 個繁體中文詞語，每個詞語必須：
  - 明確、毫無疑義地只屬於這一個分類（玩家看到這個詞不需要猜測分類，遊戲的挑戰在於排列卡片、不在於分類判斷）
  - 讀者看到這個詞時，不會聯想到這批分類中的「另一個」分類——如果某個詞放進另一個分類也說得通，就不合格，換一個更專屬的詞
  - 2-5 個中文字
  - 彼此不重複
  - 避免地域敏感、爭議性、或需要專業知識才懂的冷僻詞彙

只回傳一個 JSON 物件，格式為 {"chapterTitle":"...","categories":[{"categoryId":"...","name":"...","words":["...", ...]}]}，不要有任何其他文字、解說或 markdown 標記。`
}

/** Like generateCategories, but for a brand-new chapter beyond the pre-named
 * placeholders (src/data/chapters.ts) — OpenAI invents both a short chapter
 * theme/title and the categories to go with it in one response, so the two stay
 * thematically consistent without two separate round trips. */
export async function generateNewChapterContent(
  apiKey: string,
  existingCategoryIds: string[],
  existingChapterTitles: string[],
  count: number,
): Promise<GeneratedChapterContent> {
  const parsed = await callOpenAiJson(apiKey, buildNewChapterPrompt(existingCategoryIds, existingChapterTitles, count))
  const obj = parsed as { chapterTitle?: unknown; categories?: unknown }
  if (typeof obj.chapterTitle !== 'string' || !obj.chapterTitle.trim()) {
    throw new Error('OpenAI response missing a "chapterTitle" string')
  }
  if (!Array.isArray(obj.categories)) throw new Error('OpenAI response missing a "categories" array')
  return { chapterTitle: obj.chapterTitle.trim(), categories: obj.categories.map(parseGeneratedCategory) }
}

export interface CategoryReview {
  categoryId: string
  keep: boolean
  reason?: string
}

function buildReviewPrompt(categories: GeneratedCategory[]): string {
  const listing = categories.map((c) => `- ${c.categoryId}（${c.name}）：${c.words.join('、')}`).join('\n')
  return `你是「文字接龍」這款繁體中文文字分類接龍遊戲的內容品質審核員。以下每個分類都已經通過格式與電腦可解性檢查，現在請你以嚴格玩家的角度覆核，找出品質有問題的分類：

${listing}

審核標準（任一項不符就該淘汰）：
1. 每個詞語是否「明確且毫無疑義」只屬於這個分類？玩家看到詞語不應該需要猜測或懷疑分類——如果某個詞語其實也能合理歸進別的常見分類，就算不合格。
2. 分類名稱本身是否具體清楚？像「經典角色」「特殊物品」這種過於空泛、什麼都能塞進去的分類名稱不合格。
3. 是否有詞語過於冷僻、專業、或一般玩家不會認得？
4. 詞語跟分類主題的關聯是否自然，而不是硬湊湊出來的？
5. 跟「上面同一批列出的其他分類」相比，這個分類的角度是否明顯不同？如果兩個分類其實只是同一件事的不同切法（例如「懷舊主機」跟「懷舊街機」都只是電玩硬體的子分類，換一批詞放進另一個也說得通），把角度較窄、較容易跟別的分類混淆的那個淘汰。

對每一個分類回傳 keep（是否保留）與 reason（簡短說明，尤其是 keep=false 時務必說明原因）。只回傳一個 JSON 物件，格式為 {"reviews":[{"categoryId":"...","keep":true,"reason":"..."}]}，每個分類都要出現一次，不要有其他文字。`
}

/** Second, semantic quality gate — runs after the mechanical checks
 * (isWellFormed/verifySolvable/word-collision in index.ts) on whatever
 * survived them. Those checks can't catch a vague category name, a word that's
 * technically unique but still ambiguous, or ones a native reader would find
 * awkward — this asks the model to self-critique its own output against
 * exactly those criteria. One call per generation attempt (reviews the whole
 * batch at once), not one per category, to keep cost/latency down. A reviewer
 * failure (bad JSON, missing entries) never blocks generation — see index.ts's
 * reviewAcceptedCategories, which treats a missing review as "keep" rather
 * than discarding content over a formatting hiccup in the review call itself. */
export async function reviewCategories(apiKey: string, categories: GeneratedCategory[]): Promise<CategoryReview[]> {
  if (categories.length === 0) return []
  const parsed = await callOpenAiJson(apiKey, buildReviewPrompt(categories))
  const reviews = (parsed as { reviews?: unknown }).reviews
  if (!Array.isArray(reviews)) throw new Error('OpenAI response missing a "reviews" array')
  return reviews
    .map((r) => r as Partial<CategoryReview>)
    .filter((r): r is CategoryReview => typeof r.categoryId === 'string' && typeof r.keep === 'boolean')
}
