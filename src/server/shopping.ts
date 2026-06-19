import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { recipe, shoppingCheck, shoppingEntry } from '@/db/schema'
import type { NewShoppingEntry } from '@/db/schema'
import { requireUser } from '@/server/auth'
import { accessibleScope } from '@/server/sharing'

export interface ShoppingItem {
  key: string
  name: string
  unit: string | null
  /** Summed quantity across contributions, or null if none of them were quantified. */
  quantity: number | null
  /** True when at least one contributing entry had no numeric quantity (e.g. "to taste"). */
  hasUnquantified: boolean
  /** Titles of the recipes that contributed this item (empty for ad-hoc items). */
  sources: string[]
  checked: boolean
}

export interface ShoppingList {
  /** Recipes currently contributing items to the list. */
  recipes: { id: string; title: string }[]
  items: ShoppingItem[]
  /**
   * The household scope id these checks belong to. The client needs it to build
   * optimistic rows for the realtime `shopping_check` collection (Electric).
   */
  scopeId: string
}

/** Normalized grouping key for a shopping line. Mirrored by `shopping_entry.item_key`. */
function itemKey(name: string, unit: string | null) {
  return `${name.trim().toLowerCase()}__${(unit ?? '').trim().toLowerCase()}`
}

const emptyToNull = (v: string | null | undefined) =>
  v == null || v.trim() === '' ? null : v.trim()

/**
 * Postgres's current transaction id, read INSIDE a write transaction. Electric
 * surfaces this xid in the shape log, which lets TanStack DB match the synced
 * change to its optimistic mutation and reconcile. See
 * https://electric-sql.com/docs/guides/writes
 */
const TXID_SQL = sql`SELECT pg_current_xact_id()::xid::text AS txid`

/**
 * Drop any "ticked off" rows whose item no longer exists on the list, so a
 * re-added item never comes back pre-checked. Electric streams these deletions
 * to every member's check collection. Runs inside the caller's transaction.
 */
async function deleteOrphanChecks(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  scopeId: string,
) {
  await tx.execute(sql`
    DELETE FROM shopping_check sc
    WHERE sc.user_id = ${scopeId}
      AND NOT EXISTS (
        SELECT 1 FROM shopping_entry se
        WHERE se.scope_id = sc.user_id AND se.item_key = sc.item_key
      )
  `)
}

export const getShoppingList = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ShoppingList> => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)

    const entries = await db
      .select()
      .from(shoppingEntry)
      .where(eq(shoppingEntry.scopeId, householdId))

    const checks = await db
      .select()
      .from(shoppingCheck)
      .where(eq(shoppingCheck.scopeId, householdId))
    const checkedByKey = new Map(checks.map((c) => [c.itemKey, c.checked]))

    const map = new Map<string, ShoppingItem>()
    const recipes = new Map<string, string>() // id -> title

    for (const e of entries) {
      if (e.sourceRecipeId && e.sourceTitle) recipes.set(e.sourceRecipeId, e.sourceTitle)
      const existing = map.get(e.itemKey)
      if (existing) {
        if (e.quantity != null) {
          existing.quantity = (existing.quantity ?? 0) + e.quantity
        } else {
          existing.hasUnquantified = true
        }
        if (e.sourceTitle && !existing.sources.includes(e.sourceTitle)) {
          existing.sources.push(e.sourceTitle)
        }
      } else {
        map.set(e.itemKey, {
          key: e.itemKey,
          name: e.name.trim(),
          unit: e.unit,
          quantity: e.quantity ?? null,
          hasUnquantified: e.quantity == null,
          sources: e.sourceTitle ? [e.sourceTitle] : [],
          checked: checkedByKey.get(e.itemKey) ?? false,
        })
      }
    }

    const items = [...map.values()].sort((a, b) => {
      if (a.checked !== b.checked) return a.checked ? 1 : -1
      return a.name.localeCompare(b.name)
    })

    return {
      recipes: [...recipes].map(([id, title]) => ({ id, title })),
      items,
      scopeId: householdId,
    }
  },
)

/* ----------------------------- mutations -------------------------------- */

/** Add every ingredient of a recipe to the list. Idempotent: re-adding replaces
 *  that recipe's previous contributions (so it tracks the recipe's current content). */
export const addRecipeToShopping = createServerFn({ method: 'POST' })
  .validator((input: { recipeId: string }) =>
    z.object({ recipeId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId, ownerIds } = await accessibleScope(user.id)

    const r = await db.query.recipe.findFirst({
      where: eq(recipe.id, data.recipeId),
      with: { ingredients: true },
    })
    if (!r || !ownerIds.includes(r.ownerId)) throw new Error('FORBIDDEN')

    // Merge this recipe's own duplicate ingredients (e.g. garlic twice) into one
    // entry per item key before inserting.
    const byKey = new Map<string, NewShoppingEntry>()
    for (const ing of r.ingredients) {
      const key = itemKey(ing.name, ing.unit)
      const existing = byKey.get(key)
      if (existing) {
        if (ing.quantity != null) {
          existing.quantity = (existing.quantity ?? 0) + ing.quantity
        }
      } else {
        byKey.set(key, {
          scopeId: householdId,
          itemKey: key,
          name: ing.name.trim(),
          quantity: ing.quantity ?? null,
          unit: emptyToNull(ing.unit),
          note: emptyToNull(ing.note),
          sourceRecipeId: r.id,
          sourceTitle: r.title,
        })
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(shoppingEntry)
        .where(
          and(
            eq(shoppingEntry.scopeId, householdId),
            eq(shoppingEntry.sourceRecipeId, r.id),
          ),
        )
      const rows = [...byKey.values()]
      if (rows.length) await tx.insert(shoppingEntry).values(rows)
    })

    return { recipeId: r.id, added: byKey.size }
  })

/** Remove a recipe's contributions from the list (its items, possibly merged
 *  with others, lose this recipe's share). */
export const removeRecipeFromShopping = createServerFn({ method: 'POST' })
  .validator((input: { recipeId: string }) =>
    z.object({ recipeId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)

    await db.transaction(async (tx) => {
      await tx
        .delete(shoppingEntry)
        .where(
          and(
            eq(shoppingEntry.scopeId, householdId),
            eq(shoppingEntry.sourceRecipeId, data.recipeId),
          ),
        )
      await deleteOrphanChecks(tx, householdId)
    })

    return { recipeId: data.recipeId }
  })

/** Add a one-off item typed by the user (not tied to any recipe). */
export const addManualItem = createServerFn({ method: 'POST' })
  .validator((input: { name: string; quantity?: number | null; unit?: string | null }) =>
    z
      .object({
        name: z.string().trim().min(1, 'Skriv inn en vare').max(200),
        quantity: z.number().positive().nullable().optional(),
        unit: z.string().trim().max(40).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    const name = data.name.trim()
    const unit = emptyToNull(data.unit)
    const key = itemKey(name, unit)

    await db.transaction(async (tx) => {
      // Fold repeated manual adds of the same item into the existing ad-hoc row.
      const [existing] = await tx
        .select()
        .from(shoppingEntry)
        .where(
          and(
            eq(shoppingEntry.scopeId, householdId),
            eq(shoppingEntry.itemKey, key),
            isNull(shoppingEntry.sourceRecipeId),
          ),
        )
        .limit(1)

      if (existing) {
        const quantity =
          data.quantity != null
            ? (existing.quantity ?? 0) + data.quantity
            : existing.quantity
        await tx
          .update(shoppingEntry)
          .set({ quantity, updatedAt: new Date() })
          .where(eq(shoppingEntry.id, existing.id))
      } else {
        await tx.insert(shoppingEntry).values({
          scopeId: householdId,
          itemKey: key,
          name,
          quantity: data.quantity ?? null,
          unit,
          note: null,
          sourceRecipeId: null,
          sourceTitle: null,
        })
      }
    })

    return { key }
  })

/** Remove a single line (all contributions to it) plus its checked state. */
export const removeShoppingItem = createServerFn({ method: 'POST' })
  .validator((input: { key: string }) =>
    z.object({ key: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)

    await db.transaction(async (tx) => {
      await tx
        .delete(shoppingEntry)
        .where(
          and(
            eq(shoppingEntry.scopeId, householdId),
            eq(shoppingEntry.itemKey, data.key),
          ),
        )
      await tx
        .delete(shoppingCheck)
        .where(
          and(
            eq(shoppingCheck.scopeId, householdId),
            eq(shoppingCheck.itemKey, data.key),
          ),
        )
    })

    return { key: data.key }
  })

/** Remove all currently ticked-off items from the list ("Fjern avhukede"). */
export const removeCheckedItems = createServerFn({ method: 'POST' }).handler(
  async () => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)

    const removed = await db.transaction(async (tx) => {
      const checkedRows = await tx
        .select({ itemKey: shoppingCheck.itemKey })
        .from(shoppingCheck)
        .where(
          and(
            eq(shoppingCheck.scopeId, householdId),
            eq(shoppingCheck.checked, true),
          ),
        )
      const keys = checkedRows.map((c) => c.itemKey)
      if (!keys.length) return 0

      await tx
        .delete(shoppingEntry)
        .where(
          and(
            eq(shoppingEntry.scopeId, householdId),
            inArray(shoppingEntry.itemKey, keys),
          ),
        )
      await tx
        .delete(shoppingCheck)
        .where(
          and(
            eq(shoppingCheck.scopeId, householdId),
            inArray(shoppingCheck.itemKey, keys),
          ),
        )
      return keys.length
    })

    return { removed }
  },
)

/* ----------------------- realtime check toggles ------------------------- */
/* Per-item "ticked off" state syncs live across devices via Electric; these
 * server fns are what the TanStack DB collection writes through. */

export const setShoppingChecked = createServerFn({ method: 'POST' })
  .validator((input: { key: string; checked: boolean }) =>
    z.object({ key: z.string().min(1), checked: z.boolean() }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    const txid = await db.transaction(async (tx) => {
      const [{ txid }] = await tx.execute(TXID_SQL)
      await tx
        .insert(shoppingCheck)
        .values({
          scopeId: householdId,
          itemKey: data.key,
          checked: data.checked,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [shoppingCheck.scopeId, shoppingCheck.itemKey],
          set: { checked: data.checked, updatedAt: new Date() },
        })
      return Number(txid)
    })
    return { key: data.key, checked: data.checked, txid }
  })

export const clearShoppingChecks = createServerFn({ method: 'POST' }).handler(
  async () => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    const txid = await db.transaction(async (tx) => {
      const [{ txid }] = await tx.execute(TXID_SQL)
      await tx.delete(shoppingCheck).where(eq(shoppingCheck.scopeId, householdId))
      return Number(txid)
    })
    return { ok: true, txid }
  },
)
