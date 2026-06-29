import { describe, expect, it } from 'vitest'

import {
  MAX_DINNERS,
  planMeals,
  type MealPlanRecipe,
} from '@/lib/meal-plan'

/** Defaults so each test only specifies the fields it cares about. */
let seq = 0
const recipe = (over: Partial<MealPlanRecipe>): MealPlanRecipe => ({
  id: `r${seq++}`,
  title: 'Oppskrift',
  tags: [],
  ratingAvg: 0,
  ratingCount: 0,
  ...over,
})

/** A deterministic RNG cycling through a fixed list of [0,1) values. */
const rngFrom = (values: number[]) => {
  let i = 0
  return () => values[i++ % values.length]
}

/** Build N plain recipes, each tagged 'middag'. */
const middager = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    recipe({ id: `m${i}`, title: `Middag ${i}`, tags: ['middag'] }),
  )

describe('planMeals', () => {
  it('picks exactly the requested count of distinct recipes', () => {
    const result = planMeals(middager(10), { count: 5 }, rngFrom([0.1]))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.recipes).toHaveLength(5)
    const ids = new Set(result.recipes.map((r) => r.id))
    expect(ids.size).toBe(5)
  })

  it('rejects a count below 1 or above the hard max', () => {
    expect(planMeals(middager(20), { count: 0 })).toMatchObject({
      ok: false,
      failure: { code: 'invalid-count' },
    })
    expect(
      planMeals(middager(20), { count: MAX_DINNERS + 1 }),
    ).toMatchObject({ ok: false, failure: { code: 'invalid-count' } })
  })

  it('satisfies tag minimums before filling the rest', () => {
    const pool = [
      recipe({ id: 'f1', tags: ['fisk'] }),
      recipe({ id: 'f2', tags: ['fisk'] }),
      recipe({ id: 'v1', tags: ['vegetar'] }),
      recipe({ id: 'k1', tags: ['kjøtt'] }),
      recipe({ id: 'k2', tags: ['kjøtt'] }),
    ]
    const result = planMeals(
      pool,
      {
        count: 4,
        tagRequirements: [
          { tag: 'fisk', min: 2 },
          { tag: 'vegetar', min: 1 },
        ],
      },
      rngFrom([0]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.recipes).toHaveLength(4)
    expect(result.recipes.filter((r) => r.tags.includes('fisk'))).toHaveLength(2)
    expect(
      result.recipes.filter((r) => r.tags.includes('vegetar')),
    ).toHaveLength(1)
  })

  it('lets one recipe satisfy two overlapping tag rules', () => {
    const pool = [
      recipe({ id: 'both', tags: ['fisk', 'sunt'] }),
      recipe({ id: 'a', tags: ['kjøtt'] }),
      recipe({ id: 'b', tags: ['kjøtt'] }),
    ]
    const result = planMeals(
      pool,
      {
        count: 2,
        tagRequirements: [
          { tag: 'fisk', min: 1 },
          { tag: 'sunt', min: 1 },
        ],
      },
      rngFrom([0]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The single 'both' recipe covers both rules, leaving room for one filler.
    expect(result.recipes).toHaveLength(2)
    expect(result.recipes.map((r) => r.id)).toContain('both')
  })

  it('excludes recipes below the min-rating filter', () => {
    const pool = [
      recipe({ id: 'low', ratingAvg: 3, ratingCount: 2 }),
      recipe({ id: 'mid', ratingAvg: 6, ratingCount: 2 }),
      recipe({ id: 'high', ratingAvg: 9, ratingCount: 2 }),
    ]
    const result = planMeals(pool, { count: 2, minRating: 6 }, rngFrom([0]))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.recipes.map((r) => r.id).sort()).toEqual(['high', 'mid'])
  })

  it('fails when the min-rating filter empties the pool', () => {
    const pool = [recipe({ ratingAvg: 4 }), recipe({ ratingAvg: 5 })]
    expect(planMeals(pool, { count: 1, minRating: 8 })).toMatchObject({
      ok: false,
      failure: { code: 'empty-pool', minRating: 8 },
    })
  })

  it('fails when asked for more recipes than the pool holds', () => {
    expect(planMeals(middager(3), { count: 5 })).toMatchObject({
      ok: false,
      failure: { code: 'not-enough-recipes', available: 3, requested: 5 },
    })
  })

  it('fails when a tag rule cannot be met from the pool', () => {
    const pool = [
      recipe({ id: 'f1', tags: ['fisk'] }),
      ...middager(4),
    ]
    expect(
      planMeals(pool, {
        count: 4,
        tagRequirements: [{ tag: 'fisk', min: 2 }],
      }),
    ).toMatchObject({
      ok: false,
      failure: { code: 'tag-shortfall', tag: 'fisk', requested: 2, available: 1 },
    })
  })

  it('fails when tag minimums together exceed the count', () => {
    const pool = [
      recipe({ id: 'f1', tags: ['fisk'] }),
      recipe({ id: 'f2', tags: ['fisk'] }),
      recipe({ id: 'v1', tags: ['vegetar'] }),
      recipe({ id: 'v2', tags: ['vegetar'] }),
    ]
    expect(
      planMeals(pool, {
        count: 2,
        tagRequirements: [
          { tag: 'fisk', min: 2 },
          { tag: 'vegetar', min: 2 },
        ],
      }),
    ).toMatchObject({
      ok: false,
      failure: { code: 'requirements-exceed-count', required: 4, count: 2 },
    })
  })

  it('ignores blank/zero tag requirements as no-ops', () => {
    const result = planMeals(
      middager(5),
      {
        count: 2,
        tagRequirements: [
          { tag: '', min: 3 },
          { tag: 'fisk', min: 0 },
        ],
      },
      rngFrom([0]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.recipes).toHaveLength(2)
  })

  it('weights the draw toward higher-rated recipes', () => {
    // With weight-by-rating, a 10-avg recipe should be drawn far more often than
    // a 1-avg one across many single-pick draws with a uniform RNG.
    const pool = [
      recipe({ id: 'low', ratingAvg: 1, ratingCount: 1 }),
      recipe({ id: 'high', ratingAvg: 10, ratingCount: 1 }),
    ]
    let highCount = 0
    const N = 2000
    for (let i = 0; i < N; i++) {
      // Spread RNG values across [0,1) deterministically per iteration.
      const r = planMeals(
        pool,
        { count: 1, weightByRating: true },
        rngFrom([(i + 0.5) / N]),
      )
      if (r.ok && r.recipes[0].id === 'high') highCount++
    }
    // Expected share ≈ 10/11 ≈ 0.91; assert a comfortable lower bound.
    expect(highCount / N).toBeGreaterThan(0.8)
  })

  it('is deterministic given a fixed RNG', () => {
    const pool = middager(8)
    const opts = { count: 4 }
    const rng = () => 0.42
    const a = planMeals(pool, opts, rng)
    const b = planMeals(pool, opts, rng)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.recipes.map((r) => r.id)).toEqual(b.recipes.map((r) => r.id))
  })

  it('restricts the pool to recipes carrying every requiredTag', () => {
    const pool = [
      recipe({ id: 'd1', tags: ['middag'] }),
      recipe({ id: 'd2', tags: ['middag'] }),
      recipe({ id: 'f1', tags: ['frokost'] }),
    ]
    const result = planMeals(
      pool,
      { count: 2, requiredTags: ['middag'] },
      rngFrom([0.1]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.recipes.map((r) => r.id).sort()).toEqual(['d1', 'd2'])
  })

  it('reports empty-pool when requiredTags exclude everything', () => {
    expect(
      planMeals(middager(5), { count: 2, requiredTags: ['dessert'] }),
    ).toMatchObject({ ok: false, failure: { code: 'empty-pool' } })
  })
})
