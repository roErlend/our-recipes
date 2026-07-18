import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Plus } from 'lucide-react'

import {
  categoryRank,
  DEFAULT_CATEGORY,
  INGREDIENT_CATEGORIES,
} from '@/lib/categories'
import {
  categoriesQueryOptions,
  ingredientsQueryOptions,
} from '@/lib/queries'
import {
  filterIngredients,
  type CatalogIngredient,
} from '@/server/ingredients'

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Add box for the shopping list with ingredient autocomplete. Picking a saved
 * ingredient reuses its category; typing a name the catalog doesn't know shows
 * a category picker (canonical categories + any the household has added, plus
 * the option to create a new one) and saves it to the household catalog on add.
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
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const formRef = useRef<HTMLFormElement>(null)

  // Whole catalog, preloaded in the route loader and cached by TanStack Query —
  // filtering happens locally, so suggestions appear instantly with no fetch.
  const { data: catalog = [] } = useQuery(ingredientsQueryOptions())
  const { data: baseCategories = INGREDIENT_CATEGORIES as readonly string[] } =
    useQuery(categoriesQueryOptions())

  const trimmed = value.trim()
  const key = norm(value)
  const suggestions = useMemo(
    () => (trimmed === '' ? [] : filterIngredients(catalog, trimmed)),
    [catalog, trimmed],
  )
  const exact = suggestions.find((s) => s.key === key)
  const isNew = trimmed !== '' && !exact

  // Canonical categories plus any custom ones the household already uses,
  // ordered the same way the shopping list groups them.
  const categories = useMemo(() => {
    const set = new Set<string>(baseCategories)
    for (const c of catalog) set.add(c.category)
    return [...set].sort(
      (a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b, 'nb'),
    )
  }, [baseCategories, catalog])

  const reset = () => {
    setValue('')
    setCategory(DEFAULT_CATEGORY)
    setOpen(false)
    setActive(-1)
    setAddingCategory(false)
    setNewCategory('')
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
    const cat = chosen.trim()
    if (!name || !cat) return
    onAdd({ name, category: cat })
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
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      // Close only when focus leaves the whole add box — so moving focus into a
      // suggestion or the new-category field keeps the dropdown open.
      onBlur={(e) => {
        if (!formRef.current?.contains(e.relatedTarget as Node | null)) {
          setOpen(false)
        }
      }}
      className="flex flex-col gap-2"
    >
      <div className="relative">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
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
            className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
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
                      onMouseDown={(e) => e.preventDefault()}
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
                  {categories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
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

                  {addingCategory ? (
                    <span className="inline-flex items-center gap-1">
                      <input
                        autoFocus
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            addNew(newCategory)
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            setAddingCategory(false)
                            setNewCategory('')
                          }
                        }}
                        placeholder="Ny kategori…"
                        aria-label="Navn på ny kategori"
                        maxLength={60}
                        className="w-32 rounded-full border border-brand-300 bg-white px-2.5 py-1 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
                      />
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addNew(newCategory)}
                        disabled={!newCategory.trim()}
                        aria-label="Legg til i ny kategori"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-on-brand transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-stone-300"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setAddingCategory(true)}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-stone-300 px-2.5 py-1 text-xs text-stone-500 transition-colors hover:border-brand-400 hover:text-brand-600"
                    >
                      <Plus className="h-3 w-3" />
                      Ny kategori
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </form>
  )
}
