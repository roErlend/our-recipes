import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { ingredientCatalog } from '@/db/schema'
import { DEFAULT_CATEGORY, normalizeCategory } from '@/lib/categories'
import { requireAdmin } from '@/server/auth'
import { nameKey } from '@/server/ingredients'

export interface AdminIngredient {
  id: string
  name: string
  category: string
  /** True for shared stock (scope_id NULL); false for a household-owned row. */
  isStock: boolean
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
    await db
      .update(ingredientCatalog)
      .set({
        name,
        nameKey: nameKey(name),
        category: normalizeCategory(data.category),
      })
      .where(eq(ingredientCatalog.id, data.id))
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

/** Rename a category across every ingredient that uses it. */
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
    const updated = await db
      .update(ingredientCatalog)
      .set({ category: to })
      .where(eq(ingredientCatalog.category, data.from))
      .returning({ id: ingredientCatalog.id })
    return { from: data.from, to, count: updated.length }
  })

/** Remove a category by reassigning its ingredients to the default ("Annet"). */
export const adminDeleteCategory = createServerFn({ method: 'POST' })
  .validator((input: { category: string }) =>
    z.object({ category: z.string().trim().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    if (data.category === DEFAULT_CATEGORY) {
      throw new Error('Kan ikke slette standardkategorien')
    }
    const updated = await db
      .update(ingredientCatalog)
      .set({ category: DEFAULT_CATEGORY })
      .where(eq(ingredientCatalog.category, data.category))
      .returning({ id: ingredientCatalog.id })
    return { category: data.category, reassigned: updated.length }
  })
