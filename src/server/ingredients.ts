import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { and, eq, isNull, or } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { ingredientCatalog } from '@/db/schema'
import { DEFAULT_CATEGORY, normalizeCategory } from '@/lib/categories'
import { requireUser } from '@/server/auth'
import { accessibleScope } from '@/server/sharing'

export interface IngredientSuggestion {
  name: string
  category: string
  /** True for the household's own saved ingredients (vs. shared stock). */
  isHousehold: boolean
}

/** Lower-cased lookup/dedup key for an ingredient name. */
export function nameKey(name: string) {
  return name.trim().toLowerCase()
}

/**
 * Catalog entries visible to a household: every stock row plus the household's
 * own rows, keyed by name with the household row shadowing a stock row of the
 * same name. Returns a Map of nameKey -> { name, category, isHousehold }.
 * Server-only; shared by the autocomplete and the shopping-list categorization.
 */
export const catalogForScope = createServerOnlyFn(async (householdId: string) => {
  const rows = await db
    .select({
      scopeId: ingredientCatalog.scopeId,
      name: ingredientCatalog.name,
      nameKey: ingredientCatalog.nameKey,
      category: ingredientCatalog.category,
    })
    .from(ingredientCatalog)
    .where(
      or(
        isNull(ingredientCatalog.scopeId),
        eq(ingredientCatalog.scopeId, householdId),
      ),
    )

  const byKey = new Map<
    string,
    { name: string; category: string; isHousehold: boolean }
  >()
  for (const r of rows) {
    const isHousehold = r.scopeId != null
    const existing = byKey.get(r.nameKey)
    // Household rows win over stock rows of the same name.
    if (!existing || (isHousehold && !existing.isHousehold)) {
      byKey.set(r.nameKey, {
        name: r.name,
        category: normalizeCategory(r.category),
        isHousehold,
      })
    }
  }
  return byKey
})

/** Autocomplete: ingredients matching `query`, prefix matches ranked first. */
export const searchIngredients = createServerFn({ method: 'GET' })
  .validator((input: { query: string; limit?: number }) =>
    z
      .object({
        query: z.string().max(100),
        limit: z.number().int().min(1).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<IngredientSuggestion[]> => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    const q = nameKey(data.query)
    const limit = data.limit ?? 8

    const catalog = await catalogForScope(householdId)
    const all = [...catalog.entries()].map(([key, v]) => ({ key, ...v }))

    const matches = q
      ? all.filter((c) => c.key.includes(q))
      : all
    matches.sort((a, b) => {
      // Prefix matches first, then shorter names, then alphabetical.
      const ap = a.key.startsWith(q) ? 0 : 1
      const bp = b.key.startsWith(q) ? 0 : 1
      if (ap !== bp) return ap - bp
      return a.name.localeCompare(b.name, 'nb')
    })

    return matches
      .slice(0, limit)
      .map(({ name, category, isHousehold }) => ({ name, category, isHousehold }))
  })

/**
 * Save an ingredient to the household catalog (idempotent). Used when the user
 * types a name the autocomplete didn't find and chooses a category for it.
 * Updates the category if a household row already exists; leaves stock rows
 * untouched (a differing category becomes a household override). Server-only —
 * called from `addManualItem`, not exposed as its own endpoint.
 */
export const saveHouseholdIngredient = createServerOnlyFn(
  async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    householdId: string,
    name: string,
    category: string,
  ) => {
    const key = nameKey(name)
    if (!key) return
    const cat = normalizeCategory(category)

  const [existing] = await tx
    .select({ id: ingredientCatalog.id })
    .from(ingredientCatalog)
    .where(
      and(
        eq(ingredientCatalog.scopeId, householdId),
        eq(ingredientCatalog.nameKey, key),
      ),
    )
    .limit(1)

  if (existing) {
    await tx
      .update(ingredientCatalog)
      .set({ category: cat })
      .where(eq(ingredientCatalog.id, existing.id))
  } else {
    await tx.insert(ingredientCatalog).values({
      scopeId: householdId,
      name: name.trim(),
      nameKey: key,
      category: cat,
    })
  }
})

export { DEFAULT_CATEGORY }
