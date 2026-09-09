import type { WordEntry } from '../engine/types'
import { SEED } from './seed'

export const WORDS: WordEntry[] = SEED.flatMap((row) =>
  row.words.map((text, i) => ({
    id: `${row.categoryId}-${i + 1}`,
    text,
    possibleCategoryIds: [row.categoryId],
  })),
)
