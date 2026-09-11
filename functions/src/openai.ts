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

function buildPrompt(existingCategoryIds: string[], count: number): string {
  return `你是「文字接龍」這款繁體中文文字分類接龍遊戲的內容設計師。

請設計 ${count} 個全新的詞語分類，每個分類需要：
- categoryId：英文 slug（小寫字母、可用連字號，例如 "space-object"），不可與下列已存在的 ID 重複：${existingCategoryIds.join(', ') || '（無）'}
- name：分類的繁體中文顯示名稱（例如「水果」「動物」），2-6 個字
- words：${WORDS_PER_CATEGORY} 個繁體中文詞語，每個詞語必須：
  - 明確、毫無疑義地只屬於這一個分類（玩家看到這個詞不需要猜測分類，遊戲的挑戰在於排列卡片、不在於分類判斷）
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
export async function generateCategories(apiKey: string, existingCategoryIds: string[], count: number): Promise<GeneratedCategory[]> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: buildPrompt(existingCategoryIds, count) }],
      response_format: { type: 'json_object' },
      temperature: 0.9,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`OpenAI request failed: ${response.status} ${response.statusText} ${body.slice(0, 500)}`)
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenAI response had no content')

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('OpenAI response was not valid JSON')
  }

  const categories = (parsed as { categories?: unknown }).categories
  if (!Array.isArray(categories)) throw new Error('OpenAI response missing a "categories" array')

  return categories.map((c, i) => {
    const cat = c as Partial<GeneratedCategory>
    if (typeof cat.categoryId !== 'string' || typeof cat.name !== 'string' || !Array.isArray(cat.words)) {
      throw new Error(`Malformed category at index ${i}`)
    }
    return {
      categoryId: cat.categoryId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      name: cat.name.trim(),
      words: cat.words.filter((w): w is string => typeof w === 'string').map((w) => w.trim()),
    }
  })
}
