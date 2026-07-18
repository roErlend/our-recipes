import { createServerFn } from '@tanstack/react-start'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { ingredientCatalog, ingredientCategory } from '@/db/schema'
import {
  categoryRank,
  DEFAULT_CATEGORY,
  INGREDIENT_CATEGORIES,
  isCanonicalCategory,
  normalizeCategory,
} from '@/lib/categories'
import { requireAdmin } from '@/server/auth'
import { ensureCategoryRow, nameKey } from '@/server/ingredients'

/*
 * The admin page edits the **templates** only (scope_id NULL) — the starter set
 * copied into a household when it first uses the catalog, or when it resets on
 * /ingredienser. Households own their copies outright, so nothing here may read
 * or write household-scoped rows: template changes reach a household only
 * through a reset it asks for itself.
 */

export interface AdminIngredient {
  id: string
  name: string
  category: string
  /** Pantry staple — kept off the "to buy" shopping list. */
  staple: boolean
}

/** Every template ingredient, for curation. */
export const adminListIngredients = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminIngredient[]> => {
    await requireAdmin()
    const rows = await db
      .select()
      .from(ingredientCatalog)
      .where(isNull(ingredientCatalog.scopeId))
    return rows
      .map((r) => ({
        id: r.id,
        name: r.name,
        category: normalizeCategory(r.category),
        staple: r.staple,
      }))
      .sort(
        (a, b) =>
          a.category.localeCompare(b.category, 'nb') ||
          a.name.localeCompare(b.name, 'nb'),
      )
  },
)

/** Every template category name (canonical ∪ admin-created), ordered. */
export const adminListCategories = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string[]> => {
    await requireAdmin()
    const rows = await db
      .select({ name: ingredientCategory.name })
      .from(ingredientCategory)
      .where(isNull(ingredientCategory.scopeId))
    const set = new Set<string>(INGREDIENT_CATEGORIES)
    for (const r of rows) set.add(r.name)
    return [...set].sort(
      (a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b, 'nb'),
    )
  },
)

/** Create a new template ingredient. */
export const adminCreateIngredient = createServerFn({ method: 'POST' })
  .validator((input: { name: string; category: string }) =>
    z
      .object({
        name: z.string().trim().min(1, 'Navn kreves').max(200),
        category: z.string().trim().min(1).max(60),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    const name = data.name.trim()
    const key = nameKey(name)
    const category = normalizeCategory(data.category)

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: ingredientCatalog.id })
        .from(ingredientCatalog)
        .where(
          and(isNull(ingredientCatalog.scopeId), eq(ingredientCatalog.nameKey, key)),
        )
        .limit(1)
      if (existing) throw new Error('Ingrediensen finnes allerede')

      await tx
        .insert(ingredientCatalog)
        .values({ scopeId: null, name, nameKey: key, category })
      await ensureCategoryRow(tx, category)
    })
    return { name }
  })

/** Rename and/or recategorize a template ingredient, and set its staple flag. */
export const adminUpdateIngredient = createServerFn({ method: 'POST' })
  .validator(
    (input: { id: string; name: string; category: string; staple?: boolean }) =>
      z
        .object({
          id: z.string().min(1),
          name: z.string().trim().min(1, 'Navn kreves').max(200),
          category: z.string().trim().min(1).max(60),
          staple: z.boolean().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    const name = data.name.trim()
    const category = normalizeCategory(data.category)
    await db.transaction(async (tx) => {
      await tx
        .update(ingredientCatalog)
        .set({
          name,
          nameKey: nameKey(name),
          category,
          ...(data.staple === undefined ? {} : { staple: data.staple }),
        })
        .where(
          and(eq(ingredientCatalog.id, data.id), isNull(ingredientCatalog.scopeId)),
        )
      await ensureCategoryRow(tx, category)
    })
    return { id: data.id }
  })

/** Delete a template ingredient. */
export const adminDeleteIngredient = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) =>
    z.object({ id: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    await db
      .delete(ingredientCatalog)
      .where(
        and(eq(ingredientCatalog.id, data.id), isNull(ingredientCatalog.scopeId)),
      )
    return { id: data.id }
  })

/** Create a new (empty) template category that persists until deleted. */
export const adminCreateCategory = createServerFn({ method: 'POST' })
  .validator((input: { name: string }) =>
    z.object({ name: z.string().trim().min(1).max(60) }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    const name = data.name.trim()
    // Canonical categories are always part of the template set already.
    if (!isCanonicalCategory(name)) {
      await db
        .insert(ingredientCategory)
        .values({ name, scopeId: null })
        .onConflictDoNothing()
    }
    return { name }
  })

/** Rename a template category across every template ingredient using it. */
export const adminRenameCategory = createServerFn({ method: 'POST' })
  .validator((input: { from: string; to: string }) =>
    z
      .object({
        from: z.string().trim().min(1),
        to: z.string().trim().min(1).max(60),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    const to = data.to.trim()
    const count = await db.transaction(async (tx) => {
      const updated = await tx
        .update(ingredientCatalog)
        .set({ category: to })
        .where(
          and(
            isNull(ingredientCatalog.scopeId),
            eq(ingredientCatalog.category, data.from),
          ),
        )
        .returning({ id: ingredientCatalog.id })
      await tx
        .delete(ingredientCategory)
        .where(
          and(
            eq(ingredientCategory.name, data.from),
            isNull(ingredientCategory.scopeId),
          ),
        )
      await ensureCategoryRow(tx, to)
      return updated.length
    })
    return { from: data.from, to, count }
  })

/** Remove a template category: reassign its template ingredients to the default. */
export const adminDeleteCategory = createServerFn({ method: 'POST' })
  .validator((input: { category: string }) =>
    z.object({ category: z.string().trim().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    if (data.category === DEFAULT_CATEGORY) {
      throw new Error('Kan ikke slette standardkategorien')
    }
    const reassigned = await db.transaction(async (tx) => {
      const updated = await tx
        .update(ingredientCatalog)
        .set({ category: DEFAULT_CATEGORY })
        .where(
          and(
            isNull(ingredientCatalog.scopeId),
            eq(ingredientCatalog.category, data.category),
          ),
        )
        .returning({ id: ingredientCatalog.id })
      await tx
        .delete(ingredientCategory)
        .where(
          and(
            eq(ingredientCategory.name, data.category),
            isNull(ingredientCategory.scopeId),
          ),
        )
      return updated.length
    })
    return { category: data.category, reassigned }
  })
