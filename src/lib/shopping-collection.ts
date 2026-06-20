import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { z } from 'zod'

/**
 * Realtime "ticked off" state for the shared shopping list, synced from the
 * `shopping_check` table via Electric. When either household member ticks a
 * box, the write goes to Postgres through our server functions; Electric then
 * streams the row change to every member's browser, so their lists stay in
 * sync without a refresh.
 *
 * **Read-only collection.** Writes don't go through TanStack DB's optimistic
 * transactions — they're queued in the offline outbox (`@/lib/offline`) and
 * replayed through the server fns, so a check survives a network drop instead of
 * being rolled back. The optimistic overlay lives in the outbox; this collection
 * is just the synced server truth (the same model the entries collection uses).
 * `utils.awaitTxId` lets the flusher wait for a write to round-trip before
 * dropping its pending overlay.
 *
 * Only the household's own rows arrive here — the `/api/shapes/shopping` proxy
 * pins the `where` clause server-side. The columns mirror the proxy's
 * `columns=user_id,item_key,checked,override_quantity` selection.
 */
const shoppingCheckRow = z.object({
  user_id: z.string(),
  item_key: z.string(),
  checked: z.boolean(),
  // Manual per-line quantity override (null = use the computed sum). Synced so
  // an edit on one device propagates to the other; see shopping.tsx.
  override_quantity: z.number().nullable(),
})

export type ShoppingCheckRow = z.infer<typeof shoppingCheckRow>

/**
 * Electric's ShapeStream does `new URL(url)` with no base, so it needs an
 * absolute URL. Sync only ever starts in the browser (the live query is gated
 * behind a mount check), so the SSR placeholder is never actually fetched — it
 * just has to parse.
 */
const shapeUrl = (path: string) =>
  typeof window === 'undefined'
    ? `http://localhost${path}`
    : `${window.location.origin}${path}`

const SHAPE_URL = shapeUrl('/api/shapes/shopping')

export const shoppingChecksCollection = createCollection(
  electricCollectionOptions({
    id: 'shopping-checks',
    shapeOptions: {
      // Our auth proxy — it adds the table, household `where` and credentials.
      url: SHAPE_URL,
    },
    schema: shoppingCheckRow,
    getKey: (row) => row.item_key,
  }),
)

/**
 * Realtime contents of the shared shopping list, synced from the
 * `shopping_entry` table via Electric. One row per ingredient *contribution*
 * (recipe-derived or ad-hoc); the view folds them into lines by item key. When
 * either member adds or removes a recipe (or an ad-hoc item), the write goes to
 * Postgres through our server functions and Electric streams the row changes
 * here, so both members' lists stay in sync without a refresh.
 *
 * Read-only: every write goes through the existing server functions (recipe
 * expansion, merge-by-key and check-clearing all happen server-side), so this
 * collection defines no write handlers — it only mirrors the synced rows. The
 * `/api/shapes/shopping-entries` proxy pins the household `where`; the columns
 * mirror its `columns=…` selection.
 */
const shoppingEntryRow = z.object({
  id: z.string(),
  item_key: z.string(),
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  source_recipe_id: z.string().nullable(),
  source_title: z.string().nullable(),
})

export type ShoppingEntryRow = z.infer<typeof shoppingEntryRow>

export const shoppingEntriesCollection = createCollection(
  electricCollectionOptions({
    id: 'shopping-entries',
    shapeOptions: {
      url: shapeUrl('/api/shapes/shopping-entries'),
    },
    schema: shoppingEntryRow,
    getKey: (row) => row.id,
  }),
)
