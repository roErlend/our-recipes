import { createServerFn } from '@tanstack/react-start'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { ingredientCatalog, ingredientCategory } from '@/db/schema'
import {
  DEFAULT_CATEGORY,
  INGREDIENT_CATEGORIES,
  normalizeCategory,
} from '@/lib/categories'
import { requireAdmin } from '@/server/auth'
import { nameKey } from '@/server/ingredients'

export interface AdminIngredient {
  id: string
  name: string
  category: string
  /** True for shared stock (scope_id NULL); false for a household-owned row. */
  isStock: boolean
}

const isCanonical = (name: string) =>
  (INGREDIENT_CATEGORIES as readonly string[]).includes(name)

/** Persist a non-canonical category so it survives even with no ingredients. */
async function ensureCategoryRow(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  name: string,
) {
  if (!name || isCanonical(name)) return
  await tx.insert(ingredientCategory).values({ name }).onConflictDoNothing()
}

/** Every ingredient in the catalog (stock + all households), for cleanup. */
export const adminListIngredients = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminIngredient[]> => {
    await requireAdmin()
    const rows = await db.select().from(ingredientCatalog)
    return rows
      .map((r) => ({
        id: r.id,
        name: r.name,
        category: normalizeCategory(r.category),
        isStock: r.scopeId == null,
      }))
      .sort(
        (a, b) =>
          a.category.localeCompare(b.category, 'nb') ||
          a.name.localeCompare(b.name, 'nb'),
      )
  },
)

/** Create a new shared (stock) ingredient. */
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

/** Rename and/or recategorize a single catalog ingredient. */
export const adminUpdateIngredient = createServerFn({ method: 'POST' })
  .validator((input: { id: string; name: string; category: string }) =>
    z
      .object({
        id: z.string().min(1),
        name: z.string().trim().min(1, 'Navn kreves').max(200),
        category: z.string().trim().min(1).max(60),
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
        .set({ name, nameKey: nameKey(name), category })
        .where(eq(ingredientCatalog.id, data.id))
      await ensureCategoryRow(tx, category)
    })
    return { id: data.id }
  })

/** Delete a single catalog ingredient. */
export const adminDeleteIngredient = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) =>
    z.object({ id: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    await db.delete(ingredientCatalog).where(eq(ingredientCatalog.id, data.id))
    return { id: data.id }
  })

/** Create a new (empty) category that persists until deleted. */
export const adminCreateCategory = createServerFn({ method: 'POST' })
  .validator((input: { name: string }) =>
    z.object({ name: z.string().trim().min(1).max(60) }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    const name = data.name.trim()
    // Canonical categories already exist implicitly; nothing to persist.
    if (!isCanonical(name)) {
      await db.insert(ingredientCategory).values({ name }).onConflictDoNothing()
    }
    return { name }
  })

/** Rename a category across every ingredient that uses it (and the category row). */
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
        .where(eq(ingredientCatalog.category, data.from))
        .returning({ id: ingredientCatalog.id })
      await tx.delete(ingredientCategory).where(eq(ingredientCategory.name, data.from))
      await ensureCategoryRow(tx, to)
      return updated.length
    })
    return { from: data.from, to, count }
  })

/** Remove a category: reassign its ingredients to the default and drop the row. */
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
        .where(eq(ingredientCatalog.category, data.category))
        .returning({ id: ingredientCatalog.id })
      await tx
        .delete(ingredientCategory)
        .where(eq(ingredientCategory.name, data.category))
      return updated.length
    })
    return { category: data.category, reassigned }
  })
