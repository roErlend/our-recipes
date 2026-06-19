import { useEffect, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ListChecks, ShoppingCart, Trash2, X } from 'lucide-react'

import { AddShoppingItem } from '@/components/AddShoppingItem'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { categoryRank, DEFAULT_CATEGORY } from '@/lib/categories'
import { ingredientsQueryOptions, shoppingQueryOptions } from '@/lib/queries'
import { shoppingChecksCollection } from '@/lib/shopping-collection'
import { type CatalogIngredient } from '@/server/ingredients'
import {
  addManualItem,
  removeCheckedItems,
  removeShoppingItem,
  type ShoppingItem,
  type ShoppingList,
} from '@/server/shopping'

export const Route = createFileRoute('/_authed/shopping')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(shoppingQueryOptions()),
      // Preload the catalog so autocomplete is instant on first keystroke.
      context.queryClient.ensureQueryData(ingredientsQueryOptions()),
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
    .sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]))
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

function formatAmount(item: ShoppingItem) {
  const parts: string[] = []
  if (item.quantity != null) {
    parts.push(`${+item.quantity.toFixed(2)}${item.unit ? ` ${item.unit}` : ''}`)
  } else if (item.unit) {
    parts.push(item.unit)
  }
  if (item.hasUnquantified && item.quantity != null) parts.push('+ mer')
  return parts.join(' ')
}

/** True only after the first client render, so we never run the Electric live query during SSR. */
function useMounted() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
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
      // Manual items carry no unit, so the key mirrors the server's
      // itemKey(name, null) = "<lowercased name>__".
      const key = `${name.toLowerCase()}__`
      // Show the right category immediately: a known ingredient's catalog
      // category, else the one chosen for the new ingredient, else the default.
      const catalog = queryClient.getQueryData<CatalogIngredient[]>(ingredientsKey)
      const category =
        catalog?.find((c) => c.key === name.toLowerCase())?.category ??
        input.category ??
        DEFAULT_CATEGORY

      if (previous && !previous.items.some((i) => i.key === key)) {
        const optimistic: ShoppingItem = {
          key,
          name,
          unit: null,
          quantity: null,
          hasUnquantified: true,
          sources: [],
          category,
          checked: false,
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
  return { add, remove, removeChecked }
}

function ShoppingPage() {
  const { data } = useSuspenseQuery(shoppingQueryOptions())
  const mounted = useMounted()

  // Before mount we render from the server's snapshot (no live query); once
  // mounted the realtime collection takes over and syncs checks across devices.
  return mounted ? (
    <RealtimeShoppingList list={data} />
  ) : (
    <ShoppingView list={data} isChecked={(item) => item.checked} onToggle={() => {}} />
  )
}

function RealtimeShoppingList({ list }: { list: ShoppingList }) {
  const { data: checkRows } = useLiveQuery((q) =>
    q.from({ c: shoppingChecksCollection }),
  )
  const checkedByKey = new Map((checkRows ?? []).map((r) => [r.item_key, r.checked]))

  const isChecked = (item: ShoppingItem) => checkedByKey.get(item.key) ?? false

  const toggle = (item: ShoppingItem, checked: boolean) => {
    if (shoppingChecksCollection.has(item.key)) {
      shoppingChecksCollection.update(item.key, (draft) => {
        draft.checked = checked
      })
    } else {
      shoppingChecksCollection.insert({
        user_id: list.scopeId,
        item_key: item.key,
        checked,
      })
    }
  }

  return <ShoppingView list={list} isChecked={isChecked} onToggle={toggle} />
}

function ShoppingView({
  list,
  isChecked,
  onToggle,
}: {
  list: ShoppingList
  isChecked: (item: ShoppingItem) => boolean
  onToggle: (item: ShoppingItem, checked: boolean) => void
}) {
  const { recipes, items } = list
  const { add, remove, removeChecked } = useShoppingMutations()
  const groups = groupItems(items, isChecked)
  const remaining = items.filter((i) => !isChecked(i)).length
  const checkedCount = items.length - remaining
  // Only label sections when there's more than one to label.
  const showHeaders = groups.length > 1

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
          isDisabled={checkedCount === 0 || removeChecked.isPending}
        >
          <Trash2 className="h-4 w-4" />
          Fjern avhukede
        </Button>
      </div>

      <AddShoppingItem onAdd={(input) => add.mutate(input)} />

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
          {groups.map((group) => (
            <section key={group.category}>
              {showHeaders && (
                <h2 className="border-b border-stone-100 bg-stone-50 px-4 py-1.5 text-xs font-semibold tracking-wide text-stone-500 uppercase">
                  {group.category}
                </h2>
              )}
              <ul>
                {group.items.map((item) => {
                  const amount = formatAmount(item)
                  const checked = isChecked(item)
                  return (
                    <li
                      key={item.key}
                      className="flex items-center gap-3 border-b border-stone-100 px-4 py-3 last:border-0"
                    >
                      <Checkbox
                        isSelected={checked}
                        onChange={(value) => onToggle(item, value)}
                        aria-label={`Merk ${item.name} som kjøpt`}
                        className="-m-2 p-2"
                      />
                      <div className="min-w-0 flex-1">
                        <span
                          className={
                            checked
                              ? 'text-stone-400 line-through'
                              : 'font-medium text-stone-900'
                          }
                        >
                          {item.name}
                        </span>
                        {item.sources.length > 0 && (
                          <span className="ml-2 text-sm text-stone-400">
                            {item.sources.join(', ')}
                          </span>
                        )}
                      </div>
                      {amount && (
                        <span
                          className={
                            checked
                              ? 'text-sm text-stone-300 line-through'
                              : 'text-sm font-medium text-stone-600'
                          }
                        >
                          {amount}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => remove.mutate(item.key)}
                        aria-label={`Fjern ${item.name} fra listen`}
                        className="-m-2 shrink-0 rounded-full p-2 text-stone-300 transition-colors hover:bg-stone-100 hover:text-stone-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
