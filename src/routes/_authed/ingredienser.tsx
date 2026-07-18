import { useMemo, useState } from 'react'
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Carrot, Check, Home, Pencil, Plus, Search, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { ComboBox } from '@/components/ui/ComboBox'
import { categoryRank, DEFAULT_CATEGORY } from '@/lib/categories'
import {
  householdCatalogQueryOptions,
  householdCategoriesQueryOptions,
  ingredientsQueryOptions,
  categoriesQueryOptions,
  shoppingQueryOptions,
} from '@/lib/queries'
import {
  createHouseholdCategory,
  deleteHouseholdCatalogItem,
  deleteHouseholdCategory,
  renameHouseholdCategory,
  saveHouseholdCatalogItem,
  type HouseholdCatalogRow,
  type HouseholdCategoryRow,
} from '@/server/ingredients'

export const Route = createFileRoute('/_authed/ingredienser')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(householdCatalogQueryOptions()),
      context.queryClient.ensureQueryData(householdCategoriesQueryOptions()),
    ]),
  component: IngredientsPage,
})

/** Invalidate everything that depends on the household catalog after a change. */
function useHouseholdInvalidate() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: householdCatalogQueryOptions().queryKey })
    queryClient.invalidateQueries({ queryKey: householdCategoriesQueryOptions().queryKey })
    queryClient.invalidateQueries({ queryKey: ingredientsQueryOptions().queryKey })
    queryClient.invalidateQueries({ queryKey: categoriesQueryOptions().queryKey })
    queryClient.invalidateQueries({ queryKey: shoppingQueryOptions().queryKey })
  }
}

function IngredientsPage() {
  const { data: catalog } = useSuspenseQuery(householdCatalogQueryOptions())
  const { data: categories } = useSuspenseQuery(householdCategoriesQueryOptions())

  const categoryNames = useMemo(
    () =>
      [...categories]
        .map((c) => c.name)
        .sort(
          (a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b, 'nb'),
        ),
    [categories],
  )

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-2">
        <Carrot className="h-6 w-6 text-brand-600" />
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Ingredienser</h1>
          <p className="text-sm text-stone-500">
            Tilpass kategorier og ingredienser for husholdningen din. De globale
            fungerer som maler – endrer du en, lager vi en egen kopi til dere.
          </p>
        </div>
      </div>

      <CategoriesSection categories={categories} />
      <IngredientsSection catalog={catalog} categories={categoryNames} />
    </div>
  )
}

/* ------------------------------ categories ------------------------------ */

function CategoriesSection({ categories }: { categories: HouseholdCategoryRow[] }) {
  const invalidate = useHouseholdInvalidate()

  const create = useMutation({
    mutationFn: (name: string) => createHouseholdCategory({ data: { name } }),
    onSuccess: invalidate,
  })
  const rename = useMutation({
    mutationFn: (vars: { from: string; to: string }) =>
      renameHouseholdCategory({ data: vars }),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (name: string) => deleteHouseholdCategory({ data: { name } }),
    onSuccess: invalidate,
  })

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-stone-900">Kategorier</h2>
      <p className="text-sm text-stone-500">
        Lag egne kategorier, eller endre navn / slett de du har laget selv (varene
        flyttes til «{DEFAULT_CATEGORY}»). Globale kategorier er maler og kan ikke
        endres her.
      </p>
      <AddRow
        placeholder="Ny kategori…"
        buttonLabel="Legg til kategori"
        maxLength={60}
        busy={create.isPending}
        onAdd={(name) => create.mutate(name)}
      />
      <ul className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        {categories.map((category) => (
          <CategoryRow
            key={category.name}
            category={category}
            onRename={(to) => rename.mutate({ from: category.name, to })}
            onDelete={() => remove.mutate(category.name)}
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
      <Button type="submit" size="sm" isDisabled={!value.trim() || busy} className="shrink-0">
        <Plus className="h-4 w-4" />
        {buttonLabel}
      </Button>
    </form>
  )
}

function CategoryRow({
  category,
  onRename,
  onDelete,
  busy,
}: {
  category: HouseholdCategoryRow
  onRename: (to: string) => void
  onDelete: () => void
  busy: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(category.name)
  const isOwn = category.origin === 'household'

  const save = () => {
    const to = value.trim()
    if (to && to !== category.name) onRename(to)
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
              setValue(category.name)
              setEditing(false)
            }
          }}
          maxLength={60}
          className="flex-1 rounded-lg border border-stone-300 px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />
      ) : (
        <span className="flex flex-1 items-center gap-2 font-medium text-stone-800">
          {category.name}
          {!isOwn && (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-normal text-stone-500">
              global
            </span>
          )}
        </span>
      )}
      <span className="text-xs text-stone-400">
        {category.count} {category.count === 1 ? 'vare' : 'varer'}
      </span>
      {isOwn ? (
        editing ? (
          <>
            <IconButton label="Lagre" onClick={save} disabled={busy} tone="brand">
              <Check className="h-4 w-4" />
            </IconButton>
            <IconButton
              label="Avbryt"
              onClick={() => {
                setValue(category.name)
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
            <IconButton
              label={`Slett kategorien ${category.name}`}
              onClick={onDelete}
              disabled={busy}
              tone="danger"
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </>
        )
      ) : null}
    </li>
  )
}

/* ------------------------------ ingredients ----------------------------- */

function IngredientsSection({
  catalog,
  categories,
}: {
  catalog: HouseholdCatalogRow[]
  categories: string[]
}) {
  const invalidate = useHouseholdInvalidate()
  const [search, setSearch] = useState('')

  const save = useMutation({
    mutationFn: (vars: {
      id: string | null
      name: string
      category: string
      staple?: boolean
    }) => saveHouseholdCatalogItem({ data: vars }),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteHouseholdCatalogItem({ data: { id } }),
    onSuccess: invalidate,
  })

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return catalog
    return catalog.filter(
      (i) =>
        i.name.toLowerCase().includes(term) ||
        i.category.toLowerCase().includes(term),
    )
  }, [catalog, search])

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-stone-900">
        Ingredienser{' '}
        <span className="text-sm font-normal text-stone-400">({catalog.length})</span>
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
        busy={save.isPending}
        onCreate={(name, category) => save.mutate({ id: null, name, category })}
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
                save.mutate({ id: ingredient.id, name, category, staple })
              }
              onDelete={() => remove.mutate(ingredient.id)}
              busy={save.isPending || remove.isPending}
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
        placeholder="Ny ingrediens…"
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
      <Button type="submit" size="sm" isDisabled={!canAdd || busy} className="w-full shrink-0 sm:w-auto">
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
  ingredient: HouseholdCatalogRow
  categories: string[]
  onSave: (name: string, category: string, staple: boolean) => void
  onDelete: () => void
  busy: boolean
}) {
  const [name, setName] = useState(ingredient.name)
  const [category, setCategory] = useState(ingredient.category)
  const [staple, setStaple] = useState(ingredient.staple)
  const isOwn = ingredient.origin === 'household'

  const dirty =
    name.trim() !== ingredient.name ||
    category.trim() !== ingredient.category ||
    staple !== ingredient.staple
  const canSave = dirty && name.trim() !== '' && category.trim() !== ''

  return (
    <li className="flex flex-col gap-2 border-b border-stone-100 px-4 py-3 last:border-0 sm:flex-row sm:flex-wrap sm:items-center">
      {isOwn ? (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          aria-label={`Navn på ${ingredient.name}`}
          className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 sm:min-w-0 sm:flex-1"
        />
      ) : (
        // Stock template: name is read-only (editing category/staple forks a copy).
        <span className="w-full px-2 py-1.5 text-sm font-medium text-stone-800 sm:min-w-0 sm:flex-1">
          {ingredient.name}
        </span>
      )}
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
        {isOwn ? (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
            egen
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
            global
          </span>
        )}
        <IconButton
          label={`Lagre ${ingredient.name}`}
          onClick={() => onSave(name.trim(), category.trim(), staple)}
          disabled={!canSave || busy}
          tone="brand"
        >
          <Check className="h-4 w-4" />
        </IconButton>
        {isOwn && (
          <IconButton
            label={`Slett ${ingredient.name}`}
            onClick={onDelete}
            disabled={busy}
            tone="danger"
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        )}
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
