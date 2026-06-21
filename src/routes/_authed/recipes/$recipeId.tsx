import { useState } from 'react'
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import {
  ChevronLeft,
  ExternalLink,
  Pencil,
  Star,
  Trash2,
  Users,
} from 'lucide-react'

import { AddToShoppingMenu } from '@/components/AddToShoppingMenu'
import { Button } from '@/components/ui/Button'
import { StarRating } from '@/components/StarRating'
import {
  recipeQueryOptions,
  recipesQueryOptions,
  shoppingQueryOptions,
} from '@/lib/queries'
import {
  type RecipeDetail,
  deleteRecipe,
  removeRecipeRating,
  setRecipeRating,
} from '@/server/recipes'

/** "7,7" — one decimal, Norwegian comma. */
function formatAvg(avg: number) {
  return avg.toFixed(1).replace('.', ',')
}

export const Route = createFileRoute('/_authed/recipes/$recipeId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(recipeQueryOptions(params.recipeId)),
  component: RecipeDetailPage,
})

function formatQuantity(quantity: number | null, unit: string | null) {
  if (quantity == null && !unit) return null
  const qty = quantity == null ? '' : `${+quantity.toFixed(2)}`
  return [qty, unit].filter(Boolean).join(' ')
}

/** Group ingredients by their `component` label, preserving first-appearance
 *  order (already sorted by sortOrder). Ungrouped ingredients share the `""` key. */
function groupByComponent(ingredients: RecipeDetail['ingredients']) {
  const groups: { component: string; items: RecipeDetail['ingredients'] }[] = []
  const byKey = new Map<string, (typeof groups)[number]>()
  for (const ing of ingredients) {
    const key = ing.component?.trim() || ''
    let group = byKey.get(key)
    if (!group) {
      group = { component: key, items: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.items.push(ing)
  }
  return groups
}

function RecipeDetailPage() {
  const { recipeId } = Route.useParams()
  const queryClient = useQueryClient()
  const router = useRouter()
  const { data: recipe } = useSuspenseQuery(recipeQueryOptions(recipeId))
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Target portion count, shared between the "add to list" stepper and the
  // ingredient amounts below so they scale together. Seeded to the recipe's base
  // and re-seeded when navigating to a different recipe (the route component is
  // reused across param changes, so state would otherwise carry over).
  const baseServings = recipe?.servings ?? null
  const [servings, setServings] = useState(baseServings ?? 1)
  const [seededFor, setSeededFor] = useState(recipeId)
  if (seededFor !== recipeId) {
    setSeededFor(recipeId)
    setServings(baseServings ?? 1)
  }
  const scale = baseServings != null ? servings / baseServings : 1

  const recipeKey = recipeQueryOptions(recipeId).queryKey

  const ratingMutation = useMutation({
    mutationFn: (score: number) =>
      score === 0
        ? removeRecipeRating({ data: { recipeId } })
        : setRecipeRating({ data: { recipeId, score } }),
    onMutate: async (score) => {
      // Optimistically fill the user's own stars; the aggregate + others list
      // refresh on settle.
      await queryClient.cancelQueries({ queryKey: recipeKey })
      const previous = queryClient.getQueryData<RecipeDetail | null>(recipeKey)
      if (previous) {
        queryClient.setQueryData<RecipeDetail>(recipeKey, {
          ...previous,
          myScore: score === 0 ? null : score,
        })
      }
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined)
        queryClient.setQueryData(recipeKey, ctx.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: recipeKey })
      // Ratings drive the overview's default order — refresh that too.
      queryClient.invalidateQueries({ queryKey: recipesQueryOptions().queryKey })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteRecipe({ data: recipeId }),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: recipeKey })
      await queryClient.invalidateQueries({
        queryKey: recipesQueryOptions().queryKey,
      })
      queryClient.invalidateQueries({ queryKey: shoppingQueryOptions().queryKey })
      router.navigate({ to: '/recipes' })
    },
  })

  if (!recipe) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-stone-600">Fant ikke denne oppskriften.</p>
        <Link to="/recipes">
          <Button variant="secondary">Tilbake til oppskrifter</Button>
        </Link>
      </div>
    )
  }

  const handleDelete = () => deleteMutation.mutate()
  const deleting = deleteMutation.isPending
  const imageSrc = recipe.uploadedImageUrl ?? recipe.imageUrl

  return (
    <article className="flex flex-col gap-6">
      <Link
        to="/recipes"
        className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800"
      >
        <ChevronLeft className="h-4 w-4" />
        Tilbake til oppskrifter
      </Link>

      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-3xl font-bold text-stone-900">
                {recipe.title}
              </h1>
              {recipe.ratingCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-amber-700 ring-1 ring-amber-200">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  <span className="text-lg font-bold leading-none">
                    {formatAvg(recipe.ratingAvg)}
                  </span>
                  <span className="text-xs text-amber-600">
                    av 10 · {recipe.ratingCount}{' '}
                    {recipe.ratingCount === 1 ? 'stemme' : 'stemmer'}
                  </span>
                </span>
              ) : (
                <span className="text-sm text-stone-400">
                  Ingen vurderinger ennå
                </span>
              )}
            </div>
            {recipe.description && (
              <p className="mt-2 max-w-2xl text-stone-600">
                {recipe.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link to="/recipes/$recipeId/edit" params={{ recipeId: recipe.id }}>
              <Button variant="secondary" size="sm">
                <Pencil className="h-4 w-4" />
                Rediger
              </Button>
            </Link>
            {confirmingDelete ? (
              <Button
                variant="danger"
                size="sm"
                isDisabled={deleting}
                onPress={handleDelete}
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? 'Sletter…' : 'Bekreft sletting'}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onPress={() => setConfirmingDelete(true)}
              >
                <Trash2 className="h-4 w-4" />
                Slett
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {recipe.ingredients.length > 0 ? (
            <AddToShoppingMenu
              recipe={recipe}
              servings={servings}
              onServingsChange={setServings}
            />
          ) : null}
          {!recipe.isOwner && recipe.ownerName && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800">
              <Users className="h-4 w-4" />
              Delt av {recipe.ownerName}
            </span>
          )}
          {recipe.servings != null && (
            <span className="inline-flex items-center gap-1.5 text-sm text-stone-600">
              <Users className="h-4 w-4 text-stone-400" />
              {recipe.servings} porsjoner
            </span>
          )}
          {recipe.sourceUrl && (
            <a
              href={recipe.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              Se original oppskrift
            </a>
          )}
        </div>

        {recipe.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {recipe.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-brand-100 px-3 py-1 text-sm font-medium text-brand-800"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>

      {imageSrc && (
        // Full-width banner at a fixed aspect ratio. The image itself is shown
        // whole (object-contain, never cropped/zoomed); a blurred, scaled copy
        // of the same image fills the letterbox area behind it so the frame
        // always looks intentional regardless of the image's shape.
        <div className="relative aspect-[16/9] max-h-96 w-full overflow-hidden rounded-2xl bg-stone-100">
          <img
            src={imageSrc}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl"
          />
          <img
            src={imageSrc}
            alt={recipe.title}
            className="relative h-full w-full object-contain"
          />
        </div>
      )}

      <div
        className={
          recipe.ingredients.length > 0
            ? 'grid grid-cols-1 gap-6 lg:grid-cols-[20rem_1fr]'
            : 'grid grid-cols-1 gap-6'
        }
      >
        {recipe.ingredients.length > 0 && (
          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 flex flex-wrap items-baseline gap-x-2 text-lg font-semibold text-stone-900">
              Ingredienser
              {scale !== 1 && (
                <span className="text-sm font-normal text-stone-400">
                  for {servings} porsjoner
                </span>
              )}
            </h2>
            <div className="flex flex-col gap-4">
              {groupByComponent(recipe.ingredients).map((group) => (
                <div key={group.component || '__none'}>
                  {group.component && (
                    <h3 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
                      {group.component}
                    </h3>
                  )}
                  <ul className="flex flex-col gap-2">
                    {group.items.map((ing) => {
                      const amount = formatQuantity(
                        ing.quantity == null ? null : ing.quantity * scale,
                        ing.unit,
                      )
                      return (
                        <li
                          key={ing.id}
                          className="flex items-baseline gap-2 border-b border-stone-100 pb-2 text-sm last:border-0"
                        >
                          {amount && (
                            <span className="font-medium text-stone-900">
                              {amount}
                            </span>
                          )}
                          <span className="text-stone-700">{ing.name}</span>
                          {ing.note && (
                            <span className="text-stone-400">({ing.note})</span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {recipe.instructions ? (
          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-stone-900">
              Fremgangsmåte
            </h2>
            <div className="prose prose-stone max-w-none whitespace-pre-wrap text-stone-700">
              {recipe.instructions}
            </div>
          </section>
        ) : (
          !recipe.ingredients.length && (
            <section className="rounded-2xl border border-dashed border-stone-300 bg-white/50 p-8 text-center text-stone-500">
              Dette er en lenket oppskrift – åpne originalen ovenfor for hele
              fremgangsmåten.
            </section>
          )
        )}
      </div>

      <section className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Vurderinger</h2>
          <p className="text-sm text-stone-500">
            Gi 1–10 stjerner. Alle i husholdningen teller med i snittet.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="w-28 text-sm font-medium text-stone-700">
            Din vurdering
          </span>
          <StarRating
            value={recipe.myScore ?? 0}
            onChange={(score) => ratingMutation.mutate(score)}
            label="Din vurdering"
          />
          <span className="text-sm text-stone-400">
            {recipe.myScore
              ? `${recipe.myScore}/10 · trykk samme stjerne for å fjerne`
              : 'Trykk for å gi poeng'}
          </span>
        </div>

        {recipe.ratings.length > 0 && (
          <ul className="flex flex-col gap-2 border-t border-stone-100 pt-3">
            {recipe.ratings.map((r) => (
              <li
                key={r.userId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1"
              >
                <span className="w-28 truncate text-sm text-stone-700">
                  {r.name}
                  {r.isMe && (
                    <span className="ml-1 text-xs text-stone-400">(deg)</span>
                  )}
                </span>
                <StarRating value={r.score} size="sm" />
                <span className="text-sm font-medium text-stone-500">
                  {r.score}/10
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  )
}
