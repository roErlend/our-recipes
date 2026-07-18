import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { recipe, shoppingCheck, shoppingEntry } from '@/db/schema'
import type { NewShoppingEntry } from '@/db/schema'
import { DEFAULT_CATEGORY } from '@/lib/categories'
import {
  aggregateShoppingEntries,
  shoppingItemKey,
} from '@/lib/shopping-aggregate'
import type { ShoppingList } from '@/lib/shopping-aggregate'
import { requireUser } from '@/server/auth'
import {
  catalogForScope,
  ensureCatalogIngredients,
  nameKey,
  saveHouseholdIngredient,
} from '@/server/ingredients'
import { accessibleScope } from '@/server/sharing'

// The list shape and aggregation live in a client-safe lib so the realtime view
// can fold the Electric-synced entries exactly the way the server does.
export type { ShoppingItem, ShoppingList } from '@/lib/shopping-aggregate'

/** Normalized grouping key for a shopping line. Mirrored by `shopping_entry.item_key`. */
const itemKey = shoppingItemKey

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
    // When each line was last checked, for "most-recently-checked first" order.
    const checkedAtByKey = new Map(
      checks
        .filter((c) => c.checked)
        .map((c) => [c.itemKey, c.updatedAt.getTime()]),
    )
    // Manual per-line quantity overrides (see shopping_check.override_quantity).
    const overrideByKey = new Map(
      checks
        .filter((c) => c.overrideQuantity != null)
        .map((c) => [c.itemKey, c.overrideQuantity as number]),
    )

    // Categories are resolved by ingredient name (read-time), so recipe-derived
    // items get categorized too as soon as the name is in the catalog.
    const catalog = await catalogForScope(householdId)

    const { recipes, items } = aggregateShoppingEntries(entries, {
      resolveCategory: (name) =>
        catalog.get(nameKey(name))?.category ?? DEFAULT_CATEGORY,
      isStaple: (name) => catalog.get(nameKey(name))?.isStaple ?? false,
      isChecked: (key) => checkedByKey.get(key) ?? false,
      checkedAt: (key) => checkedAtByKey.get(key) ?? null,
    })

    // Attach manual overrides as a separate field (the displayed amount is
    // `overrideQuantity ?? quantity`). `quantity` keeps the computed sum so the
    // client can revert a cleared override without a round-trip. Entries are
    // left intact, so recipe linkage / "on the list" status are unaffected.
    for (const item of items) {
      const override = overrideByKey.get(item.key)
      if (override != null) item.overrideQuantity = override
    }

    return { recipes, items, scopeId: householdId }
  },
)

/* ----------------------------- mutations -------------------------------- */

/** Add a recipe's ingredients to the list. Idempotent: re-adding replaces that
 *  recipe's previous contributions (so it tracks the recipe's current content).
 *  When `itemKeys` is given, only those lines are added — letting the caller
 *  exclude ingredients they already have; omit/`null` adds every ingredient.
 *  Quantity scaling, in order of precedence: an explicit `scale` factor (the
 *  detail page's current scaling, incl. anchored-ingredient scaling); else
 *  `servings / recipe.servings` when both are known (cook for 4 from a recipe
 *  of 2 → ×2); else the recipe's own servings override (so a quick add from the
 *  overview matches how the recipe displays); else 1:1. Unquantified
 *  ingredients ("salt etter smak") are left as-is. */
export const addRecipeToShopping = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      recipeId: string
      itemKeys?: string[] | null
      servings?: number | null
      scale?: number | null
    }) =>
      z
        .object({
          recipeId: z.string().min(1),
          itemKeys: z.array(z.string().min(1)).nullable().optional(),
          servings: z.number().positive().max(100).nullable().optional(),
          scale: z.number().positive().max(100).nullable().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId, ownerIds } = await accessibleScope(user.id)

    const r = await db.query.recipe.findFirst({
      where: eq(recipe.id, data.recipeId),
      with: { ingredients: true },
    })
    if (!r || !ownerIds.includes(r.ownerId)) throw new Error('FORBIDDEN')

    const hasBase = r.servings != null && r.servings > 0
    const factor =
      data.scale != null
        ? data.scale
        : data.servings != null && hasBase
          ? data.servings / r.servings!
          : r.servingsOverride != null && hasBase
            ? r.servingsOverride / r.servings!
            : 1
    const scale = (q: number) => Math.round(q * factor * 100) / 100

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

    // Restrict to the chosen lines when a selection is given (the picker passes
    // the item keys to keep); no selection means the whole recipe. Quantities
    // are scaled last, once per merged line, to avoid compounding rounding.
    const selected = data.itemKeys ? new Set(data.itemKeys) : null
    const rows = [...byKey.values()]
      .filter((row) => !selected || selected.has(row.itemKey))
      .map((row) =>
        factor !== 1 && row.quantity != null
          ? { ...row, quantity: scale(row.quantity) }
          : row,
      )

    await db.transaction(async (tx) => {
      // Make sure every ingredient this recipe uses is a first-class catalog
      // entry (with a guessed category), so recipe-derived list items are
      // categorized instead of falling back to "Annet" and can be re-filed from
      // the admin page. Covers recipes created before catalog-on-save existed;
      // catalogs the whole recipe regardless of which lines were selected.
      await ensureCatalogIngredients(
        tx,
        householdId,
        r.ingredients.map((ing) => ing.name),
      )

      await tx
        .delete(shoppingEntry)
        .where(
          and(
            eq(shoppingEntry.scopeId, householdId),
            eq(shoppingEntry.sourceRecipeId, r.id),
          ),
        )
      if (rows.length) await tx.insert(shoppingEntry).values(rows)

      // Adding a recipe means its items are needed again, so clear any leftover
      // "ticked off" state for them — otherwise re-adding a recipe whose items
      // were checked off on a previous shop (and kept for history) brings them
      // back pre-checked, and the recipe would immediately read as fully shopped.
      const keys = rows.map((row) => row.itemKey)
      if (keys.length) {
        await tx
          .delete(shoppingCheck)
          .where(
            and(
              eq(shoppingCheck.scopeId, householdId),
              inArray(shoppingCheck.itemKey, keys),
            ),
          )
      }
    })

    return { recipeId: r.id, added: rows.length }
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

/** Add a one-off item typed by the user (not tied to any recipe). When
 *  `category` is given the item is also saved to the household ingredient
 *  catalog so the autocomplete remembers it (the "save a new ingredient" path). */
export const addManualItem = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      name: string
      quantity?: number | null
      unit?: string | null
      category?: string | null
    }) =>
      z
        .object({
          name: z.string().trim().min(1, 'Skriv inn en vare').max(200),
          quantity: z.number().positive().nullable().optional(),
          unit: z.string().trim().max(40).nullable().optional(),
          category: z.string().trim().max(60).nullable().optional(),
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
      if (data.category) {
        await saveHouseholdIngredient(tx, householdId, name, data.category)
      }

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

      // If this item was ticked off, re-adding it means we need it again — just
      // uncheck it (its quantity / manual override are left untouched). No-op
      // when it wasn't checked. Covers recipe-derived lines too, since the check
      // is keyed by item_key regardless of what contributed the entry.
      await tx
        .update(shoppingCheck)
        .set({ checked: false, updatedAt: new Date() })
        .where(
          and(
            eq(shoppingCheck.scopeId, householdId),
            eq(shoppingCheck.itemKey, key),
            eq(shoppingCheck.checked, true),
          ),
        )
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

/**
 * Set (or clear, with `quantity: null`) the manual quantity override for a line.
 * Stored on the `shopping_check` row keyed by (household, item_key), so it
 * survives recipe re-aggregation and leaves the contributing entries untouched.
 * Clearing reverts the line to the quantity summed from its entries.
 */
export const setItemQuantity = createServerFn({ method: 'POST' })
  .validator((input: { key: string; quantity: number | null }) =>
    z
      .object({
        key: z.string().min(1),
        quantity: z.number().positive().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    // Return the txid (like setShoppingChecked) so the offline flusher can wait
    // for the override row to round-trip via Electric before dropping its
    // pending overlay.
    const txid = await db.transaction(async (tx) => {
      const [{ txid }] = await tx.execute(TXID_SQL)
      await tx
        .insert(shoppingCheck)
        .values({
          scopeId: householdId,
          itemKey: data.key,
          checked: false,
          overrideQuantity: data.quantity,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [shoppingCheck.scopeId, shoppingCheck.itemKey],
          // Only touch the override — leave the checked state as-is.
          set: { overrideQuantity: data.quantity, updatedAt: new Date() },
        })
      return Number(txid)
    })
    return { key: data.key, quantity: data.quantity, txid }
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
