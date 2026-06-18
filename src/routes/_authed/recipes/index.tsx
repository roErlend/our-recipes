import { useMemo, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ExternalLink, Plus, Search, UtensilsCrossed } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import {
  type RecipeListItem,
  listRecipes,
  setRecipeActive,
} from '@/server/recipes'

export const Route = createFileRoute('/_authed/recipes/')({
  loader: () => listRecipes(),
  component: RecipesPage,
})

function RecipesPage() {
  const recipes = Route.useLoaderData()
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)

  const activeCount = recipes.filter((r) => r.isActive).length

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return recipes.filter((r) => {
      if (activeOnly && !r.isActive) return false
      if (!term) return true
      return (
        r.title.toLowerCase().includes(term) ||
        (r.description?.toLowerCase().includes(term) ?? false) ||
        r.tags.some((t) => t.toLowerCase().includes(term))
      )
    })
  }, [recipes, search, activeOnly])

  async function toggleActive(id: string, isActive: boolean) {
    await setRecipeActive({ data: { id, isActive } })
    router.invalidate()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Recipes</h1>
          <p className="text-sm text-stone-500">
            {recipes.length} saved · {activeCount} active this week
          </p>
        </div>
        <Link to="/recipes/new">
          <Button>
            <Plus className="h-4 w-4" />
            New recipe
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[16rem]">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, description or tag…"
            className="w-full rounded-lg border border-stone-300 bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
        <Button
          variant={activeOnly ? 'primary' : 'secondary'}
          onPress={() => setActiveOnly((v) => !v)}
        >
          Active only
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState hasRecipes={recipes.length > 0} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onToggleActive={toggleActive}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function RecipeCard({
  recipe,
  onToggleActive,
}: {
  recipe: RecipeListItem
  onToggleActive: (id: string, isActive: boolean) => void
}) {
  return (
    <li className="group relative flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <Link
          to="/recipes/$recipeId"
          params={{ recipeId: recipe.id }}
          className="flex-1"
        >
          <h2 className="font-semibold text-stone-900 group-hover:text-brand-700">
            {recipe.title}
          </h2>
          {recipe.description && (
            <p className="mt-1 line-clamp-2 text-sm text-stone-500">
              {recipe.description}
            </p>
          )}
        </Link>
        <Checkbox
          isSelected={recipe.isActive}
          onChange={(checked) => onToggleActive(recipe.id, checked)}
          aria-label={`Mark ${recipe.title} active this week`}
        />
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <span className="inline-flex items-center gap-1">
          <UtensilsCrossed className="h-3.5 w-3.5" />
          {recipe.ingredientCount} ingredient
          {recipe.ingredientCount === 1 ? '' : 's'}
        </span>
        {recipe.sourceUrl && (
          <a
            href={recipe.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-brand-600 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Source
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
          ? 'No recipes match your filters.'
          : 'No recipes yet — add your first one!'}
      </p>
      {!hasRecipes && (
        <Link to="/recipes/new">
          <Button>
            <Plus className="h-4 w-4" />
            New recipe
          </Button>
        </Link>
      )}
    </div>
  )
}
