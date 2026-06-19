import { useEffect, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ListChecks, Plus, ShoppingCart, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { shoppingQueryOptions } from '@/lib/queries'
import { shoppingChecksCollection } from '@/lib/shopping-collection'
import {
  addManualItem,
  removeCheckedItems,
  removeShoppingItem,
  type ShoppingItem,
  type ShoppingList,
} from '@/server/shopping'

export const Route = createFileRoute('/_authed/shopping')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(shoppingQueryOptions()),
  component: ShoppingPage,
})

/** Unchecked first, then alphabetical — matches the server's initial ordering. */
function sortItems(items: ShoppingItem[], isChecked: (item: ShoppingItem) => boolean) {
  return [...items].sort((a, b) => {
    const ca = isChecked(a)
    const cb = isChecked(b)
    if (ca !== cb) return ca ? 1 : -1
    return a.name.localeCompare(b.name)
  })
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
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: shoppingQueryOptions().queryKey })

  const add = useMutation({
    mutationFn: (name: string) => addManualItem({ data: { name } }),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (key: string) => removeShoppingItem({ data: { key } }),
    onSuccess: invalidate,
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

function AddItemForm({ onAdd }: { onAdd: (name: string) => void }) {
  const [value, setValue] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const name = value.trim()
    if (!name) return
    onAdd(name)
    setValue('')
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Legg til en vare…"
        aria-label="Legg til en vare på handlelisten"
        className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
      />
      <Button type="submit" isDisabled={!value.trim()}>
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">Legg til</span>
      </Button>
    </form>
  )
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
  const sorted = sortItems(items, isChecked)
  const remaining = items.filter((i) => !isChecked(i)).length
  const checkedCount = items.length - remaining

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

      <AddItemForm onAdd={(name) => add.mutate(name)} />

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
        <ul className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          {sorted.map((item) => {
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
      )}
    </div>
  )
}
