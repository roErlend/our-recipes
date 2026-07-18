import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { ingredientCatalog, ingredientCategory } from '@/db/schema'
import {
  categoryRank,
  DEFAULT_CATEGORY,
  guessIngredientCategory,
  INGREDIENT_CATEGORIES,
  isCanonicalCategory,
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
  /** A pantry staple the household (almost) always has — kept off the "to buy" list. */
  isStaple: boolean
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
      staple: ingredientCatalog.staple,
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
    { name: string; category: string; isHousehold: boolean; isStaple: boolean }
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
        isStaple: r.staple,
      })
    }
  }
  return byKey
})

/**
 * Persist a category as a first-class row so it survives independently of any
 * ingredient using it. No-op for canonical categories (they always exist).
 * Server-only; called whenever any ingredient is filed under a category.
 */
export const ensureCategoryRow = createServerOnlyFn(
  async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    name: string,
    scopeId: string | null = null,
  ) => {
    const trimmed = name.trim()
    if (!trimmed || isCanonicalCategory(trimmed)) return
    await tx
      .insert(ingredientCategory)
      .values({ name: trimmed, scopeId })
      .onConflictDoNothing()
  },
)

/**
 * Ensure a household-scoped category row exists for a category a household is
 * using — but only when it's genuinely household-specific. Skips canonical
 * categories and ones that already exist as a global (admin) row, so a household
 * only accrues rows for categories it actually invented. Server-only.
 */
export const ensureHouseholdCategoryRow = createServerOnlyFn(
  async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    name: string,
    householdId: string,
  ) => {
    const trimmed = name.trim()
    if (!trimmed || isCanonicalCategory(trimmed)) return
    const [globalRow] = await tx
      .select({ name: ingredientCategory.name })
      .from(ingredientCategory)
      .where(
        and(
          eq(ingredientCategory.name, trimmed),
          isNull(ingredientCategory.scopeId),
        ),
      )
      .limit(1)
    if (globalRow) return
    await tx
      .insert(ingredientCategory)
      .values({ name: trimmed, scopeId: householdId })
      .onConflictDoNothing()
  },
)

/**
 * All category names available app-wide: the canonical list ∪ first-class
 * categories ({@link ingredientCategory}) ∪ any category currently used by an
 * ingredient — so every category is first-class regardless of who created it.
 * Ordered the way the shopping list groups them.
 */
export const listCategories = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string[]> => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    // Categories visible to this household: canonical ∪ global (admin) + its own
    // category rows ∪ categories used by the catalog rows it can see (stock +
    // its own). Another household's private categories never appear here.
    const [named, used] = await Promise.all([
      db
        .select({ name: ingredientCategory.name })
        .from(ingredientCategory)
        .where(
          or(
            isNull(ingredientCategory.scopeId),
            eq(ingredientCategory.scopeId, householdId),
          ),
        ),
      db
        .selectDistinct({ category: ingredientCatalog.category })
        .from(ingredientCatalog)
        .where(
          or(
            isNull(ingredientCatalog.scopeId),
            eq(ingredientCatalog.scopeId, householdId),
          ),
        ),
    ])
    const set = new Set<string>(INGREDIENT_CATEGORIES)
    for (const r of named) set.add(r.name)
    for (const r of used) if (r.category) set.add(r.category)
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

  // Make the chosen category first-class for this household (if it's a new,
  // household-specific one — canonical/global categories are left alone).
  await ensureHouseholdCategoryRow(tx, cat, householdId)
})

/**
 * Ensure every given ingredient name exists in the catalog for this household,
 * creating a household-scoped row (with a {@link guessIngredientCategory}
 * category) for any that don't — stock and existing household rows are left
 * untouched. Used when saving a recipe so its ingredients (especially imported
 * ones) feed the shopping-list autocomplete and get a sensible category. Names
 * are deduped; blanks are skipped. Server-only; runs inside the caller's
 * transaction.
 */
export const ensureCatalogIngredients = createServerOnlyFn(
  async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    householdId: string,
    names: string[],
  ) => {
    const byKey = new Map<string, string>()
    for (const raw of names) {
      const name = raw.trim()
      const key = nameKey(name)
      if (key && !byKey.has(key)) byKey.set(key, name)
    }
    if (!byKey.size) return

    // Skip names already known to this household (its own rows or shared stock).
    const existing = await tx
      .select({ nameKey: ingredientCatalog.nameKey })
      .from(ingredientCatalog)
      .where(
        and(
          inArray(ingredientCatalog.nameKey, [...byKey.keys()]),
          or(
            isNull(ingredientCatalog.scopeId),
            eq(ingredientCatalog.scopeId, householdId),
          ),
        ),
      )
    const existingKeys = new Set(existing.map((r) => r.nameKey))

    const rows = [...byKey.entries()]
      .filter(([key]) => !existingKeys.has(key))
      .map(([key, name]) => ({
        scopeId: householdId,
        name,
        nameKey: key,
        category: guessIngredientCategory(name),
      }))
    if (!rows.length) return

    // onConflictDoNothing guards against a race on the household unique index.
    await tx.insert(ingredientCatalog).values(rows).onConflictDoNothing()
  },
)

/* ------------------ household catalog management (/ingredienser) ---------- */

export interface HouseholdCatalogRow {
  id: string
  name: string
  category: string
  staple: boolean
  /** 'stock' = a shared global template; 'household' = this household's own row. */
  origin: 'stock' | 'household'
}

/**
 * The catalog as a household manages it: one row per name, a household copy
 * shadowing a stock template, each tagged with its origin and the id to edit.
 */
export const listHouseholdCatalog = createServerFn({ method: 'GET' }).handler(
  async (): Promise<HouseholdCatalogRow[]> => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    const rows = await db
      .select({
        id: ingredientCatalog.id,
        scopeId: ingredientCatalog.scopeId,
        name: ingredientCatalog.name,
        nameKey: ingredientCatalog.nameKey,
        category: ingredientCatalog.category,
        staple: ingredientCatalog.staple,
      })
      .from(ingredientCatalog)
      .where(
        or(
          isNull(ingredientCatalog.scopeId),
          eq(ingredientCatalog.scopeId, householdId),
        ),
      )

    const byKey = new Map<string, HouseholdCatalogRow>()
    for (const r of rows) {
      const isHousehold = r.scopeId != null
      const existing = byKey.get(r.nameKey)
      // Household rows win over the stock template of the same name.
      if (!existing || (isHousehold && existing.origin === 'stock')) {
        byKey.set(r.nameKey, {
          id: r.id,
          name: r.name,
          category: normalizeCategory(r.category),
          staple: r.staple,
          origin: isHousehold ? 'household' : 'stock',
        })
      }
    }
    return [...byKey.values()].sort(
      (a, b) =>
        a.category.localeCompare(b.category, 'nb') ||
        a.name.localeCompare(b.name, 'nb'),
    )
  },
)

/**
 * Create or edit a household ingredient. Editing a **stock** template forks a
 * private household copy (copy-on-write) — the global row is never mutated;
 * editing an **own** row updates it in place (rename allowed). Pass `id: null`
 * to create a brand-new household ingredient.
 */
export const saveHouseholdCatalogItem = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().min(1).nullable().optional(),
        name: z.string().trim().min(1, 'Navn kreves').max(200),
        category: z.string().trim().min(1).max(60),
        staple: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    const category = normalizeCategory(data.category)

    await db.transaction(async (tx) => {
      let displayName = data.name.trim()
      let key = nameKey(displayName)

      if (data.id) {
        const [row] = await tx
          .select()
          .from(ingredientCatalog)
          .where(eq(ingredientCatalog.id, data.id))
          .limit(1)
        if (!row) throw new Error('Ingrediensen finnes ikke')

        if (row.scopeId === householdId) {
          // Editing our own row — update in place, rename allowed.
          if (key !== row.nameKey) {
            const [clash] = await tx
              .select({ id: ingredientCatalog.id })
              .from(ingredientCatalog)
              .where(
                and(
                  eq(ingredientCatalog.scopeId, householdId),
                  eq(ingredientCatalog.nameKey, key),
                  ne(ingredientCatalog.id, row.id),
                ),
              )
              .limit(1)
            if (clash) throw new Error('Ingrediensen finnes allerede')
          }
          await tx
            .update(ingredientCatalog)
            .set({
              name: displayName,
              nameKey: key,
              category,
              ...(data.staple === undefined ? {} : { staple: data.staple }),
            })
            .where(eq(ingredientCatalog.id, row.id))
          await ensureHouseholdCategoryRow(tx, category, householdId)
          return
        }

        if (row.scopeId != null) {
          // A row from another household — should be unreachable via the UI.
          throw new Error('Utilgjengelig ingrediens')
        }
        // Forking a stock template: keep its name/key, override category/staple.
        displayName = row.name
        key = row.nameKey
      }

      // Upsert the household row (new ingredient, or a fork of a stock template).
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
          .set({
            name: displayName,
            category,
            ...(data.staple === undefined ? {} : { staple: data.staple }),
          })
          .where(eq(ingredientCatalog.id, existing.id))
      } else {
        await tx.insert(ingredientCatalog).values({
          scopeId: householdId,
          name: displayName,
          nameKey: key,
          category,
          staple: data.staple ?? false,
        })
      }
      await ensureHouseholdCategoryRow(tx, category, householdId)
    })
    return { ok: true }
  })

/**
 * Delete a household's **own** catalog ingredient. Reverts to the stock template
 * if one exists (same name). Never touches stock or another household's rows —
 * the scope check guarantees a household can only remove what it created.
 */
export const deleteHouseholdCatalogItem = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({ id: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    const [row] = await db
      .select({ scopeId: ingredientCatalog.scopeId })
      .from(ingredientCatalog)
      .where(eq(ingredientCatalog.id, data.id))
      .limit(1)
    if (!row) throw new Error('Ingrediensen finnes ikke')
    if (row.scopeId !== householdId) {
      throw new Error('Du kan bare slette egne ingredienser')
    }
    await db.delete(ingredientCatalog).where(eq(ingredientCatalog.id, data.id))
    return { ok: true }
  })

export interface HouseholdCategoryRow {
  name: string
  /** 'global' = canonical/admin template (read-only here); 'household' = own. */
  origin: 'global' | 'household'
  /** How many of this household's own ingredients use it. */
  count: number
}

/**
 * Categories as a household manages them: canonical + global (admin) templates
 * (read-only) plus the household's own categories, each with a count of the
 * household's own ingredients using it.
 */
export const listHouseholdCategories = createServerFn({ method: 'GET' }).handler(
  async (): Promise<HouseholdCategoryRow[]> => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    const [catRows, householdItems] = await Promise.all([
      db
        .select({
          name: ingredientCategory.name,
          scopeId: ingredientCategory.scopeId,
        })
        .from(ingredientCategory)
        .where(
          or(
            isNull(ingredientCategory.scopeId),
            eq(ingredientCategory.scopeId, householdId),
          ),
        ),
      db
        .select({ category: ingredientCatalog.category })
        .from(ingredientCatalog)
        .where(eq(ingredientCatalog.scopeId, householdId)),
    ])

    const globalNames = new Set<string>(INGREDIENT_CATEGORIES)
    const householdNames = new Set<string>()
    for (const r of catRows) {
      if (r.scopeId == null) globalNames.add(r.name)
      else householdNames.add(r.name)
    }
    const counts = new Map<string, number>()
    for (const r of householdItems) {
      const c = normalizeCategory(r.category)
      counts.set(c, (counts.get(c) ?? 0) + 1)
      if (!globalNames.has(c)) householdNames.add(c)
    }

    const all = new Set<string>([...globalNames, ...householdNames])
    return [...all]
      .map((name) => ({
        name,
        origin: (globalNames.has(name) ? 'global' : 'household') as
          | 'global'
          | 'household',
        count: counts.get(name) ?? 0,
      }))
      .sort(
        (a, b) =>
          categoryRank(a.name) - categoryRank(b.name) ||
          a.name.localeCompare(b.name, 'nb'),
      )
  },
)

/** Create a household-scoped category (no-op for canonical/global names). */
export const createHouseholdCategory = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z.object({ name: z.string().trim().min(1).max(60) }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    await db.transaction(async (tx) => {
      await ensureHouseholdCategoryRow(tx, data.name, householdId)
    })
    return { name: data.name.trim() }
  })

/**
 * Rename one of the household's **own** categories: retags only this household's
 * ingredients and moves its own category row. Global/canonical categories are
 * templates and can't be renamed here.
 */
export const renameHouseholdCategory = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .object({
        from: z.string().trim().min(1),
        to: z.string().trim().min(1).max(60),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    const to = data.to.trim()
    if (isCanonicalCategory(data.from)) {
      throw new Error('Globale kategorier kan ikke endres')
    }
    await db.transaction(async (tx) => {
      const [globalRow] = await tx
        .select({ name: ingredientCategory.name })
        .from(ingredientCategory)
        .where(
          and(
            eq(ingredientCategory.name, data.from),
            isNull(ingredientCategory.scopeId),
          ),
        )
        .limit(1)
      if (globalRow) throw new Error('Globale kategorier kan ikke endres')

      await tx
        .update(ingredientCatalog)
        .set({ category: to })
        .where(
          and(
            eq(ingredientCatalog.scopeId, householdId),
            eq(ingredientCatalog.category, data.from),
          ),
        )
      await ensureHouseholdCategoryRow(tx, to, householdId)
      await tx
        .delete(ingredientCategory)
        .where(
          and(
            eq(ingredientCategory.name, data.from),
            eq(ingredientCategory.scopeId, householdId),
          ),
        )
    })
    return { from: data.from, to }
  })

/**
 * Delete one of the household's **own** categories: reassigns this household's
 * ingredients under it to the default and drops its category row. Global/
 * canonical categories can't be deleted here. No ingredient is deleted.
 */
export const deleteHouseholdCategory = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z.object({ name: z.string().trim().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    if (isCanonicalCategory(data.name)) {
      throw new Error('Globale kategorier kan ikke slettes')
    }
    await db.transaction(async (tx) => {
      const [globalRow] = await tx
        .select({ name: ingredientCategory.name })
        .from(ingredientCategory)
        .where(
          and(
            eq(ingredientCategory.name, data.name),
            isNull(ingredientCategory.scopeId),
          ),
        )
        .limit(1)
      if (globalRow) throw new Error('Globale kategorier kan ikke slettes')

      await tx
        .update(ingredientCatalog)
        .set({ category: DEFAULT_CATEGORY })
        .where(
          and(
            eq(ingredientCatalog.scopeId, householdId),
            eq(ingredientCatalog.category, data.name),
          ),
        )
      await tx
        .delete(ingredientCategory)
        .where(
          and(
            eq(ingredientCategory.name, data.name),
            eq(ingredientCategory.scopeId, householdId),
          ),
        )
    })
    return { name: data.name }
  })

export { DEFAULT_CATEGORY }
