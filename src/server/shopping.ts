import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { recipe, shoppingCheck } from '@/db/schema'
import { requireUser } from '@/server/auth'

export interface ShoppingItem {
  key: string
  name: string
  unit: string | null
  /** Summed quantity across recipes, or null if none of the entries were quantified. */
  quantity: number | null
  /** True when at least one contributing entry had no numeric quantity (e.g. "to taste"). */
  hasUnquantified: boolean
  /** Titles of the active recipes that need this item. */
  sources: string[]
  checked: boolean
}

export interface ShoppingList {
  recipes: { id: string; title: string }[]
  items: ShoppingItem[]
}

function itemKey(name: string, unit: string | null) {
  return `${name.trim().toLowerCase()}__${(unit ?? '').trim().toLowerCase()}`
}

export const getShoppingList = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ShoppingList> => {
    await requireUser()

    const activeRecipes = await db.query.recipe.findMany({
      where: eq(recipe.isActive, true),
      columns: { id: true, title: true },
      with: { ingredients: true },
    })

    const checks = await db.select().from(shoppingCheck)
    const checkedByKey = new Map(checks.map((c) => [c.itemKey, c.checked]))

    const map = new Map<string, ShoppingItem>()
    for (const r of activeRecipes) {
      for (const ing of r.ingredients) {
        const key = itemKey(ing.name, ing.unit)
        const existing = map.get(key)
        if (existing) {
          if (ing.quantity != null) {
            existing.quantity = (existing.quantity ?? 0) + ing.quantity
          } else {
            existing.hasUnquantified = true
          }
          if (!existing.sources.includes(r.title)) existing.sources.push(r.title)
        } else {
          map.set(key, {
            key,
            name: ing.name.trim(),
            unit: ing.unit,
            quantity: ing.quantity ?? null,
            hasUnquantified: ing.quantity == null,
            sources: [r.title],
            checked: checkedByKey.get(key) ?? false,
          })
        }
      }
    }

    const items = [...map.values()].sort((a, b) => {
      if (a.checked !== b.checked) return a.checked ? 1 : -1
      return a.name.localeCompare(b.name)
    })

    return {
      recipes: activeRecipes.map((r) => ({ id: r.id, title: r.title })),
      items,
    }
  },
)

export const setShoppingChecked = createServerFn({ method: 'POST' })
  .validator((input: { key: string; checked: boolean }) =>
    z.object({ key: z.string().min(1), checked: z.boolean() }).parse(input),
  )
  .handler(async ({ data }) => {
    await requireUser()
    await db
      .insert(shoppingCheck)
      .values({ itemKey: data.key, checked: data.checked, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: shoppingCheck.itemKey,
        set: { checked: data.checked, updatedAt: new Date() },
      })
    return { key: data.key, checked: data.checked }
  })

export const clearShoppingChecks = createServerFn({ method: 'POST' }).handler(
  async () => {
    await requireUser()
    await db.delete(shoppingCheck)
    return { ok: true }
  },
)
