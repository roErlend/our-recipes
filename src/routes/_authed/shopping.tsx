import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ListChecks,
  Minus,
  Plus,
  RotateCcw,
  ShoppingCart,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'

import { AddShoppingItem } from '@/components/AddShoppingItem'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { categoryRank, DEFAULT_CATEGORY } from '@/lib/categories'
import { useHandedness } from '@/lib/handedness'
import { applyOverrides, unitDimension, unitKeyOf } from '@/lib/shopping-aggregate'
import {
  enqueueOp,
  flushOutbox,
  useOnline,
  useOutbox,
  type OutboxOp,
} from '@/lib/offline'
import {
  categoriesQueryOptions,
  ingredientsQueryOptions,
  shoppingQueryOptions,
} from '@/lib/queries'
import {
  shoppingChecksCollection,
  shoppingEntriesCollection,
} from '@/lib/shopping-collection'
import { type CatalogIngredient } from '@/server/ingredients'
import {
  addManualItem,
  removeCheckedItems,
  removeShoppingItem,
  setItemQuantity,
  setShoppingChecked,
  type ShoppingItem,
  type ShoppingList,
} from '@/server/shopping'

export const Route = createFileRoute('/_authed/shopping')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(shoppingQueryOptions()),
      // Preload the catalog so autocomplete is instant on first keystroke.
      context.queryClient.ensureQueryData(ingredientsQueryOptions()),
      context.queryClient.ensureQueryData(categoriesQueryOptions()),
    ]),
  component: ShoppingPage,
})

/**
 * Group items under category headers in the canonical category order. Within a
 * group, unchecked items come first, then alphabetical. Empty groups are omitted.
 */
function groupItems(
  items: ShoppingItem[],
  isChecked: (item: ShoppingItem) => boolean,
) {
  const byCategory = new Map<string, ShoppingItem[]>()
  for (const item of items) {
    const list = byCategory.get(item.category)
    if (list) list.push(item)
    else byCategory.set(item.category, [item])
  }

  return [...byCategory.entries()]
    .sort(
      (a, b) =>
        categoryRank(a[0]) - categoryRank(b[0]) || a[0].localeCompare(b[0], 'nb'),
    )
    .map(([category, groupItemsList]) => ({
      category,
      items: [...groupItemsList].sort((a, b) => {
        const ca = isChecked(a)
        const cb = isChecked(b)
        if (ca !== cb) return ca ? 1 : -1
        return a.name.localeCompare(b.name, 'nb')
      }),
    }))
}

/**
 * The amount(s) shown for a line: the computed per-unit buckets with any
 * manual overrides applied. A line merges the same ingredient across units
 * («2 stk + 200 g»), so this is a list.
 */
function effectiveAmounts(item: ShoppingItem) {
  return applyOverrides(item.amounts, item.overrides)
}

const hasOverrides = (item: ShoppingItem) => Object.keys(item.overrides).length > 0

function fmtAmount(a: { quantity: number; unit: string | null }) {
  return `${+a.quantity.toFixed(2)}${a.unit ? ` ${a.unit}` : ''}`
}

function formatAmount(item: ShoppingItem) {
  const parts = effectiveAmounts(item).map(fmtAmount)
  // "+ mer" flags an unquantified contribution on the *computed* amounts; a
  // manual override is an explicit statement, so it suppresses the hint.
  if (!hasOverrides(item) && item.hasUnquantified && parts.length) {
    parts.push('mer')
  }
  return parts.join(' + ')
}

/** True only after the first client render, so we never run the Electric live query during SSR. */
function useMounted() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}

/** Wait for a write's txid to round-trip via Electric before dropping its pending
 *  overlay — best-effort, so a missing/stalled sync never blocks the flush. */
async function awaitTxIdSafe(txid: number) {
  try {
    await shoppingChecksCollection.utils.awaitTxId(txid, 8000)
  } catch {
    /* timed out or not syncing — proceed anyway */
  }
}

/**
 * Drives the offline outbox: builds the executor that replays a queued op via the
 * server fns, and flushes on mount, on reconnect, and when the tab becomes
 * visible. Returns a `flush` to call right after enqueuing (a no-op when offline).
 */
function useShoppingFlush() {
  const queryClient = useQueryClient()
  const execute = useCallback(
    async (op: OutboxOp) => {
      if (op.type === 'check') {
        const { txid } = await setShoppingChecked({
          data: { key: op.key, checked: op.value },
        })
        await awaitTxIdSafe(txid)
      } else {
        const { txid } = await setItemQuantity({
          data: { key: op.key, unit: op.unit ?? null, quantity: op.value },
        })
        await awaitTxIdSafe(txid)
        // The displayed amount is server-computed, so pull the fresh snapshot
        // before the pending overlay is dropped.
        await queryClient.refetchQueries({
          queryKey: shoppingQueryOptions().queryKey,
        })
      }
    },
    [queryClient],
  )
  const flush = useCallback(() => void flushOutbox(execute), [execute])

  useEffect(() => {
    flush()
    const onOnline = () => flush()
    const onVisible = () => {
      if (document.visibilityState === 'visible') flush()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [flush])

  return flush
}

/** Add/remove mutations for the persisted list — kept on TanStack Query (the
 *  realtime checkbox sync is separate, via the Electric collection below). */
function useShoppingMutations() {
  const queryClient = useQueryClient()
  const shoppingKey = shoppingQueryOptions().queryKey
  const ingredientsKey = ingredientsQueryOptions().queryKey
  const invalidate = () => queryClient.invalidateQueries({ queryKey: shoppingKey })

  const add = useMutation({
    mutationFn: (input: { name: string; category?: string }) =>
      addManualItem({ data: input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: shoppingKey })
      const previous = queryClient.getQueryData<ShoppingList>(shoppingKey)
      const name = input.name.trim()
      // The key mirrors the server's itemKey(name) — the lowercased name.
      const key = name.toLowerCase()
      // Show the right category immediately: a known ingredient's catalog
      // category, else the one chosen for the new ingredient, else the default.
      const catalog = queryClient.getQueryData<CatalogIngredient[]>(ingredientsKey)
      const catalogHit = catalog?.find((c) => c.key === name.toLowerCase())
      const category = catalogHit?.category ?? input.category ?? DEFAULT_CATEGORY

      if (previous && !previous.items.some((i) => i.key === key)) {
        const optimistic: ShoppingItem = {
          key,
          name,
          amounts: [],
          overrides: {},
          hasUnquantified: true,
          sources: [],
          category,
          isStaple: catalogHit?.isStaple ?? false,
          checked: false,
          checkedAt: null,
        }
        queryClient.setQueryData<ShoppingList>(shoppingKey, {
          ...previous,
          items: [...previous.items, optimistic],
        })
      }
      return { previous }
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(shoppingKey, ctx.previous)
    },
    onSettled: () => {
      invalidate()
      // A newly-typed ingredient is saved to the catalog — refresh it so
      // autocomplete picks it up.
      queryClient.invalidateQueries({ queryKey: ingredientsKey })
    },
  })
  const remove = useMutation({
    mutationFn: (key: string) => removeShoppingItem({ data: { key } }),
    onMutate: async (key) => {
      await queryClient.cancelQueries({ queryKey: shoppingKey })
      const previous = queryClient.getQueryData<ShoppingList>(shoppingKey)
      if (previous) {
        queryClient.setQueryData<ShoppingList>(shoppingKey, {
          ...previous,
          items: previous.items.filter((i) => i.key !== key),
        })
      }
      return { previous }
    },
    onError: (_err, _key, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(shoppingKey, ctx.previous)
    },
    onSettled: invalidate,
  })
  const removeChecked = useMutation({
    mutationFn: () => removeCheckedItems(),
    onSuccess: invalidate,
  })
  // Quantity edits go through the offline outbox (durable + flushed on reconnect),
  // not a query mutation — see RealtimeShoppingList / useShoppingFlush.
  return { add, remove, removeChecked }
}

function ShoppingPage() {
  const { data } = useSuspenseQuery(shoppingQueryOptions())
  const mounted = useMounted()

  // Before mount we render from the server's snapshot (no live query); once
  // mounted the realtime collections take over and sync checks + list contents
  // across devices.
  return mounted ? (
    <RealtimeShoppingList list={data} />
  ) : (
    <ShoppingView
      list={data}
      isChecked={(item) => item.checked}
      checkedAt={(item) => item.checkedAt}
      onToggle={() => {}}
      onSetQuantity={() => {}}
      online
      pendingCount={0}
    />
  )
}

function RealtimeShoppingList({ list }: { list: ShoppingList }) {
  const queryClient = useQueryClient()
  const { data: checkRows } = useLiveQuery((q) =>
    q.from({ c: shoppingChecksCollection }),
  )
  // Keep the list *contents* in sync across devices. The shopping_entry rows
  // stream in via Electric; whenever they change — a recipe or item added or
  // removed on either device — we refetch the server-aggregated list. The
  // server stays the single source of truth for merging/categorizing (and for
  // each recipe's "on the list" flag); Electric just tells us when to re-pull.
  // (The checked state below syncs directly: it's a simple per-row overlay, so
  // reading it straight from the collection keeps toggling instant/optimistic.)
  const { data: entryRows } = useLiveQuery((q) =>
    q.from({ e: shoppingEntriesCollection }),
  )
  const entriesSig = (entryRows ?? [])
    .map((r) => `${r.id}:${r.item_key}:${r.quantity}:${r.source_title}`)
    .sort()
    .join('|')
  // Manual quantity overrides ride the same shopping_check shape as the checks.
  // The displayed amount is server-computed, so (unlike a checkbox) we can't
  // just overlay it — instead we refetch when an override changes on either
  // device. Keyed on override values only (not `checked`) so plain toggles,
  // which need no refetch, don't trigger one.
  const overridesSig = (checkRows ?? [])
    .filter((r) => r.override_amounts && Object.keys(r.override_amounts).length)
    .map((r) => `${r.item_key}:${JSON.stringify(r.override_amounts)}`)
    .sort()
    .join('|')
  const syncSig = `${entriesSig}||${overridesSig}`
  // Skip the first sync (the snapshot already reflects it); refetch on changes.
  const lastSig = useRef<string | null>(null)
  useEffect(() => {
    if (lastSig.current !== null && lastSig.current !== syncSig) {
      queryClient.invalidateQueries({ queryKey: shoppingQueryOptions().queryKey })
    }
    lastSig.current = syncSig
  }, [syncSig, queryClient])

  const online = useOnline()
  const { pendingChecked, pendingQuantity, count } = useOutbox()
  const flush = useShoppingFlush()

  const checkedByKey = new Map((checkRows ?? []).map((r) => [r.item_key, r.checked]))
  // When each check was last written, from the synced row's updated_at.
  const checkedAtByKey = new Map(
    (checkRows ?? []).map((r) => [
      r.item_key,
      r.updated_at ? new Date(r.updated_at).getTime() : null,
    ]),
  )

  // The outbox is both the durable queue and the optimistic overlay: a pending
  // check/override wins over the synced server value until it has flushed.
  const isChecked = (item: ShoppingItem) =>
    pendingChecked.has(item.key)
      ? pendingChecked.get(item.key)!
      : (checkedByKey.get(item.key) ?? false)

  // A just-tapped (still-pending) check floats to the top of the checked
  // section until it syncs; otherwise use the synced timestamp (falling back to
  // the server snapshot's value).
  const checkedAt = (item: ShoppingItem) =>
    pendingChecked.get(item.key) === true
      ? Number.MAX_SAFE_INTEGER
      : (checkedAtByKey.get(item.key) ?? item.checkedAt)

  // Replay pending per-unit edits (oldest-first) onto each item's overrides —
  // the same rules the server applies, so the optimistic view matches what the
  // flush will produce.
  const overlaidList =
    pendingQuantity.length === 0
      ? list
      : {
          ...list,
          items: list.items.map((i) => {
            const mine = pendingQuantity.filter((op) => op.key === i.key)
            if (!mine.length) return i
            const overrides = { ...i.overrides }
            for (const op of mine) {
              if (op.value == null && op.unit == null) {
                for (const k of Object.keys(overrides)) delete overrides[k]
              } else if (op.value == null) {
                delete overrides[unitKeyOf(op.unit)]
              } else {
                const unitKey = unitKeyOf(op.unit)
                const dim = unitDimension(unitKey)
                for (const k of Object.keys(overrides)) {
                  if (unitDimension(k) === dim) delete overrides[k]
                }
                overrides[unitKey] = op.value
              }
            }
            return { ...i, overrides }
          }),
        }

  const toggle = (item: ShoppingItem, checked: boolean) => {
    enqueueOp({ type: 'check', key: item.key, value: checked })
    flush()
  }

  const onSetQuantity = (key: string, unit: string | null, quantity: number | null) => {
    enqueueOp({ type: 'quantity', key, unit, value: quantity })
    flush()
  }

  return (
    <ShoppingView
      list={overlaidList}
      isChecked={isChecked}
      checkedAt={checkedAt}
      onToggle={toggle}
      onSetQuantity={onSetQuantity}
      online={online}
      pendingCount={count}
    />
  )
}

function ShoppingView({
  list,
  isChecked,
  checkedAt,
  onToggle,
  onSetQuantity,
  online,
  pendingCount,
}: {
  list: ShoppingList
  isChecked: (item: ShoppingItem) => boolean
  /** When a line was checked (epoch ms), or null — sorts the checked section. */
  checkedAt: (item: ShoppingItem) => number | null
  onToggle: (item: ShoppingItem, checked: boolean) => void
  onSetQuantity: (key: string, unit: string | null, quantity: number | null) => void
  /** False when the browser is offline — disables actions that need the network. */
  online: boolean
  /** Count of queued offline edits awaiting flush. */
  pendingCount: number
}) {
  const { recipes, items } = list
  const { add, remove, removeChecked } = useShoppingMutations()
  // Right-handed mode mirrors each row so the checkbox + name sit on the
  // right edge (under a right thumb); left is the classic layout.
  const righty = useHandedness() === 'right'
  // Pantry staples (salt, oil…) are parked in their own de-emphasized section
  // and kept out of the "to buy" flow entirely — they're things you already
  // have, so they don't clutter the active list or the count.
  const staples = items
    .filter((i) => i.isStaple)
    .sort(
      (a, b) =>
        categoryRank(a.category) - categoryRank(b.category) ||
        a.name.localeCompare(b.name, 'nb'),
    )
  const buyable = items.filter((i) => !i.isStaple)
  // Unchecked items are grouped under category headers; checked items all drop
  // to a single section at the very bottom, most-recently-checked first.
  const uncheckedGroups = groupItems(
    buyable.filter((i) => !isChecked(i)),
    isChecked,
  )
  const checkedItems = buyable
    .filter((i) => isChecked(i))
    .sort(
      (a, b) =>
        (checkedAt(b) ?? 0) - (checkedAt(a) ?? 0) ||
        a.name.localeCompare(b.name, 'nb'),
    )
  const checkedCount = checkedItems.length
  const remaining = buyable.length - checkedCount
  // Only label category sections when there's more than one.
  const showHeaders = uncheckedGroups.length > 1

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Handleliste</h1>
          <p className="text-sm text-stone-500">
            {remaining} {remaining === 1 ? 'vare' : 'varer'} igjen
            {recipes.length > 0 && (
              <>
                {' '}
                · fra {recipes.length}{' '}
                {recipes.length === 1 ? 'oppskrift' : 'oppskrifter'}
              </>
            )}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onPress={() => removeChecked.mutate()}
          isDisabled={checkedCount === 0 || !online || removeChecked.isPending}
        >
          <Trash2 className="h-4 w-4" />
          Fjern avhukede
        </Button>
      </div>

      {/* Only the offline state gets a banner — it's a real, persistent mode.
          Online syncing is sub-second and silent; flashing a banner on every
          toggle just shifts the layout. */}
      {!online && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>
            Frakoblet – avhuking og antall lagres og sendes når du er på nett igjen.
            {pendingCount > 0 && ` (${pendingCount} venter)`}
          </span>
        </div>
      )}

      {online ? (
        <AddShoppingItem onAdd={(input) => add.mutate(input)} />
      ) : (
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-400">
          Koble til nett for å legge til nye varer.
        </div>
      )}

      {recipes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {recipes.map((r) => (
            <Link key={r.id} to="/recipes/$recipeId" params={{ recipeId: r.id }}>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm text-stone-700 shadow-sm ring-1 ring-stone-200 hover:ring-brand-300">
                <ListChecks className="h-3.5 w-3.5 text-brand-600" />
                {r.title}
              </span>
            </Link>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-stone-300 bg-white/50 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">
            <ShoppingCart className="h-6 w-6" />
          </div>
          <p className="max-w-sm text-stone-600">
            Handlelisten er tom. Legg til varer over, eller åpne en oppskrift og
            trykk <strong>Legg til handleliste</strong>.
          </p>
          <Link to="/recipes">
            <Button variant="secondary">Se oppskrifter</Button>
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          {uncheckedGroups.map((group) => (
            <section key={group.category}>
              {showHeaders && <SectionHeader>{group.category}</SectionHeader>}
              <ul>
                {group.items.map((item) => (
                  <ShoppingRow
                    key={item.key}
                    item={item}
                    checked={false}
                    righty={righty}
                    onToggle={onToggle}
                    onRemove={() => remove.mutate(item.key)}
                    onSetQuantity={onSetQuantity}
                    online={online}
                  />
                ))}
              </ul>
            </section>
          ))}

          {staples.length > 0 && (
            <section>
              <SectionHeader>Har hjemme ({staples.length})</SectionHeader>
              <ul>
                {staples.map((item) => (
                  <ShoppingRow
                    key={item.key}
                    item={item}
                    checked={isChecked(item)}
                    muted
                    righty={righty}
                    onToggle={onToggle}
                    onRemove={() => remove.mutate(item.key)}
                    onSetQuantity={onSetQuantity}
                    online={online}
                  />
                ))}
              </ul>
            </section>
          )}

          {checkedItems.length > 0 && (
            <section>
              <SectionHeader>Avhuket ({checkedCount})</SectionHeader>
              <ul>
                {checkedItems.map((item) => (
                  <ShoppingRow
                    key={item.key}
                    item={item}
                    checked
                    righty={righty}
                    onToggle={onToggle}
                    onRemove={() => remove.mutate(item.key)}
                    onSetQuantity={onSetQuantity}
                    online={online}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-stone-100 bg-stone-50 px-4 py-1.5 text-xs font-semibold tracking-wide text-stone-500 uppercase">
      {children}
    </h2>
  )
}

function ShoppingRow({
  item,
  checked,
  muted = false,
  righty = false,
  online = true,
  onToggle,
  onRemove,
  onSetQuantity,
}: {
  item: ShoppingItem
  checked: boolean
  /** De-emphasize the row (used for pantry staples in "Har hjemme"). */
  muted?: boolean
  /** Right-handed mode: mirror the whole row (checkbox + right-aligned name on
   *  the right edge, buttons on the left). Left is the classic layout. */
  righty?: boolean
  /** When offline, removing a line is disabled (it needs the network). */
  online?: boolean
  onToggle: (item: ShoppingItem, checked: boolean) => void
  onRemove: () => void
  onSetQuantity: (key: string, unit: string | null, quantity: number | null) => void
}) {
  const amount = formatAmount(item)
  const [editing, setEditing] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState('')
  // Escape sets this so the blur that follows (input unmount) skips the save.
  const skipCommit = useRef(false)

  // A line aggregating several units («2 stk + 200 g») can't be edited with
  // one number — tapping its amount opens a dialog with a stepper per unit.
  // Single-unit lines keep the inline ± / tap-to-type flow.
  const effective = effectiveAmounts(item)
  const multi = effective.length > 1
  const target = effective[0] ?? { quantity: null, unit: null }
  const targetUnitKey = unitKeyOf(target.unit)

  const startEdit = () => {
    if (multi) {
      setDialogOpen(true)
      return
    }
    setDraft(
      target.quantity != null
        ? String(+target.quantity.toFixed(2)).replace('.', ',')
        : '',
    )
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    if (skipCommit.current) {
      skipCommit.current = false
      return
    }
    const raw = draft.trim().replace(',', '.')
    if (raw === '') {
      // Empty → clear the override (revert to the computed amounts).
      if (hasOverrides(item)) onSetQuantity(item.key, null, null)
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return
    if (n !== target.quantity) onSetQuantity(item.key, targetUnitKey, +n.toFixed(2))
  }

  // Steppers set a manual override on the line; ± operate on the shown amount.
  const increment = () =>
    onSetQuantity(item.key, targetUnitKey, +((target.quantity ?? 0) + 1).toFixed(2))
  const canDecrement = target.quantity != null && target.quantity > 1
  const decrement = () => {
    if (canDecrement) {
      onSetQuantity(item.key, targetUnitKey, +(target.quantity! - 1).toFixed(2))
    }
  }

  return (
    <li
      className={`flex items-center gap-3 border-b border-stone-100 px-4 py-3 last:border-0 ${
        righty ? 'flex-row-reverse' : ''
      }`}
    >
      {/* The whole name region — checkbox through the name, up to the amount
          buttons — is one clickable toggle target (react-aria Checkbox label).
          In right-handed mode the checkbox goes after the right-aligned name,
          so the row is a true mirror image. */}
      <Checkbox
        isSelected={checked}
        onChange={(value) => onToggle(item, value)}
        aria-label={`Merk ${item.name} som kjøpt`}
        className={`-my-2 min-w-0 flex-1 py-2 ${righty ? 'flex-row-reverse' : ''}`}
      >
        <span className={`min-w-0 flex-1 ${righty ? 'text-right' : ''}`}>
          {/* Mirrored reading order too: the recipe-source suffix sits on the
              outside of the name, away from the checkbox, in both modes. */}
          {righty && item.sources.length > 0 && (
            <span className="mr-2 text-sm text-stone-400">
              {item.sources.join(', ')}
            </span>
          )}
          <span
            className={
              checked
                ? 'text-stone-400 line-through'
                : muted
                  ? 'text-stone-400'
                  : 'font-medium text-stone-900'
            }
          >
            {item.name}
          </span>
          {!righty && item.sources.length > 0 && (
            <span className="ml-2 text-sm text-stone-400">
              {item.sources.join(', ')}
            </span>
          )}
        </span>
      </Checkbox>
      {editing ? (
        <span className="flex shrink-0 items-center gap-1">
          <input
            autoFocus
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                skipCommit.current = true
                e.currentTarget.blur()
              }
            }}
            aria-label={`Antall for ${item.name}`}
            className="w-16 rounded border border-stone-300 px-1.5 py-0.5 text-right text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
          {target.unit && (
            <span className="text-sm text-stone-500">{target.unit}</span>
          )}
        </span>
      ) : (
        <div className="flex shrink-0 items-center gap-0.5">
          {!multi && (
            <button
              type="button"
              onClick={decrement}
              disabled={!canDecrement}
              aria-label={`Færre ${item.name}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Minus className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={startEdit}
            aria-label={`Endre antall for ${item.name}`}
            className={[
              'min-w-[3.5rem] rounded px-1 py-0.5 text-center text-sm tabular-nums transition-colors hover:bg-stone-100',
              checked
                ? 'text-stone-300 line-through'
                : amount
                  ? 'font-medium text-stone-600'
                  : 'text-stone-300',
            ].join(' ')}
          >
            {amount || 'antall'}
          </button>
          {!multi && (
            <button
              type="button"
              onClick={increment}
              aria-label={`Flere ${item.name}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {multi && (
        <AmountsDialog
          isOpen={dialogOpen}
          onOpenChange={setDialogOpen}
          item={item}
          amounts={effective}
          onSetQuantity={onSetQuantity}
        />
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={!online}
        aria-label={`Fjern ${item.name} fra listen`}
        title={online ? undefined : 'Krever nett'}
        className="-m-2 shrink-0 rounded-full p-2 text-stone-300 transition-colors hover:bg-stone-100 hover:text-stone-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-300"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  )
}

/**
 * Per-unit editor for a line that aggregates several units («2 stk + 200 g»):
 * one stepper row per amount bucket, each adjustable independently (writing a
 * per-unit override through the same offline outbox as the inline steppers, so
 * the rows update live while the dialog is open). Reset restores the computed
 * amounts.
 */
function AmountsDialog({
  isOpen,
  onOpenChange,
  item,
  amounts,
  onSetQuantity,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  item: ShoppingItem
  amounts: { quantity: number; unit: string | null }[]
  onSetQuantity: (key: string, unit: string | null, quantity: number | null) => void
}) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/40 p-4 pt-[10vh] backdrop-blur-sm"
    >
      <Modal className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl outline-none">
        <Dialog className="outline-none">
          <Heading slot="title" className="text-lg font-semibold text-stone-900">
            {item.name}
          </Heading>
          <p className="mt-1 text-sm text-stone-500">
            Varen står med flere enheter — juster hver for seg.
          </p>

          <ul className="mt-3 flex flex-col divide-y divide-stone-100">
            {amounts.map((a) => {
              const unitKey = unitKeyOf(a.unit)
              const canDecrement = a.quantity > 1
              return (
                <li
                  key={unitKey}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="text-sm text-stone-600">
                    {a.unit ?? 'antall'}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        onSetQuantity(item.key, unitKey, +(a.quantity - 1).toFixed(2))
                      }
                      disabled={!canDecrement}
                      aria-label={`Færre ${item.name} (${a.unit ?? 'antall'})`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="min-w-[4.5rem] text-center text-sm font-medium tabular-nums text-stone-900">
                      {fmtAmount(a)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onSetQuantity(item.key, unitKey, +(a.quantity + 1).toFixed(2))
                      }
                      aria-label={`Flere ${item.name} (${a.unit ?? 'antall'})`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          {item.hasUnquantified && (
            <p className="mt-1 text-xs text-stone-400">
              + noe uten oppgitt mengde («etter smak» o.l.)
            </p>
          )}

          <div className="mt-4 flex items-center justify-between gap-2">
            {hasOverrides(item) ? (
              <Button
                variant="ghost"
                size="sm"
                onPress={() => onSetQuantity(item.key, null, null)}
                className="text-stone-500"
              >
                <RotateCcw className="h-4 w-4" />
                Tilbakestill
              </Button>
            ) : (
              <span />
            )}
            <Button size="sm" onPress={() => onOpenChange(false)}>
              Ferdig
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
