import { useMemo, useState } from 'react'
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  Check,
  Dices,
  ExternalLink,
  Plus,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Star,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { MealPlanModal } from '@/components/MealPlanModal'
import { NewRecipeMenu } from '@/components/NewRecipeMenu'
import { MEAL_TAGS, isMealTag } from '@/lib/tags'
import { recipesQueryOptions, shoppingQueryOptions } from '@/lib/queries'
import { type RecipeListItem } from '@/server/recipes'
import {
  addRecipeToShopping,
  removeRecipeFromShopping,
} from '@/server/shopping'

type SortKey = 'rating' | 'new' | 'az'

// 'rating' is the default and is omitted from the URL; the others are explicit.
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'rating', label: 'Best vurdert' },
  { value: 'new', label: 'Nyeste' },
  { value: 'az', label: 'Alfabetisk (A–Å)' },
]

// Sort comparators applied *within* the shopping-list grouping (list items
// always float to the top). All read from the already-fetched list, so changing
// sort never re-runs the loader.
const SORT_COMPARATORS: Record<
  SortKey,
  (a: RecipeListItem, b: RecipeListItem) => number
> = {
  rating: (a, b) =>
    b.ratingAvg - a.ratingAvg ||
    b.ratingCount - a.ratingCount ||
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  new: (a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  az: (a, b) => a.title.localeCompare(b.title, 'nb'),
}

export const Route = createFileRoute('/_authed/recipes/')({
  // Keep the search term (?q=…), tag filter (?tags=…) and sort (?sort=…) in the
  // URL so they survive back-navigation from a recipe and are deep-linkable. The
  // loader reads none of them, so typing/toggling/sorting only re-filters
  // client-side — it never re-runs the loader. All are optional (and omitted
  // when at their default) so other links to /recipes needn't pass them.
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; tags?: string[]; sort?: SortKey; draw?: string[] } => {
    const q = typeof search.q === 'string' ? search.q : ''
    const rawTags = search.tags
    const tags = (Array.isArray(rawTags) ? rawTags : [rawTags])
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
    const sort = search.sort === 'new' || search.sort === 'az' ? search.sort : undefined
    // Drawn recipe ids from the "Trekk oppskrifter" dialog, kept here so the
    // result survives navigating into a recipe and back (the dialog re-seeds).
    const rawDraw = search.draw
    const draw = (Array.isArray(rawDraw) ? rawDraw : [rawDraw])
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
    return {
      ...(q ? { q } : {}),
      ...(tags.length ? { tags } : {}),
      ...(sort ? { sort } : {}),
      ...(draw.length ? { draw } : {}),
    }
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(recipesQueryOptions()),
  component: RecipesPage,
})

function RecipesPage() {
  const queryClient = useQueryClient()
  const { data: recipes } = useSuspenseQuery(recipesQueryOptions())
  const navigate = Route.useNavigate()
  // The input is driven by local state so typing is always instant (binding it
  // straight to the async URL state drops fast keystrokes). The URL `q` only
  // seeds state on mount — including when this route remounts on back-navigation
  // from a recipe — so the term is restored; local state is authoritative after.
  const {
    q: initialSearch = '',
    tags: initialTags = [],
    sort: initialSort = 'rating',
    draw: initialDraw = [],
  } = Route.useSearch()
  const [search, setSearch] = useState(initialSearch)
  // Selected tag filter, also URL-seeded on mount and kept in the URL below.
  const [activeTags, setActiveTags] = useState<string[]>(initialTags)
  const [sort, setSort] = useState<SortKey>(initialSort)
  // The tag list is tucked behind a toggle so it never crowds the page; open it
  // by default when arriving with a filter already applied (e.g. a deep link).
  const [showFilters, setShowFilters] = useState(initialTags.length > 0)
  // The "Trekk oppskrifter" randomizer dialog. Reopens automatically when we
  // arrive with a persisted draw in the URL (e.g. back from a drawn recipe).
  const [mealPlanOpen, setMealPlanOpen] = useState(initialDraw.length > 0)

  // Mirror the drawn recipe ids to ?draw=… so the result survives navigation.
  const syncDraw = (ids: string[]) =>
    void navigate({
      search: (s) => ({ ...s, draw: ids.length ? ids : undefined }),
      replace: true,
    })

  // Mirror the term into the URL as a direct consequence of editing (no effect).
  // replace-history avoids an entry per keystroke; an empty term drops the param.
  const onSearchChange = (value: string) => {
    setSearch(value)
    void navigate({
      search: (prev) => ({ ...prev, q: value || undefined }),
      replace: true,
    })
  }

  // Mirror the active tag set to the URL (?tags=…), dropping the param when empty.
  const syncTags = (next: string[]) =>
    void navigate({
      search: (s) => ({ ...s, tags: next.length ? next : undefined }),
      replace: true,
    })

  // Toggle a tag in/out of the active filter and mirror the result to the URL.
  const onToggleTag = (tag: string) => {
    setActiveTags((prev) => {
      const next = prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : [...prev, tag]
      syncTags(next)
      return next
    })
  }

  const clearTags = () => {
    setActiveTags([])
    syncTags([])
  }

  const onSortChange = (value: SortKey) => {
    setSort(value)
    void navigate({
      search: (s) => ({ ...s, sort: value === 'rating' ? undefined : value }),
      replace: true,
    })
  }

  const recipesKey = recipesQueryOptions().queryKey

  const onListCount = recipes.filter((r) => r.inShoppingList).length

  // Every tag in use across the household's recipes, deduped and sorted, so the
  // filter row offers the full vocabulary regardless of the current search.
  const allTags = useMemo(() => {
    const seen = new Set<string>()
    for (const r of recipes) for (const t of r.tags) seen.add(t)
    return [...seen].sort((a, b) => a.localeCompare(b, 'nb'))
  }, [recipes])

  // The default meal-type tags get their own prominent section in the filter;
  // everything else follows below. Meal tags keep their canonical order.
  const mealTags = useMemo(
    () => MEAL_TAGS.filter((t) => allTags.includes(t)),
    [allTags],
  )
  const otherTags = useMemo(() => allTags.filter((t) => !isMealTag(t)), [allTags])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matched = recipes.filter((r) => {
      const matchesTerm =
        !term ||
        r.title.toLowerCase().includes(term) ||
        (r.description?.toLowerCase().includes(term) ?? false) ||
        r.tags.some((t) => t.toLowerCase().includes(term))
      // A recipe must carry every selected tag (AND) to survive the filter.
      const matchesTags = activeTags.every((t) => r.tags.includes(t))
      return matchesTerm && matchesTags
    })
    // Recipes already on the shopping list float to the top; within each group
    // the chosen sort applies. Toggling a recipe on/off the list re-sorts it
    // live via the optimistic update.
    return [...matched].sort(
      (a, b) =>
        Number(b.inShoppingList) - Number(a.inShoppingList) ||
        SORT_COMPARATORS[sort](a, b),
    )
  }, [recipes, search, activeTags, sort])

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
        <NewRecipeMenu />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Søk på tittel, beskrivelse eller etikett…"
            className="w-full rounded-lg border border-stone-300 bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          aria-label="Sorter oppskrifter"
          className="shrink-0 rounded-lg border border-stone-300 bg-white py-2 pr-8 pl-3 text-sm text-stone-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {allTags.length > 0 && (
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className={[
              'inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
              showFilters || activeTags.length > 0
                ? 'border-brand-500 bg-brand-50 text-brand-700'
                : 'border-stone-300 bg-white text-stone-600 hover:bg-stone-50',
            ].join(' ')}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtrer
            {activeTags.length > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-on-brand">
                {activeTags.length}
              </span>
            )}
          </button>
        )}
        {recipes.length > 0 && (
          <Button
            variant="secondary"
            onPress={() => setMealPlanOpen(true)}
            className="shrink-0"
          >
            <Dices className="h-4 w-4" />
            Trekk oppskrifter
          </Button>
        )}
      </div>

      {/* The full tag vocabulary lives in this collapsible panel so it never
          crowds the list. Selected tags below stay visible even when closed. */}
      {allTags.length > 0 && showFilters && (
        <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
          {mealTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-stone-400">
                Måltid
              </span>
              {mealTags.map((tag) => {
                const active = activeTags.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => onToggleTag(tag)}
                    aria-pressed={active}
                    className={[
                      'rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition-colors',
                      active
                        ? 'bg-brand-600 text-on-brand hover:bg-brand-700'
                        : 'bg-white text-brand-700 ring-1 ring-brand-300 hover:bg-brand-50',
                    ].join(' ')}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
          )}
          {mealTags.length > 0 && otherTags.length > 0 && (
            <hr className="border-stone-200" />
          )}
          {otherTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {otherTags.map((tag) => {
                const active = activeTags.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => onToggleTag(tag)}
                    aria-pressed={active}
                    className={[
                      'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'bg-brand-600 text-on-brand hover:bg-brand-700'
                        : 'bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-100',
                    ].join(' ')}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {activeTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onToggleTag(tag)}
              className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-800 hover:bg-brand-200"
              aria-label={`Fjern filter ${tag}`}
            >
              {tag}
              <X className="h-3.5 w-3.5" />
            </button>
          ))}
          <button
            type="button"
            onClick={clearTags}
            className="text-xs font-medium text-stone-500 underline hover:text-stone-700"
          >
            Nullstill
          </button>
        </div>
      )}

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

      <MealPlanModal
        isOpen={mealPlanOpen}
        onOpenChange={(open) => {
          setMealPlanOpen(open)
          if (!open) syncDraw([]) // closing the dialog drops the persisted draw
        }}
        recipes={recipes}
        allTags={allTags}
        initialDrawIds={initialDraw}
        onDrawChange={syncDraw}
        onToggleShopping={toggleShopping}
      />
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
                ? 'bg-brand-600 text-on-brand hover:bg-brand-700'
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
