// Offline authoring tool (Phase 3). Run with:
//   npx tsx scripts/generate-levels.ts
// Regenerates src/data/levels.ts: for every chapter, builds a run of levels with a
// difficulty curve, picks a random category mix per level from that chapter's pool,
// and only accepts a deal once src/engine/solver.ts confirms it's winnable (spec
// section 29) — see src/engine/generator.ts for the retry-on-seed logic.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { CATEGORIES } from '../src/data/categories'
import { WORDS } from '../src/data/words'
import { createRng, shuffle } from '../src/engine/rng'
import { generateSolvableLevel, type LevelConfigWithoutSeed } from '../src/engine/generator'
import { DIFFICULTY_SHAPE, varyWordCounts, totalCardCount, estimateTargets } from '../src/data/difficultyShapes'
import type { Difficulty, LevelConfig } from '../src/engine/types'

interface ChapterPlan {
  chapterId: string
  /** Category ids this chapter draws its levels from. */
  pool: string[]
  /** One entry per level, in order, cheapest to hardest. */
  curve: Difficulty[]
}

// Chapters left out here (science-world, history-culture, curious-facts) stay locked
// with zero levels — the spec explicitly allows an uneven chapter roster (section 36).
const PLAN: ChapterPlan[] = [
  {
    chapterId: 'daily-life',
    pool: ['fruit', 'animal', 'vehicle', 'drink', 'dessert', 'furniture', 'appliance', 'clothing', 'stationery', 'color', 'occupation', 'tool'],
    curve: ['easy', 'easy', 'easy', 'normal', 'normal', 'normal', 'hard', 'hard'],
  },
  {
    chapterId: 'natural-world',
    pool: ['bird', 'insect', 'flower', 'marine', 'weather', 'scenery', 'planet'],
    curve: ['easy', 'easy', 'normal', 'normal', 'hard', 'hard'],
  },
  {
    chapterId: 'food-culture',
    // Only 5 categories in this pool — exactly hard's categoryCount, so every
    // 'hard' level here always uses the whole pool.
    pool: ['fruit', 'drink', 'dessert', 'cuisine', 'festival'],
    curve: ['easy', 'easy', 'normal', 'normal', 'hard', 'hard'],
  },
  {
    chapterId: 'world-travel',
    pool: ['country', 'city', 'vehicle', 'sport', 'occupation', 'cuisine'],
    curve: ['easy', 'easy', 'normal', 'normal', 'hard', 'hard'],
  },
  {
    chapterId: 'arts-entertainment',
    // Only 4 categories in this pool, so 'hard' here clamps down to the whole
    // pool — same category count as 'normal', but still harder via more
    // columns and a bigger deck.
    pool: ['instrument', 'musicGenre', 'filmGenre', 'architecture'],
    curve: ['easy', 'easy', 'normal', 'normal', 'hard'],
  },
]

function buildBaseConfig(
  chapterId: string,
  difficulty: Difficulty,
  index: number,
  categoryIds: string[],
  categoryWordCounts: Record<string, number>,
): LevelConfigWithoutSeed {
  const shape = DIFFICULTY_SHAPE[difficulty]
  return {
    id: `${chapterId}-${String(index + 1).padStart(2, '0')}`,
    chapterId,
    difficulty,
    categoryIds,
    columnCount: shape.columnCount,
    categorySlotCount: shape.slotCount,
    deckEnabled: shape.deckEnabled,
    deckSize: shape.deckSize,
    categoryWordCounts,
    // Placeholder — overwritten once the solver reports a real move count.
    targetThreeStarMoves: 0,
    targetTwoStarMoves: 0,
    targetThreeStarTime: 0,
    targetTwoStarTime: 0,
  }
}

function generateChapter(plan: ChapterPlan): { levels: LevelConfig[]; warnings: string[] } {
  const rng = createRng(`levelplan-${plan.chapterId}`)
  const levels: LevelConfig[] = []
  const warnings: string[] = []

  plan.curve.forEach((difficulty, index) => {
    const shape = DIFFICULTY_SHAPE[difficulty]
    const categoryCount = Math.min(shape.categoryCount, plan.pool.length)
    const categoryIds = shuffle(plan.pool, rng).slice(0, categoryCount)
    // Varied, not uniform, per-category word counts — see difficultyShapes.ts.
    const categoryWordCounts = varyWordCounts(rng, difficulty, categoryIds)
    const base = buildBaseConfig(plan.chapterId, difficulty, index, categoryIds, categoryWordCounts)

    const result = generateSolvableLevel(base, CATEGORIES, WORDS)
    const targets = estimateTargets(totalCardCount(categoryWordCounts))

    if (!result.solvable) {
      warnings.push(`${base.id}: no solver-confirmed solution found in ${result.attempts} attempts — accepted unverified`)
    } else {
      console.log(`  ${result.config.id}: solved in ${result.attempts} attempt(s), DFS found a ${result.moveCount}-move solution (not the par — see target*Moves)`)
    }

    levels.push({ ...result.config, ...targets })
  })

  return { levels, warnings }
}

function main() {
  const allLevels: LevelConfig[] = []
  const allWarnings: string[] = []

  for (const plan of PLAN) {
    const { levels, warnings } = generateChapter(plan)
    allLevels.push(...levels)
    allWarnings.push(...warnings)
    console.log(`${plan.chapterId}: generated ${levels.length} levels`)
  }

  if (allWarnings.length > 0) {
    console.warn('\nWarnings:')
    allWarnings.forEach((w) => console.warn(`  - ${w}`))
  }

  const header = `// AUTO-GENERATED by scripts/generate-levels.ts — do not hand-edit.
// Regenerate with: npx tsx scripts/generate-levels.ts
// Every level here was accepted only after src/engine/solver.ts confirmed it is
// winnable (see docs/level-generator.md), except any flagged in that script's
// warning output, which are marked unverified and best treated as provisional.

import type { LevelConfig } from '../engine/types'

export const LEVELS: LevelConfig[] = ${JSON.stringify(allLevels, null, 2)}
`

  const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'levels.ts')
  writeFileSync(outPath, header, 'utf-8')
  console.log(`\nWrote ${allLevels.length} levels to ${outPath}`)
}

main()
