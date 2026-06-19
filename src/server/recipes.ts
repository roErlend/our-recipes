import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  or,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import {
  ingredient,
  recipe,
  recipeImage,
  recipeRating,
  shoppingEntry,
  user as userTable,
} from '@/db/schema'
import { requireUser } from '@/server/auth'
import { accessibleScope } from '@/server/sharing'

/** Rating aggregates (sum + count) for a set of recipes, keyed by recipe id. */
const ratingAggregates = createServerOnlyFn(async (recipeIds: string[]) => {
  if (!recipeIds.length) return new Map<string, { sum: number; count: number }>()
  const rows = await db
    .select({
      recipeId: recipeRating.recipeId,
      sum: sql<number>`coalesce(sum(${recipeRating.score}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(recipeRating)
    .where(inArray(recipeRating.recipeId, recipeIds))
    .groupBy(recipeRating.recipeId)
  return new Map(
    rows.map((r) => [r.recipeId, { sum: Number(r.sum), count: Number(r.count) }]),
  )
})

/**
 * Recipe ids in the household that currently have items on the shopping list.
 * A recipe stays "on the list" (its toggle stays checked) until it's removed
 * manually — checking items off doesn't drop it; removing it takes its items
 * off the list.
 */
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
  /** A new uploaded image as a `data:image/…;base64,…` URL (already resized client-side). */
  imageUpload: z
    .string()
    .startsWith('data:image/')
    .max(10_000_000)
    .nullable()
    .optional(),
  /** Drop any stored uploaded image (set when the user removes it or switches to a URL). */
  clearUploadedImage: z.boolean().optional(),
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

    const ids = rows.map((r) => r.id)
    // Uploaded-image presence (id + updatedAt only — never the bytes) for
    // thumbnails, and rating aggregates for display + default ordering.
    const [imgRows, ratings] = await Promise.all([
      ids.length
        ? db
            .select({
              recipeId: recipeImage.recipeId,
              updatedAt: recipeImage.updatedAt,
            })
            .from(recipeImage)
            .where(inArray(recipeImage.recipeId, ids))
        : Promise.resolve([]),
      ratingAggregates(ids),
    ])
    const imgByRecipe = new Map(imgRows.map((i) => [i.recipeId, i.updatedAt]))

    const mapped = rows.map(({ ingredients, owner, ...r }) => {
      const imgUpdated = imgByRecipe.get(r.id)
      const agg = ratings.get(r.id)
      const ratingCount = agg?.count ?? 0
      return {
        ...r,
        ingredientCount: ingredients.length,
        isOwner: r.ownerId === user.id,
        ownerName: owner?.name || owner?.email || null,
        inShoppingList: onList.has(r.id),
        uploadedImageUrl: imgUpdated
          ? `/api/recipes/${r.id}/image?v=${imgUpdated.getTime()}`
          : null,
        ratingCount,
        ratingAvg: ratingCount ? (agg?.sum ?? 0) / ratingCount : 0,
      }
    })

    // Default ordering: highest average rating first, then most recently
    // updated (rows already arrive in updatedAt-desc order, so the sort is a
    // stable refinement). Unrated recipes (avg 0) fall to the bottom by recency.
    return mapped.sort(
      (a, b) =>
        b.ratingAvg - a.ratingAvg ||
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
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
    const [onList, [img], ratingRows] = await Promise.all([
      recipesOnShoppingList(householdId),
      db
        .select({ updatedAt: recipeImage.updatedAt })
        .from(recipeImage)
        .where(eq(recipeImage.recipeId, id))
        .limit(1),
      db
        .select({
          userId: recipeRating.userId,
          score: recipeRating.score,
          name: userTable.name,
          email: userTable.email,
        })
        .from(recipeRating)
        .innerJoin(userTable, eq(userTable.id, recipeRating.userId))
        .where(eq(recipeRating.recipeId, id))
        .orderBy(desc(recipeRating.score)),
    ])

    const ratings = ratingRows.map((r) => ({
      userId: r.userId,
      name: r.name || r.email,
      score: r.score,
      isMe: r.userId === user.id,
    }))
    const ratingCount = ratings.length
    const ratingTotal = ratings.reduce((s, r) => s + r.score, 0)

    const { owner, ...rest } = row
    return {
      ...rest,
      isOwner: row.ownerId === user.id,
      ownerName: owner?.name || owner?.email || null,
      inShoppingList: onList.has(row.id),
      // Internal URL for an uploaded image (cache-busted by its updated time),
      // or null when the recipe has no upload (it may still have an image_url).
      uploadedImageUrl: img
        ? `/api/recipes/${id}/image?v=${img.updatedAt.getTime()}`
        : null,
      ratings,
      ratingCount,
      ratingAvg: ratingCount ? ratingTotal / ratingCount : 0,
      myScore: ratings.find((r) => r.isMe)?.score ?? null,
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

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

/** Decode a `data:image/…;base64,…` URL into a content type + raw bytes. */
function parseImageDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl)
  if (!match) throw new Error('Ugyldig bildedata.')
  const contentType = match[1].toLowerCase()
  if (!contentType.startsWith('image/')) throw new Error('Filen må være et bilde.')
  const data = Buffer.from(match[2], 'base64')
  if (data.byteLength === 0) throw new Error('Bildet er tomt.')
  if (data.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('Bildet er for stort (maks 4 MB).')
  }
  return { contentType, data }
}

/** Apply an image change for a recipe within a transaction: store/replace an
 *  uploaded image, or clear a stored one. No-op when neither is requested. */
async function applyRecipeImage(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  recipeId: string,
  opts: { imageUpload?: string | null; clearUploadedImage?: boolean },
) {
  if (opts.imageUpload) {
    const { contentType, data } = parseImageDataUrl(opts.imageUpload)
    await tx
      .insert(recipeImage)
      .values({
        recipeId,
        contentType,
        data,
        byteSize: data.byteLength,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: recipeImage.recipeId,
        set: {
          contentType,
          data,
          byteSize: data.byteLength,
          updatedAt: new Date(),
        },
      })
  } else if (opts.clearUploadedImage) {
    await tx.delete(recipeImage).where(eq(recipeImage.recipeId, recipeId))
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
          ownerId: user.id,
        })
        .returning()
      if (data.ingredients.length) {
        await tx.insert(ingredient).values(ingredientRows(row.id, data.ingredients))
      }
      await applyRecipeImage(tx, row.id, data)
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
      await applyRecipeImage(tx, id, {
        imageUpload: fields.imageUpload,
        clearUploadedImage: fields.clearUploadedImage,
      })
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

/** Cast the current user's 1–10 vote on a recipe (upsert). */
export const setRecipeRating = createServerFn({ method: 'POST' })
  .validator((input: { recipeId: string; score: number }) =>
    z
      .object({
        recipeId: z.string().min(1),
        score: z.number().int().min(1).max(10),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    // Same access check as administering — only members who can see the recipe
    // may rate it.
    await assertCanAdminister(user.id, data.recipeId)
    await db
      .insert(recipeRating)
      .values({
        recipeId: data.recipeId,
        userId: user.id,
        score: data.score,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [recipeRating.recipeId, recipeRating.userId],
        set: { score: data.score, updatedAt: new Date() },
      })
    return { recipeId: data.recipeId, score: data.score }
  })

/** Remove the current user's vote on a recipe. */
export const removeRecipeRating = createServerFn({ method: 'POST' })
  .validator((input: { recipeId: string }) =>
    z.object({ recipeId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    await assertCanAdminister(user.id, data.recipeId)
    await db
      .delete(recipeRating)
      .where(
        and(
          eq(recipeRating.recipeId, data.recipeId),
          eq(recipeRating.userId, user.id),
        ),
      )
    return { recipeId: data.recipeId }
  })

export type RecipeListItem = Awaited<ReturnType<typeof listRecipes>>[number]
export type RecipeDetail = NonNullable<Awaited<ReturnType<typeof getRecipe>>>
