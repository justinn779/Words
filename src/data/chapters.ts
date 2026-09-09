export interface ChapterMeta {
  id: string
  title: string
}

// The 8 sample chapter themes from the spec (section 36). Only 5 currently have
// levels (see scripts/generate-levels.ts); the rest render as permanently
// "coming soon" — see progression.ts — to prove the structure scales without
// hardcoding a level count or a chapter count anywhere in the UI.
export const CHAPTERS: ChapterMeta[] = [
  { id: 'daily-life', title: '第一章 日常生活' },
  { id: 'natural-world', title: '第二章 自然世界' },
  { id: 'food-culture', title: '第三章 飲食文化' },
  { id: 'world-travel', title: '第四章 世界旅行' },
  { id: 'arts-entertainment', title: '第五章 藝術與娛樂' },
  { id: 'science-world', title: '第六章 科學世界' },
  { id: 'history-culture', title: '第七章 歷史文化' },
  { id: 'curious-facts', title: '第八章 奇妙知識' },
]
