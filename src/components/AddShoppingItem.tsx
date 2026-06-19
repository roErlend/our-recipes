import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

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

  const reset = () => {
    setValue('')
    setCategory(DEFAULT_CATEGORY)
    setOpen(false)
    setActive(-1)
  }

  // Selecting a suggestion adds it straight away (one action) — the catalog
  // already knows its category, so there's nothing more to confirm.
  const choose = (s: CatalogIngredient) => {
    onAdd({ name: s.name })
    reset()
  }

  // Add a brand-new ingredient under an explicitly chosen category (one click).
  const addNew = (chosen: string) => {
    const name = value.trim()
    if (!name) return
    onAdd({ name, category: chosen })
    reset()
  }

  const submit = () => {
    const name = value.trim()
    if (!name) return
    // Known ingredient → add by its catalog name (no category needed).
    // Otherwise add as new under the currently highlighted category.
    if (exact) {
      onAdd({ name: exact.name })
      reset()
      return
    }
    addNew(category)
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

  const showList = open && (suggestions.length > 0 || isNew)

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
            <div
              id="ingredient-suggestions"
              className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
              onMouseDown={() => {
                // Keep focus/value while clicking an option.
                if (blurTimer.current) clearTimeout(blurTimer.current)
              }}
            >
              {suggestions.length > 0 && (
                <ul role="listbox">
                  {suggestions.map((s, i) => (
                    <li
                      key={`${s.name}-${i}`}
                      role="option"
                      aria-selected={i === active}
                    >
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

              {isNew && (
                <div
                  className={
                    suggestions.length > 0
                      ? 'mt-1 border-t border-stone-100 px-3 pt-2 pb-1'
                      : 'px-3 pt-1.5 pb-1'
                  }
                >
                  <p className="mb-1.5 text-xs text-stone-500">
                    Legg til «<span className="font-medium text-stone-700">{trimmed}</span>» i
                    kategori:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {INGREDIENT_CATEGORIES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onMouseEnter={() => setCategory(c)}
                        onClick={() => addNew(c)}
                        className={[
                          'rounded-full border px-2.5 py-1 text-xs transition-colors',
                          c === category
                            ? 'border-brand-500 bg-brand-50 text-brand-700'
                            : 'border-stone-200 text-stone-600 hover:border-brand-300 hover:bg-stone-50',
                        ].join(' ')}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </form>
  )
}
