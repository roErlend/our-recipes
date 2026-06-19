import { useMemo, useState } from 'react'
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Check, Pencil, Search, Shield, Trash2, X } from 'lucide-react'

import { isAdminEmail } from '@/lib/admin'
import {
  categoryRank,
  DEFAULT_CATEGORY,
  INGREDIENT_CATEGORIES,
} from '@/lib/categories'
import {
  adminIngredientsQueryOptions,
  ingredientsQueryOptions,
  shoppingQueryOptions,
} from '@/lib/queries'
import {
  adminDeleteCategory,
  adminDeleteIngredient,
  adminRenameCategory,
  adminUpdateIngredient,
  type AdminIngredient,
} from '@/server/admin'

export const Route = createFileRoute('/_authed/admin')({
  beforeLoad: ({ context }) => {
    if (!isAdminEmail(context.user.email)) {
      throw redirect({ to: '/recipes' })
    }
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(adminIngredientsQueryOptions()),
  component: AdminPage,
})

/** Invalidate everything that depends on the catalog after an admin change. */
function useAdminInvalidate() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: adminIngredientsQueryOptions().queryKey })
    queryClient.invalidateQueries({ queryKey: ingredientsQueryOptions().queryKey })
    queryClient.invalidateQueries({ queryKey: shoppingQueryOptions().queryKey })
  }
}

function AdminPage() {
  const { data: ingredients } = useSuspenseQuery(adminIngredientsQueryOptions())

  const categories = useMemo(() => {
    const set = new Set<string>(INGREDIENT_CATEGORIES)
    for (const i of ingredients) set.add(i.category)
    return [...set].sort(
      (a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b, 'nb'),
    )
  }, [ingredients])

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-2">
        <Shield className="h-6 w-6 text-brand-600" />
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Admin</h1>
          <p className="text-sm text-stone-500">
            Rydd i ingredienser og kategorier.
          </p>
        </div>
      </div>

      <CategoriesSection ingredients={ingredients} />
      <IngredientsSection ingredients={ingredients} categories={categories} />
    </div>
  )
}

/* ------------------------------ categories ------------------------------ */

function CategoriesSection({ ingredients }: { ingredients: AdminIngredient[] }) {
  const invalidate = useAdminInvalidate()

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const i of ingredients) map.set(i.category, (map.get(i.category) ?? 0) + 1)
    return [...map.entries()].sort(
      (a, b) => categoryRank(a[0]) - categoryRank(b[0]) || a[0].localeCompare(b[0], 'nb'),
    )
  }, [ingredients])

  const rename = useMutation({
    mutationFn: (vars: { from: string; to: string }) =>
      adminRenameCategory({ data: vars }),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (category: string) => adminDeleteCategory({ data: { category } }),
    onSuccess: invalidate,
  })

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-stone-900">Kategorier</h2>
      <p className="text-sm text-stone-500">
        Endre navn på en kategori (oppdaterer alle varene), eller slett den (varene
        flyttes til «{DEFAULT_CATEGORY}»).
      </p>
      <ul className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        {counts.map(([category, count]) => (
          <CategoryRow
            key={category}
            category={category}
            count={count}
            onRename={(to) => rename.mutate({ from: category, to })}
            onDelete={() => remove.mutate(category)}
            busy={rename.isPending || remove.isPending}
          />
        ))}
      </ul>
    </section>
  )
}

function CategoryRow({
  category,
  count,
  onRename,
  onDelete,
  busy,
}: {
  category: string
  count: number
  onRename: (to: string) => void
  onDelete: () => void
  busy: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(category)
  const isDefault = category === DEFAULT_CATEGORY

  const save = () => {
    const to = value.trim()
    if (to && to !== category) onRename(to)
    setEditing(false)
  }

  return (
    <li className="flex items-center gap-3 border-b border-stone-100 px-4 py-3 last:border-0">
      {editing ? (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            else if (e.key === 'Escape') {
              setValue(category)
              setEditing(false)
            }
          }}
          maxLength={60}
          className="flex-1 rounded-lg border border-stone-300 px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />
      ) : (
        <span className="flex-1 font-medium text-stone-800">{category}</span>
      )}
      <span className="text-xs text-stone-400">
        {count} {count === 1 ? 'vare' : 'varer'}
      </span>
      {editing ? (
        <>
          <IconButton label="Lagre" onClick={save} disabled={busy} tone="brand">
            <Check className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Avbryt"
            onClick={() => {
              setValue(category)
              setEditing(false)
            }}
          >
            <X className="h-4 w-4" />
          </IconButton>
        </>
      ) : (
        <>
          <IconButton label="Endre navn" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
          </IconButton>
          {!isDefault && (
            <IconButton
              label={`Slett kategorien ${category}`}
              onClick={onDelete}
              disabled={busy}
              tone="danger"
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          )}
        </>
      )}
    </li>
  )
}

/* ------------------------------ ingredients ----------------------------- */

function IngredientsSection({
  ingredients,
  categories,
}: {
  ingredients: AdminIngredient[]
  categories: string[]
}) {
  const invalidate = useAdminInvalidate()
  const [search, setSearch] = useState('')

  const update = useMutation({
    mutationFn: (vars: { id: string; name: string; category: string }) =>
      adminUpdateIngredient({ data: vars }),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => adminDeleteIngredient({ data: { id } }),
    onSuccess: invalidate,
  })

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return ingredients
    return ingredients.filter(
      (i) =>
        i.name.toLowerCase().includes(term) ||
        i.category.toLowerCase().includes(term),
    )
  }, [ingredients, search])

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-stone-900">
        Ingredienser{' '}
        <span className="text-sm font-normal text-stone-400">
          ({ingredients.length})
        </span>
      </h2>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Søk på navn eller kategori…"
          className="w-full rounded-lg border border-stone-300 bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />
      </div>

      <datalist id="admin-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-300 bg-white/50 py-10 text-center text-sm text-stone-500">
          Ingen ingredienser samsvarer.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          {filtered.map((ingredient) => (
            <IngredientRow
              key={ingredient.id}
              ingredient={ingredient}
              onSave={(name, category) =>
                update.mutate({ id: ingredient.id, name, category })
              }
              onDelete={() => remove.mutate(ingredient.id)}
              busy={update.isPending || remove.isPending}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function IngredientRow({
  ingredient,
  onSave,
  onDelete,
  busy,
}: {
  ingredient: AdminIngredient
  onSave: (name: string, category: string) => void
  onDelete: () => void
  busy: boolean
}) {
  const [name, setName] = useState(ingredient.name)
  const [category, setCategory] = useState(ingredient.category)

  const dirty =
    name.trim() !== ingredient.name || category.trim() !== ingredient.category
  const canSave = dirty && name.trim() !== '' && category.trim() !== ''

  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-stone-100 px-4 py-3 last:border-0">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={200}
        aria-label={`Navn på ${ingredient.name}`}
        className="min-w-0 flex-1 rounded-lg border border-stone-300 px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
      />
      <input
        list="admin-categories"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        maxLength={60}
        aria-label={`Kategori for ${ingredient.name}`}
        className="w-44 rounded-lg border border-stone-300 px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
      />
      {ingredient.isStock ? (
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
          standard
        </span>
      ) : (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
          egen
        </span>
      )}
      <IconButton
        label={`Lagre ${ingredient.name}`}
        onClick={() => onSave(name.trim(), category.trim())}
        disabled={!canSave || busy}
        tone="brand"
      >
        <Check className="h-4 w-4" />
      </IconButton>
      <IconButton
        label={`Slett ${ingredient.name}`}
        onClick={onDelete}
        disabled={busy}
        tone="danger"
      >
        <Trash2 className="h-4 w-4" />
      </IconButton>
    </li>
  )
}

/* -------------------------------- shared -------------------------------- */

function IconButton({
  label,
  onClick,
  disabled,
  tone = 'default',
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'brand' | 'danger'
  children: React.ReactNode
}) {
  const toneClass =
    tone === 'brand'
      ? 'text-brand-600 hover:bg-brand-50 disabled:text-stone-300'
      : tone === 'danger'
        ? 'text-stone-400 hover:bg-red-50 hover:text-red-600 disabled:text-stone-300'
        : 'text-stone-400 hover:bg-stone-100 hover:text-stone-700'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed ${toneClass}`}
    >
      {children}
    </button>
  )
}
