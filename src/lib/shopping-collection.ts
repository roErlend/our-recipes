import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { z } from 'zod'

import { clearShoppingChecks, setShoppingChecked } from '@/server/shopping'

/**
 * Realtime "ticked off" state for the shared shopping list, synced from the
 * `shopping_check` table via Electric. When either household member ticks a
 * box, the write goes to Postgres through our server functions; Electric then
 * streams the row change to every member's browser, so their lists stay in
 * sync without a refresh.
 *
 * Only the household's own rows arrive here — the `/api/shapes/shopping` proxy
 * pins the `where` clause server-side. The columns mirror the proxy's
 * `columns=user_id,item_key,checked` selection.
 */
const shoppingCheckRow = z.object({
  user_id: z.string(),
  item_key: z.string(),
  checked: z.boolean(),
})

export type ShoppingCheckRow = z.infer<typeof shoppingCheckRow>

/**
 * Electric's ShapeStream does `new URL(url)` with no base, so it needs an
 * absolute URL. Sync only ever starts in the browser (the live query is gated
 * behind a mount check), so the SSR placeholder is never actually fetched — it
 * just has to parse.
 */
const SHAPE_URL =
  typeof window === 'undefined'
    ? 'http://localhost/api/shapes/shopping'
    : `${window.location.origin}/api/shapes/shopping`

export const shoppingChecksCollection = createCollection(
  electricCollectionOptions({
    id: 'shopping-checks',
    shapeOptions: {
      // Our auth proxy — it adds the table, household `where` and credentials.
      url: SHAPE_URL,
    },
    schema: shoppingCheckRow,
    getKey: (row) => row.item_key,
    // Writes are persisted through the existing server functions, which return
    // the Postgres txid so TanStack DB can match the synced change and clear
    // the optimistic state. Toggling is an upsert server-side, so insert and
    // update both route to setShoppingChecked.
    onInsert: async ({ transaction }) => {
      const row = transaction.mutations[0].modified
      const { txid } = await setShoppingChecked({
        data: { key: row.item_key, checked: row.checked },
      })
      return { txid }
    },
    onUpdate: async ({ transaction }) => {
      const row = transaction.mutations[0].modified
      const { txid } = await setShoppingChecked({
        data: { key: row.item_key, checked: row.checked },
      })
      return { txid }
    },
    // The only delete path is "reset", which clears the whole household list.
    onDelete: async () => {
      const { txid } = await clearShoppingChecks()
      return { txid }
    },
  }),
)
