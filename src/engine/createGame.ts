import type { Card, Category, GameState, LevelConfig, WordEntry } from './types'
import { createRng, shuffle } from './rng'

function defaultWordCount(difficulty: LevelConfig['difficulty']): number {
  if (difficulty === 'easy') return 4
  if (difficulty === 'normal') return 5
  return 6
}

/**
 * How many cards each column gets, left to right, decreasing by 1 card per
 * column wherever the total allows it exactly (e.g. 15 cards over 3 columns ->
 * 6,5,4) — by design, not an even/round-robin split. Uses running-sum
 * rounding (not independent per-column rounding) so the sizes always sum to
 * exactly `total` even when it doesn't divide into a perfect arithmetic
 * sequence; the shape just degrades gracefully (e.g. a repeated middle value)
 * instead of drifting off by a card.
 */
function descendingColumnSizes(total: number, columnCount: number): number[] {
  if (columnCount <= 0) return []
  const idealTop = total / columnCount + (columnCount - 1) / 2
  const sizes: number[] = []
  let prevCum = 0
  let running = 0
  for (let i = 0; i < columnCount; i++) {
    running += idealTop - i
    const cum = Math.round(running)
    sizes.push(Math.max(0, cum - prevCum))
    prevCum = cum
  }
  // Rounding can leave a card or two unassigned/over in rare edge cases —
  // true up on the last column so every card in `total` actually gets dealt.
  sizes[columnCount - 1] += total - sizes.reduce((a, b) => a + b, 0)
  return sizes
}

/**
 * Builds a fresh, dealt GameState from a LevelConfig plus the master word/category
 * dataset. Deterministic for a given config.seed so Daily Challenge levels can be
 * shared by seed across players.
 */
export function createGame(
  config: LevelConfig,
  categories: Category[],
  words: WordEntry[],
): GameState {
  const categoriesById = new Map(categories.map((c) => [c.id, c]))
  const wordsById = new Map(words.map((w) => [w.id, w]))
  const rng = createRng(config.seed ?? config.id)

  const allCards: Card[] = []
  const categoryMeta: GameState['categoryMeta'] = {}

  for (const categoryId of config.categoryIds) {
    const category = categoriesById.get(categoryId)
    if (!category) throw new Error(`Unknown category id: ${categoryId}`)

    const requestedCount = config.categoryWordCounts?.[categoryId] ?? defaultWordCount(config.difficulty)
    const count = Math.max(3, Math.min(8, requestedCount, category.wordIds.length))
    const chosenWordIds = shuffle(category.wordIds, rng).slice(0, count)

    categoryMeta[categoryId] = { name: category.name, required: count }

    allCards.push({
      id: `cat-${categoryId}`,
      cardType: 'category',
      categoryId,
      name: category.name,
      requiredWordCount: count,
      faceUp: false,
    })

    for (const wordId of chosenWordIds) {
      const word = wordsById.get(wordId)
      if (!word) throw new Error(`Unknown word id: ${wordId}`)
      allCards.push({
        id: `word-${categoryId}-${wordId}`,
        cardType: 'word',
        wordId,
        text: word.text,
        categoryId,
        faceUp: false,
      })
    }
  }

  const shuffledCards = shuffle(allCards, rng)

  const deckCount = config.deckEnabled
    ? Math.min(config.deckSize, Math.max(0, shuffledCards.length - config.columnCount))
    : 0
  const boardCards = shuffledCards.slice(0, shuffledCards.length - deckCount)
  const deckCards = shuffledCards.slice(shuffledCards.length - deckCount)

  const columnSizes = descendingColumnSizes(boardCards.length, config.columnCount)
  const columns: Card[][] = []
  let dealt = 0
  for (const size of columnSizes) {
    columns.push(boardCards.slice(dealt, dealt + size))
    dealt += size
  }

  for (const column of columns) {
    column.forEach((card, i) => {
      card.faceUp = i === column.length - 1
    })
  }

  const deck: Card[] = deckCards.map((card) => ({ ...card, faceUp: false }))

  return {
    levelId: config.id,
    difficulty: config.difficulty,
    columns,
    deck,
    waste: [],
    categorySlots: Array.from({ length: config.categorySlotCount }, () => null),
    completedCategories: [],
    categoryMeta,
    moves: 0,
    startedAt: Date.now(),
    coinsSpent: 0,
    hintsUsed: 0,
    status: 'playing',
    history: [],
  }
}
