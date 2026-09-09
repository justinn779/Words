import type { Category } from '../engine/types'
import { SEED } from './seed'

export const CATEGORIES: Category[] = SEED.map((row) => ({
  id: row.categoryId,
  name: row.name,
  wordIds: row.words.map((_, i) => `${row.categoryId}-${i + 1}`),
}))
