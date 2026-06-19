import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { and, desc, eq, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { ingredient, recipe, shoppingEntry } from '@/db/schema'
import { requireUser } from '@/server/auth'
import { accessibleScope } from '@/server/sharing'

/** Recipe ids in the household that currently have items on the shopping list. */
const recipesOnShoppingList = createServerOnlyFn(async (householdId: string) => {
  const rows = await db
    .selectDistinct({ id: shoppingEntry.sourceRecipeId })
    .from(shoppingEntry)
    .where(
      and(
        eq(shoppingEntry.scopeId, householdId),
        isNotNull(shoppingEntry.sourceRecipeId),
      ),
    )
  return new Set(rows.map((r) => r.id))
})

/* ----------------------------- validation ------------------------------ */

const ingredientInput = z.object({
  name: z.string().trim().min(1, 'Ingrediensnavn er påkrevd'),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().trim().max(40).nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
})

const recipeInput = z.object({
  title: z.string().trim().min(1, 'Tittel er påkrevd').max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  sourceUrl: z
    .string()
    .trim()
    .url('Må være en gyldig URL')
    .nullable()
    .optional(),
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
  .validator((input: { search?: string } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId, ownerIds } = await accessibleScope(user.id)
    const term = data.search?.trim()

    const conditions = [inArray(recipe.ownerId, ownerIds)]
    if (term) {
      const like = `%${term}%`
      conditions.push(
        or(
          ilike(recipe.title, like),
          ilike(recipe.description, like),
          sql`EXISTS (SELECT 1 FROM unnest(${recipe.tags}) AS t WHERE t ILIKE ${like})`,
        )!,
      )
    }

    const [rows, onList] = await Promise.all([
      db.query.recipe.findMany({
        where: and(...conditions),
        orderBy: [desc(recipe.updatedAt)],
        with: {
          ingredients: { columns: { id: true } },
          owner: { columns: { name: true, email: true } },
        },
      }),
      recipesOnShoppingList(householdId),
    ])

    return rows.map(({ ingredients, owner, ...r }) => ({
      ...r,
      ingredientCount: ingredients.length,
      isOwner: r.ownerId === user.id,
      ownerName: owner?.name || owner?.email || null,
      inShoppingList: onList.has(r.id),
    }))
  })

export const getRecipe = createServerFn({ method: 'GET' })
  .validator((id: string) => z.string().min(1).parse(id))
  .handler(async ({ data: id }) => {
    const user = await requireUser()
    const { householdId, ownerIds } = await accessibleScope(user.id)
    const row = await db.query.recipe.findFirst({
      where: eq(recipe.id, id),
      with: {
        ingredients: {
          orderBy: (i, { asc }) => [asc(i.sortOrder)],
        },
        owner: { columns: { name: true, email: true } },
      },
    })
    if (!row || !ownerIds.includes(row.ownerId)) return null
    const onList = await recipesOnShoppingList(householdId)
    const { owner, ...rest } = row
    return {
      ...rest,
      isOwner: row.ownerId === user.id,
      ownerName: owner?.name || owner?.email || null,
      inShoppingList: onList.has(row.id),
    }
  })

/** Throws unless the user may administer the given recipe (own household). */
const assertCanAdminister = createServerOnlyFn(
  async (userId: string, recipeId: string) => {
    const { ownerIds } = await accessibleScope(userId)
    const [row] = await db
      .select({ ownerId: recipe.ownerId })
      .from(recipe)
      .where(eq(recipe.id, recipeId))
      .limit(1)
    if (!row || !ownerIds.includes(row.ownerId)) {
      throw new Error('FORBIDDEN')
    }
  },
)

/* ------------------------------ mutations ------------------------------- */

type IngredientInputs = z.infer<typeof recipeInput>['ingredients']

function ingredientRows(recipeId: string, items: IngredientInputs) {
  return items.map((item, index) => ({
    recipeId,
    name: item.name,
    quantity: item.quantity ?? null,
    unit: emptyToNull(item.unit ?? null),
    note: emptyToNull(item.note ?? null),
    sortOrder: index,
  }))
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
          ownerId: user.id,
        })
        .returning()
      if (data.ingredients.length) {
        await tx.insert(ingredient).values(ingredientRows(row.id, data.ingredients))
      }
      return row
    })

    return created
  })

export const updateRecipe = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    recipeInput.extend({ id: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { id, ingredients, ...fields } = data
    await assertCanAdminister(user.id, id)

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
      await tx.delete(ingredient).where(eq(ingredient.recipeId, id))
      if (ingredients.length) {
        await tx.insert(ingredient).values(ingredientRows(id, ingredients))
      }
    })

    return { id }
  })

export const deleteRecipe = createServerFn({ method: 'POST' })
  .validator((id: string) => z.string().min(1).parse(id))
  .handler(async ({ data: id }) => {
    const user = await requireUser()
    await assertCanAdminister(user.id, id)
    await db.delete(recipe).where(eq(recipe.id, id))
    return { id }
  })

export type RecipeListItem = Awaited<ReturnType<typeof listRecipes>>[number]
export type RecipeDetail = NonNullable<Awaited<ReturnType<typeof getRecipe>>>
