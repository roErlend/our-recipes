import { useEffect, useMemo, useState } from 'react'
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  Check,
  ExternalLink,
  Plus,
  Search,
  ShoppingCart,
  Star,
  Users,
  UtensilsCrossed,
} from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { recipesQueryOptions, shoppingQueryOptions } from '@/lib/queries'
import { type RecipeListItem } from '@/server/recipes'
import {
  addRecipeToShopping,
  removeRecipeFromShopping,
} from '@/server/shopping'

export const Route = createFileRoute('/_authed/recipes/')({
  // Keep the search term in the URL (?q=…) so it survives back-navigation from a
  // recipe and is deep-linkable. The loader doesn't read `q`, so typing only
  // re-filters client-side — it never re-runs the loader. `q` is optional (and
  // omitted when empty) so other links to /recipes needn't pass it.
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    const q = typeof search.q === 'string' ? search.q : ''
    return q ? { q } : {}
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(recipesQueryOptions()),
  component: RecipesPage,
})

function RecipesPage() {
  const queryClient = useQueryClient()
  const { data: recipes } = useSuspenseQuery(recipesQueryOptions())
  const navigate = Route.useNavigate()
  // The input is driven by local state so typing is always instant; binding it
  // straight to the async URL state drops fast keystrokes. We mirror the term
  // into the URL (?q=…), debounced + replace-history, so it survives back-nav
  // from a recipe and is deep-linkable without spamming history. The URL `q` is
  // only read to seed state on mount (incl. when this route remounts on
  // back-navigation); local state is authoritative thereafter.
  const { q: initialSearch = '' } = Route.useSearch()
  const [search, setSearch] = useState(initialSearch)

  useEffect(() => {
    const id = setTimeout(() => {
      void navigate({
        search: (prev) => ({ ...prev, q: search || undefined }),
        replace: true,
      })
    }, 200)
    return () => clearTimeout(id)
  }, [search, navigate])

  const recipesKey = recipesQueryOptions().queryKey

  const onListCount = recipes.filter((r) => r.inShoppingList).length

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return recipes
    return recipes.filter(
      (r) =>
        r.title.toLowerCase().includes(term) ||
        (r.description?.toLowerCase().includes(term) ?? false) ||
        r.tags.some((t) => t.toLowerCase().includes(term)),
    )
  }, [recipes, search])

  const shoppingMutation = useMutation({
    mutationFn: (vars: { id: string; inList: boolean }) =>
      vars.inList
        ? addRecipeToShopping({ data: { recipeId: vars.id } })
        : removeRecipeFromShopping({ data: { recipeId: vars.id } }),
    onMutate: async ({ id, inList }) => {
      await queryClient.cancelQueries({ queryKey: recipesKey })
      const previous = queryClient.getQueryData<RecipeListItem[]>(recipesKey)
      if (previous) {
        queryClient.setQueryData<RecipeListItem[]>(
          recipesKey,
          previous.map((r) =>
            r.id === id ? { ...r, inShoppingList: inList } : r,
          ),
        )
      }
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(recipesKey, ctx.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shoppingQueryOptions().queryKey })
    },
  })

  const toggleShopping = (id: string, inList: boolean) =>
    shoppingMutation.mutate({ id, inList })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Oppskrifter</h1>
          <p className="text-sm text-stone-500">
            {recipes.length} lagret · {onListCount} på handlelisten
          </p>
        </div>
        <Link to="/recipes/new">
          <Button>
            <Plus className="h-4 w-4" />
            Ny oppskrift
          </Button>
        </Link>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Søk på tittel, beskrivelse eller etikett…"
          className="w-full rounded-lg border border-stone-300 bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState hasRecipes={recipes.length > 0} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onToggleShopping={toggleShopping}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function RecipeCard({
  recipe,
  onToggleShopping,
}: {
  recipe: RecipeListItem
  onToggleShopping: (id: string, inList: boolean) => void
}) {
  const inList = recipe.inShoppingList
  const canAdd = recipe.ingredientCount > 0
  const thumbnail = recipe.uploadedImageUrl ?? recipe.imageUrl
  return (
    <li className="group relative flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <Link
          to="/recipes/$recipeId"
          params={{ recipeId: recipe.id }}
          className="flex min-w-0 flex-1 items-start gap-3"
        >
          {thumbnail && (
            <img
              src={thumbnail}
              alt=""
              loading="lazy"
              className="h-14 w-14 shrink-0 rounded-lg object-cover"
            />
          )}
          <div className="min-w-0">
            <h2 className="font-semibold text-stone-900 group-hover:text-brand-700">
              {recipe.title}
            </h2>
            {recipe.description && (
              <p className="mt-1 line-clamp-2 text-sm text-stone-500">
                {recipe.description}
              </p>
            )}
          </div>
        </Link>
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => onToggleShopping(recipe.id, !inList)}
          aria-label={
            inList
              ? `Fjern ${recipe.title} fra handlelisten`
              : `Legg ${recipe.title} til handlelisten`
          }
          title={
            canAdd
              ? inList
                ? 'På handlelisten – trykk for å fjerne'
                : 'Legg til handlelisten'
              : 'Ingen ingredienser å legge til'
          }
          className={[
            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
            !canAdd
              ? 'cursor-not-allowed text-stone-300'
              : inList
                ? 'bg-brand-600 text-white hover:bg-brand-700'
                : 'text-stone-400 hover:bg-stone-100 hover:text-brand-700',
          ].join(' ')}
        >
          {inList ? (
            <Check className="h-5 w-5" />
          ) : (
            <ShoppingCart className="h-5 w-5" />
          )}
        </button>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-stone-500">
        {recipe.ratingCount > 0 && (
          <span
            className="inline-flex items-center gap-1 font-semibold text-amber-600"
            title={`Snitt ${recipe.ratingAvg.toFixed(1).replace('.', ',')} av 10 · ${recipe.ratingCount} ${recipe.ratingCount === 1 ? 'stemme' : 'stemmer'}`}
          >
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            {recipe.ratingAvg.toFixed(1).replace('.', ',')}
            <span className="font-normal text-stone-400">
              ({recipe.ratingCount})
            </span>
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <UtensilsCrossed className="h-3.5 w-3.5" />
          {recipe.ingredientCount}{' '}
          {recipe.ingredientCount === 1 ? 'ingrediens' : 'ingredienser'}
        </span>
        {!recipe.isOwner && recipe.ownerName && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
            <Users className="h-3.5 w-3.5" />
            {recipe.ownerName}
          </span>
        )}
        {recipe.sourceUrl && (
          <a
            href={recipe.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-brand-600 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Kilde
          </a>
        )}
        {recipe.tags.slice(0, 4).map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600"
          >
            {tag}
          </span>
        ))}
      </div>
    </li>
  )
}

function EmptyState({ hasRecipes }: { hasRecipes: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-stone-300 bg-white/50 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">
        <UtensilsCrossed className="h-6 w-6" />
      </div>
      <p className="text-stone-600">
        {hasRecipes
          ? 'Ingen oppskrifter samsvarer med filteret ditt.'
          : 'Ingen oppskrifter ennå – legg til din første!'}
      </p>
      {!hasRecipes && (
        <Link to="/recipes/new">
          <Button>
            <Plus className="h-4 w-4" />
            Ny oppskrift
          </Button>
        </Link>
      )}
    </div>
  )
}
