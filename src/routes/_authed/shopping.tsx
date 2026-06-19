import { useEffect, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ListChecks, RotateCcw, ShoppingCart } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { shoppingQueryOptions } from '@/lib/queries'
import { shoppingChecksCollection } from '@/lib/shopping-collection'
import { type ShoppingItem, type ShoppingList } from '@/server/shopping'

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

function ShoppingPage() {
  const { data } = useSuspenseQuery(shoppingQueryOptions())
  const mounted = useMounted()

  if (data.recipes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-stone-300 bg-white/50 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">
          <ShoppingCart className="h-6 w-6" />
        </div>
        <p className="max-w-sm text-stone-600">
          Ingen oppskrifter er merket som aktive denne uken. Merk noen
          oppskrifter som <strong>aktive</strong>, så blir de til en handleliste
          her.
        </p>
        <Link to="/recipes">
          <Button>Se oppskrifter</Button>
        </Link>
      </div>
    )
  }

  // Before mount we render from the server's snapshot (no live query); once
  // mounted the realtime collection takes over and syncs across devices.
  return mounted ? (
    <RealtimeShoppingList list={data} />
  ) : (
    <ShoppingView
      list={data}
      isChecked={(item) => item.checked}
      onToggle={() => {}}
      onReset={() => {}}
    />
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

  const reset = () => {
    const keys = [...checkedByKey.keys()]
    if (keys.length) shoppingChecksCollection.delete(keys)
  }

  return (
    <ShoppingView list={list} isChecked={isChecked} onToggle={toggle} onReset={reset} />
  )
}

function ShoppingView({
  list,
  isChecked,
  onToggle,
  onReset,
}: {
  list: ShoppingList
  isChecked: (item: ShoppingItem) => boolean
  onToggle: (item: ShoppingItem, checked: boolean) => void
  onReset: () => void
}) {
  const { recipes, items } = list
  const sorted = sortItems(items, isChecked)
  const remaining = items.filter((i) => !isChecked(i)).length

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Handleliste</h1>
          <p className="text-sm text-stone-500">
            {remaining} {remaining === 1 ? 'vare' : 'varer'} igjen · fra{' '}
            {recipes.length}{' '}
            {recipes.length === 1 ? 'aktiv oppskrift' : 'aktive oppskrifter'}
          </p>
        </div>
        <Button variant="secondary" size="sm" onPress={onReset}>
          <RotateCcw className="h-4 w-4" />
          Nullstill avhuking
        </Button>
      </div>

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

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-300 bg-white/50 py-12 text-center text-stone-500">
          De aktive oppskriftene dine har ingen ingredienser ennå.
        </p>
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
                <div className="flex-1">
                  <span
                    className={
                      checked
                        ? 'text-stone-400 line-through'
                        : 'font-medium text-stone-900'
                    }
                  >
                    {item.name}
                  </span>
                  <span className="ml-2 text-sm text-stone-400">
                    {item.sources.join(', ')}
                  </span>
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
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
