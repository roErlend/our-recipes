import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { ingredient, recipe } from '@/db/schema'
import { requireUser } from '@/server/auth'

/* ----------------------------- validation ------------------------------ */

const ingredientInput = z.object({
  name: z.string().trim().min(1, 'Ingredient name is required'),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().trim().max(40).nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
})

const recipeInput = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  sourceUrl: z.string().trim().url('Must be a valid URL').nullable().optional(),
  imageUrl: z.string().trim().url().nullable().optional(),
  instructions: z.string().trim().max(20000).nullable().optional(),
  servings: z.number().int().positive().max(100).nullable().optional(),
  tags: z.array(z.string().trim().min(1)).max(30).default([]),
  ingredients: z.array(ingredientInput).max(100).default([]),
})

const emptyToNull = (v: string | null | undefined) =>
  v == null || v === '' ? null : v

/* ------------------------------- queries -------------------------------- */

export const listRecipes = createServerFn({ method: 'GET' })
  .validator(
    (input: { search?: string; activeOnly?: boolean } | undefined) =>
      input ?? {},
  )
  .handler(async ({ data }) => {
    await requireUser()
    const term = data.search?.trim()

    const conditions = []
    if (data.activeOnly) conditions.push(eq(recipe.isActive, true))
    if (term) {
      const like = `%${term}%`
      conditions.push(
        or(
          ilike(recipe.title, like),
          ilike(recipe.description, like),
          sql`EXISTS (SELECT 1 FROM unnest(${recipe.tags}) AS t WHERE t ILIKE ${like})`,
        ),
      )
    }

    const rows = await db.query.recipe.findMany({
      where: conditions.length ? and(...conditions) : undefined,
      orderBy: [desc(recipe.isActive), desc(recipe.updatedAt)],
      with: { ingredients: { columns: { id: true } } },
    })

    return rows.map(({ ingredients, ...r }) => ({
      ...r,
      ingredientCount: ingredients.length,
    }))
  })

export const getRecipe = createServerFn({ method: 'GET' })
  .validator((id: string) => z.string().min(1).parse(id))
  .handler(async ({ data: id }) => {
    await requireUser()
    const row = await db.query.recipe.findFirst({
      where: eq(recipe.id, id),
      with: {
        ingredients: {
          orderBy: (i, { asc }) => [asc(i.sortOrder)],
        },
      },
    })
    return row ?? null
  })

/* ------------------------------ mutations ------------------------------- */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function replaceIngredients(
  tx: Tx,
  recipeId: string,
  items: z.infer<typeof recipeInput>['ingredients'],
) {
  await tx.delete(ingredient).where(eq(ingredient.recipeId, recipeId))
  if (items.length) {
    await tx.insert(ingredient).values(
      items.map((item, index) => ({
        recipeId,
        name: item.name,
        quantity: item.quantity ?? null,
        unit: emptyToNull(item.unit ?? null),
        note: emptyToNull(item.note ?? null),
        sortOrder: index,
      })),
    )
  }
}

export const createRecipe = createServerFn({ method: 'POST' })
  .validator((input: unknown) => recipeInput.parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser()

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(recipe)
        .values({
          title: data.title,
          description: emptyToNull(data.description ?? null),
          sourceUrl: emptyToNull(data.sourceUrl ?? null),
          imageUrl: emptyToNull(data.imageUrl ?? null),
          instructions: emptyToNull(data.instructions ?? null),
          servings: data.servings ?? null,
          tags: data.tags,
          createdBy: user.id,
        })
        .returning()
      await replaceIngredients(tx, row.id, data.ingredients)
      return row
    })

    return created
  })

export const updateRecipe = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    recipeInput.extend({ id: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireUser()
    const { id, ingredients, ...fields } = data

    await db.transaction(async (tx) => {
      await tx
        .update(recipe)
        .set({
          title: fields.title,
          description: emptyToNull(fields.description ?? null),
          sourceUrl: emptyToNull(fields.sourceUrl ?? null),
          imageUrl: emptyToNull(fields.imageUrl ?? null),
          instructions: emptyToNull(fields.instructions ?? null),
          servings: fields.servings ?? null,
          tags: fields.tags,
          updatedAt: new Date(),
        })
        .where(eq(recipe.id, id))
      await replaceIngredients(tx, id, ingredients)
    })

    return { id }
  })

export const setRecipeActive = createServerFn({ method: 'POST' })
  .validator((input: { id: string; isActive: boolean }) =>
    z.object({ id: z.string().min(1), isActive: z.boolean() }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireUser()
    await db
      .update(recipe)
      .set({ isActive: data.isActive, updatedAt: new Date() })
      .where(eq(recipe.id, data.id))
    return { id: data.id, isActive: data.isActive }
  })

export const deleteRecipe = createServerFn({ method: 'POST' })
  .validator((id: string) => z.string().min(1).parse(id))
  .handler(async ({ data: id }) => {
    await requireUser()
    await db.delete(recipe).where(eq(recipe.id, id))
    return { id }
  })

export type RecipeListItem = Awaited<ReturnType<typeof listRecipes>>[number]
export type RecipeDetail = NonNullable<Awaited<ReturnType<typeof getRecipe>>>
