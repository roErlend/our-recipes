import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { and, eq, isNull, or } from 'drizzle-orm'

import { db } from '@/db'
import { ingredientCatalog, ingredientCategory } from '@/db/schema'
import {
  categoryRank,
  DEFAULT_CATEGORY,
  INGREDIENT_CATEGORIES,
  normalizeCategory,
} from '@/lib/categories'
import { requireUser } from '@/server/auth'
import { accessibleScope } from '@/server/sharing'

export interface CatalogIngredient {
  name: string
  /** Lower-cased lookup key, used for client-side filtering/ranking. */
  key: string
  category: string
  /** True for the household's own saved ingredients (vs. shared stock). */
  isHousehold: boolean
}

/** Lower-cased lookup/dedup key for an ingredient name. */
export function nameKey(name: string) {
  return name.trim().toLowerCase()
}

/**
 * Pure, client-safe autocomplete ranking over a preloaded catalog: prefix
 * matches first, then shorter names, then alphabetical. The whole catalog is
 * small, so filtering happens on the client (no per-keystroke round-trip).
 */
export function filterIngredients(
  all: CatalogIngredient[],
  query: string,
  limit = 8,
): CatalogIngredient[] {
  const q = nameKey(query)
  const matches = q ? all.filter((c) => c.key.includes(q)) : all
  return [...matches]
    .sort((a, b) => {
      const ap = a.key.startsWith(q) ? 0 : 1
      const bp = b.key.startsWith(q) ? 0 : 1
      if (ap !== bp) return ap - bp
      return a.name.localeCompare(b.name, 'nb')
    })
    .slice(0, limit)
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

/**
 * All category names available app-wide: the canonical list ∪ admin-created
 * categories ({@link ingredientCategory}), ordered the way the shopping list
 * groups them. Used to populate category pickers; callers may additionally fold
 * in categories found on their own ingredient rows.
 */
export const listCategories = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string[]> => {
    await requireUser()
    const rows = await db
      .select({ name: ingredientCategory.name })
      .from(ingredientCategory)
    const set = new Set<string>(INGREDIENT_CATEGORIES)
    for (const r of rows) set.add(r.name)
    return [...set].sort(
      (a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b, 'nb'),
    )
  },
)

/**
 * The full ingredient catalog visible to the current household (stock +
 * household), for the add-box autocomplete. Preloaded and cached via TanStack
 * Query, then filtered client-side with {@link filterIngredients}.
 */
export const listIngredients = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CatalogIngredient[]> => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)

    const catalog = await catalogForScope(householdId)
    return [...catalog.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
  },
)

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
