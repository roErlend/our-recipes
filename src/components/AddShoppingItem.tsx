import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import {
  DEFAULT_CATEGORY,
  INGREDIENT_CATEGORIES,
} from '@/lib/categories'
import { ingredientsQueryOptions } from '@/lib/queries'
import {
  filterIngredients,
  type CatalogIngredient,
} from '@/server/ingredients'

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Add box for the shopping list with ingredient autocomplete. Picking a saved
 * ingredient reuses its category; typing a name the catalog doesn't know shows
 * a category picker and saves it to the household catalog on add.
 */
export function AddShoppingItem({
  onAdd,
}: {
  onAdd: (input: { name: string; category?: string }) => void
}) {
  const [value, setValue] = useState('')
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORY)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Whole catalog, preloaded in the route loader and cached by TanStack Query —
  // filtering happens locally, so suggestions appear instantly with no fetch.
  const { data: catalog = [] } = useQuery(ingredientsQueryOptions())

  const trimmed = value.trim()
  const key = norm(value)
  const suggestions = useMemo(
    () => (trimmed === '' ? [] : filterIngredients(catalog, trimmed)),
    [catalog, trimmed],
  )
  const exact = suggestions.find((s) => s.key === key)
  const isNew = trimmed !== '' && !exact

  const choose = (s: CatalogIngredient) => {
    setValue(s.name)
    setCategory(s.category)
    setOpen(false)
    setActive(-1)
  }

  const submit = () => {
    const name = value.trim()
    if (!name) return
    // Reuse the catalog entry's display name/category when it's a known
    // ingredient; otherwise save the typed name under the chosen category.
    const match = catalog.find((c) => c.key === norm(name))
    onAdd(
      match
        ? { name: match.name }
        : { name, category },
    )
    setValue('')
    setCategory(DEFAULT_CATEGORY)
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (open && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => (i + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
        return
      }
      if (e.key === 'Enter' && active >= 0 && active < suggestions.length) {
        e.preventDefault()
        choose(suggestions[active])
        return
      }
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  const showList = open && suggestions.length > 0

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex items-start gap-2">
        <div className="relative flex-1">
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setOpen(true)
              setActive(-1)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Delay so a click on a suggestion registers first.
              blurTimer.current = setTimeout(() => setOpen(false), 120)
            }}
            onKeyDown={onKeyDown}
            placeholder="Legg til en vare…"
            aria-label="Legg til en vare på handlelisten"
            autoComplete="off"
            role="combobox"
            aria-expanded={showList}
            aria-controls="ingredient-suggestions"
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
          {showList && (
            <ul
              id="ingredient-suggestions"
              role="listbox"
              className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
              onMouseDown={() => {
                // Keep focus/value while clicking an option.
                if (blurTimer.current) clearTimeout(blurTimer.current)
              }}
            >
              {suggestions.map((s, i) => (
                <li key={`${s.name}-${i}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(s)}
                    className={[
                      'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm',
                      i === active ? 'bg-brand-50' : 'hover:bg-stone-50',
                    ].join(' ')}
                  >
                    <span className="font-medium text-stone-800">{s.name}</span>
                    <span className="shrink-0 text-xs text-stone-400">
                      {s.category}
                      {s.isHousehold ? ' · egen' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {isNew && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Kategori for den nye varen"
            title="Kategori – lagres så autofullføring husker varen"
            className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm text-stone-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          >
            {INGREDIENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}

        <Button type="submit" isDisabled={!trimmed}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Legg til</span>
        </Button>
      </div>

      {isNew && (
        <p className="text-xs text-stone-400">
          Ny vare – lagres i kategorien «{category}» så autofullføring husker den.
        </p>
      )}
    </form>
  )
}
