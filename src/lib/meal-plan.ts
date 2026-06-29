/**
 * Pure, client-safe dinner randomizer. Lives in `lib` (no React, no db imports)
 * so it can be unit-tested and reused: the recipes overview already loads the
 * full list with tags + ratings, and this picks a random distinct subset from
 * that already-loaded pool.
 *
 * Randomness is injected (`random: () => number`) rather than calling
 * `Math.random` directly so tests can drive a deterministic sequence. The
 * weighting is expressed as a single per-recipe weight function built from the
 * options — adding a new weighting factor later means folding another term into
 * {@link recipeWeight}, not reworking the draw.
 */

/** The slice of a recipe the randomizer needs. `RecipeListItem` is a superset. */
export interface MealPlanRecipe {
  id: string
  title: string
  tags: string[]
  /** Average household rating (0 when unrated). */
  ratingAvg: number
  ratingCount: number
}

/** "At least `min` recipes carrying `tag`." */
export interface TagRequirement {
  tag: string
  min: number
}

export interface MealPlanOptions {
  /** How many distinct recipes to pick. Required; 1–{@link MAX_DINNERS}. */
  count: number
  /** Restrict the pool to recipes carrying *every* one of these tags (a plain
   *  filter, no count). Used for the meal-category chips. Empty = no restriction. */
  requiredTags?: string[]
  /** Optional, repeatable "≥N with tag T" rules. */
  tagRequirements?: TagRequirement[]
  /** Exclude recipes whose average rating is below this (0/undefined = no filter). */
  minRating?: number
  /** Bias the draw toward higher-rated recipes when true. */
  weightByRating?: boolean
}

/** Hard upper bound on how many dinners may be drawn at once. */
export const MAX_DINNERS = 14

/** A structured reason the draw could not be satisfied — the UI maps these to
 *  Norwegian copy so messages stay close to the failing constraint. */
export type MealPlanFailure =
  | { code: 'invalid-count' }
  | { code: 'empty-pool'; minRating: number }
  | { code: 'not-enough-recipes'; available: number; requested: number }
  | {
      // A single tag rule can't be met from the (rating-filtered) pool.
      code: 'tag-shortfall'
      tag: string
      requested: number
      available: number
    }
  | {
      // Per-tag rules are each satisfiable, but their minimums sum past `count`.
      code: 'requirements-exceed-count'
      required: number
      count: number
    }

export type MealPlanResult =
  | { ok: true; recipes: MealPlanRecipe[] }
  | { ok: false; failure: MealPlanFailure }

/**
 * Per-recipe selection weight. Currently: 1 by default, or rating-biased when
 * `weightByRating` is on. Unrated recipes (avg 0) keep a small floor weight so
 * they can still be drawn; a rated recipe's weight scales with its average so a
 * 10/10 is ~10× as likely as a 1/10. Extend by multiplying in further factors.
 */
function recipeWeight(recipe: MealPlanRecipe, opts: MealPlanOptions): number {
  if (!opts.weightByRating) return 1
  // Floor keeps unrated/low recipes in the running; +1 avoids a 0 weight.
  return recipe.ratingAvg > 0 ? recipe.ratingAvg : 1
}

/**
 * Draw one recipe from `pool` weighted by `weights`, remove it from both, and
 * return it. `pool`/`weights` are mutated (kept parallel) so the caller can draw
 * repeatedly without re-picking. Returns null only for an empty pool.
 */
function drawWeighted(
  pool: MealPlanRecipe[],
  weights: number[],
  random: () => number,
): MealPlanRecipe | null {
  if (pool.length === 0) return null
  const total = weights.reduce((s, w) => s + w, 0)
  let threshold = random() * total
  let idx = 0
  // Walk the cumulative weights; the last index is a safe fallback for any
  // floating-point overshoot at random() ≈ 1.
  for (; idx < pool.length - 1; idx++) {
    threshold -= weights[idx]
    if (threshold < 0) break
  }
  const [picked] = pool.splice(idx, 1)
  weights.splice(idx, 1)
  return picked
}

/**
 * Pick `count` distinct recipes from `recipes`, honouring (in order): the
 * min-rating filter on the pool, then each tag minimum, then a weighted fill
 * for the remainder. Returns a structured failure rather than silently
 * returning fewer when a constraint can't be met.
 */
export function planMeals(
  recipes: MealPlanRecipe[],
  options: MealPlanOptions,
  random: () => number = Math.random,
): MealPlanResult {
  const count = Math.floor(options.count)
  if (!Number.isFinite(count) || count < 1 || count > MAX_DINNERS) {
    return { ok: false, failure: { code: 'invalid-count' } }
  }

  const minRating = options.minRating ?? 0
  const requiredTags = (options.requiredTags ?? []).filter(
    (t) => t.trim().length > 0,
  )
  // Drop only meaningful (non-empty) tag rules; a 0/blank rule is a no-op.
  const requirements = (options.tagRequirements ?? []).filter(
    (r) => r.tag.trim().length > 0 && r.min > 0,
  )

  // The pool: everything clearing the min-rating filter and carrying every
  // required (meal-category) tag.
  const pool = recipes.filter(
    (r) =>
      r.ratingAvg >= minRating &&
      requiredTags.every((t) => r.tags.includes(t)),
  )
  if (pool.length === 0) {
    return { ok: false, failure: { code: 'empty-pool', minRating } }
  }
  if (pool.length < count) {
    return {
      ok: false,
      failure: {
        code: 'not-enough-recipes',
        available: pool.length,
        requested: count,
      },
    }
  }

  // Each rule's minimum must be reachable from the (filtered) pool on its own…
  for (const req of requirements) {
    const available = pool.filter((r) => r.tags.includes(req.tag)).length
    if (available < req.min) {
      return {
        ok: false,
        failure: {
          code: 'tag-shortfall',
          tag: req.tag,
          requested: req.min,
          available,
        },
      }
    }
  }
  // …and the minimums together can't ask for more than `count`. (A recipe can
  // satisfy several rules at once, so this is a conservative upper check — the
  // greedy phase below de-dupes, so the real total picked may be lower.)
  const requiredTotal = requirements.reduce((s, r) => s + r.min, 0)
  if (requiredTotal > count) {
    return {
      ok: false,
      failure: {
        code: 'requirements-exceed-count',
        required: requiredTotal,
        count,
      },
    }
  }

  // Working pool kept parallel with its weights so draws stay in sync.
  const working = [...pool]
  const weights = working.map((r) => recipeWeight(r, options))
  const chosen: MealPlanRecipe[] = []
  const chosenIds = new Set<string>()

  const take = (recipe: MealPlanRecipe) => {
    chosen.push(recipe)
    chosenIds.add(recipe.id)
  }

  // Phase 1 — satisfy tag minimums. For each rule, draw from the sub-pool of
  // still-available recipes that carry the tag, counting any already-chosen
  // recipe that happens to carry it (so overlapping rules share picks).
  for (const req of requirements) {
    let have = chosen.filter((r) => r.tags.includes(req.tag)).length
    while (have < req.min) {
      // Build a weighted sub-pool of unchosen recipes carrying this tag.
      const subPool: MealPlanRecipe[] = []
      const subWeights: number[] = []
      for (let i = 0; i < working.length; i++) {
        if (working[i].tags.includes(req.tag)) {
          subPool.push(working[i])
          subWeights.push(weights[i])
        }
      }
      const picked = drawWeighted(subPool, subWeights, random)
      // Guarded by the per-rule availability check above, so this is reachable
      // only if the pool truly runs dry mid-draw — treat as a shortfall.
      if (!picked) {
        return {
          ok: false,
          failure: {
            code: 'tag-shortfall',
            tag: req.tag,
            requested: req.min,
            available: have,
          },
        }
      }
      // Remove the pick from the main working pool too.
      const at = working.findIndex((r) => r.id === picked.id)
      working.splice(at, 1)
      weights.splice(at, 1)
      take(picked)
      have++
    }
  }

  // Phase 2 — fill the remainder with a weighted draw from whatever's left.
  while (chosen.length < count) {
    const picked = drawWeighted(working, weights, random)
    if (!picked) break // pool exhausted; guarded by the count check above
    if (!chosenIds.has(picked.id)) take(picked)
  }

  // Defensive: the up-front checks make this unreachable, but never return a
  // short list silently.
  if (chosen.length < count) {
    return {
      ok: false,
      failure: {
        code: 'not-enough-recipes',
        available: chosen.length,
        requested: count,
      },
    }
  }

  return { ok: true, recipes: chosen }
}
