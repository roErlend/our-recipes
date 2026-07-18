import { useMemo, useState } from 'react'
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  Check,
  Home,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { ComboBox } from '@/components/ui/ComboBox'
import { isAdminEmail } from '@/lib/admin'
import { categoryRank, DEFAULT_CATEGORY } from '@/lib/categories'
import {
  adminCategoriesQueryOptions,
  adminIngredientsQueryOptions,
} from '@/lib/queries'
import {
  adminCreateCategory,
  adminCreateIngredient,
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
    Promise.all([
      context.queryClient.ensureQueryData(adminIngredientsQueryOptions()),
      context.queryClient.ensureQueryData(adminCategoriesQueryOptions()),
    ]),
  component: AdminPage,
})

/**
 * Invalidate the template queries after an admin change. Template edits don't
 * reach households directly (they own their copies), so household-facing keys
 * don't need to refetch here.
 */
function useAdminInvalidate() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: adminIngredientsQueryOptions().queryKey })
    queryClient.invalidateQueries({ queryKey: adminCategoriesQueryOptions().queryKey })
  }
}

function AdminPage() {
  const { data: ingredients } = useSuspenseQuery(adminIngredientsQueryOptions())
  const { data: baseCategories } = useSuspenseQuery(adminCategoriesQueryOptions())

  // All template category names = canonical/admin-created ∪ any used on rows.
  const categories = useMemo(() => {
    const set = new Set<string>(baseCategories)
    for (const i of ingredients) set.add(i.category)
    return [...set].sort(
      (a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b, 'nb'),
    )
  }, [baseCategories, ingredients])

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-2">
        <Shield className="h-6 w-6 text-brand-600" />
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Admin</h1>
          <p className="text-sm text-stone-500">
            Rediger malene for ingredienser og kategorier. Husholdninger får en
            kopi når de tas i bruk – og kan hente malene på nytt selv.
          </p>
        </div>
      </div>

      <CategoriesSection ingredients={ingredients} categories={categories} />
      <IngredientsSection ingredients={ingredients} categories={categories} />
    </div>
  )
}

/* ------------------------------ categories ------------------------------ */

function CategoriesSection({
  ingredients,
  categories,
}: {
  ingredients: AdminIngredient[]
  categories: string[]
}) {
  const invalidate = useAdminInvalidate()

  // Every category name (incl. empty ones) with its ingredient count.
  const counts = useMemo(() => {
    const map = new Map<string, number>(categories.map((c) => [c, 0]))
    for (const i of ingredients) map.set(i.category, (map.get(i.category) ?? 0) + 1)
    return [...map.entries()].sort(
      (a, b) => categoryRank(a[0]) - categoryRank(b[0]) || a[0].localeCompare(b[0], 'nb'),
    )
  }, [ingredients, categories])

  const create = useMutation({
    mutationFn: (name: string) => adminCreateCategory({ data: { name } }),
    onSuccess: invalidate,
  })
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
      <AddRow
        placeholder="Ny kategori…"
        buttonLabel="Legg til kategori"
        maxLength={60}
        busy={create.isPending}
        onAdd={(name) => create.mutate(name)}
      />
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

/** A simple "name + add" form row (used for new categories). */
function AddRow({
  placeholder,
  buttonLabel,
  maxLength,
  busy,
  onAdd,
}: {
  placeholder: string
  buttonLabel: string
  maxLength: number
  busy: boolean
  onAdd: (value: string) => void
}) {
  const [value, setValue] = useState('')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (!v) return
    onAdd(v)
    setValue('')
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
      />
      <Button
        type="submit"
        size="sm"
        isDisabled={!value.trim() || busy}
        className="shrink-0"
      >
        <Plus className="h-4 w-4" />
        {buttonLabel}
      </Button>
    </form>
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

  const create = useMutation({
    mutationFn: (vars: { name: string; category: string }) =>
      adminCreateIngredient({ data: vars }),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (vars: {
      id: string
      name: string
      category: string
      staple: boolean
    }) => adminUpdateIngredient({ data: vars }),
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

      <NewIngredientForm
        categories={categories}
        busy={create.isPending}
        onCreate={(name, category) => create.mutate({ name, category })}
      />

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
              categories={categories}
              onSave={(name, category, staple) =>
                update.mutate({ id: ingredient.id, name, category, staple })
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

function NewIngredientForm({
  categories,
  busy,
  onCreate,
}: {
  categories: string[]
  busy: boolean
  onCreate: (name: string, category: string) => void
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORY)
  const canAdd = name.trim() !== '' && category.trim() !== ''

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canAdd) return
    onCreate(name.trim(), category.trim())
    setName('')
    setCategory(DEFAULT_CATEGORY)
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-2xl border border-dashed border-stone-300 bg-white/50 p-3 sm:flex-row sm:flex-wrap sm:items-center"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ny ingrediens (standard)…"
        maxLength={200}
        aria-label="Navn på ny ingrediens"
        className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 sm:min-w-0 sm:flex-1"
      />
      <ComboBox
        items={categories}
        value={category}
        onChange={setCategory}
        maxLength={60}
        aria-label="Kategori for ny ingrediens"
        className="w-full sm:w-44"
      />
      <Button
        type="submit"
        size="sm"
        isDisabled={!canAdd || busy}
        className="w-full shrink-0 sm:w-auto"
      >
        <Plus className="h-4 w-4" />
        Legg til
      </Button>
    </form>
  )
}

function IngredientRow({
  ingredient,
  categories,
  onSave,
  onDelete,
  busy,
}: {
  ingredient: AdminIngredient
  categories: string[]
  onSave: (name: string, category: string, staple: boolean) => void
  onDelete: () => void
  busy: boolean
}) {
  const [name, setName] = useState(ingredient.name)
  const [category, setCategory] = useState(ingredient.category)
  const [staple, setStaple] = useState(ingredient.staple)

  const dirty =
    name.trim() !== ingredient.name ||
    category.trim() !== ingredient.category ||
    staple !== ingredient.staple
  const canSave = dirty && name.trim() !== '' && category.trim() !== ''

  return (
    <li className="flex flex-col gap-2 border-b border-stone-100 px-4 py-3 last:border-0 sm:flex-row sm:flex-wrap sm:items-center">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={200}
        aria-label={`Navn på ${ingredient.name}`}
        className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 sm:min-w-0 sm:flex-1"
      />
      <div className="flex items-center gap-2">
        <ComboBox
          items={categories}
          value={category}
          onChange={setCategory}
          maxLength={60}
          suppressKeyboard
          aria-label={`Kategori for ${ingredient.name}`}
          className="min-w-0 flex-1 sm:w-44 sm:flex-none"
        />
        <button
          type="button"
          onClick={() => setStaple((s) => !s)}
          aria-label={`Fast vare (har alltid hjemme): ${ingredient.name}`}
          aria-pressed={staple}
          title="Fast vare – holdes utenfor handlelisten"
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
            staple
              ? 'bg-brand-100 text-brand-700 hover:bg-brand-200'
              : 'text-stone-300 hover:bg-stone-100 hover:text-stone-600'
          }`}
        >
          <Home className="h-4 w-4" />
        </button>
        <IconButton
          label={`Lagre ${ingredient.name}`}
          onClick={() => onSave(name.trim(), category.trim(), staple)}
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
      </div>
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
