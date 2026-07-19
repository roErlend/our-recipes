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
  RotateCcw,
  Star,
  Trash2,
  Users,
} from 'lucide-react'

import { AddToShoppingMenu } from '@/components/AddToShoppingMenu'
import { InstructionsSection } from '@/components/InstructionsSection'
import { ServingsStepper, formatServings } from '@/components/ServingsStepper'
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

/**
 * A tappable ingredient amount: tap it, type the amount you actually have
 * (600 g in the recipe but only 400 g in the fridge → type 400), and the whole
 * recipe rescales around that ingredient. `quantity` is the written (base)
 * amount; the shown amount applies the current scale.
 */
function ScalableAmount({
  quantity,
  unit,
  scale,
  name,
  onScale,
}: {
  quantity: number
  unit: string | null
  scale: number
  name: string
  onScale: (scale: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const shown = +(quantity * scale).toFixed(2)

  const commit = () => {
    setEditing(false)
    const v = Number(draft.trim().replace(',', '.'))
    // Ignore empty/invalid input; cap the factor at the server's limit.
    if (!Number.isFinite(v) || v <= 0) return
    onScale(Math.min(100, v / quantity))
  }

  if (editing) {
    return (
      <span className="inline-flex items-baseline gap-1">
        <input
          autoFocus
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') setEditing(false)
          }}
          aria-label={`Mengde ${name}`}
          className="w-16 rounded border border-brand-400 bg-white px-1 text-sm font-medium text-stone-900 outline-none focus:ring-2 focus:ring-brand-500/30"
        />
        {unit && <span className="font-medium text-stone-900">{unit}</span>}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(String(shown).replace('.', ','))
        setEditing(true)
      }}
      title="Trykk for å skalere hele oppskriften etter denne mengden"
      className="cursor-pointer rounded font-medium text-stone-900 underline decoration-stone-300 decoration-dotted underline-offset-4 hover:decoration-brand-500"
    >
      {formatQuantity(shown, unit)}
    </button>
  )
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

  // One scale factor drives every ingredient amount and the shopping-add, set
  // either by the portion stepper (n / base) or by anchoring on an ingredient
  // (typed amount / written amount). Seeded to the recipe's display override
  // when it has one, and re-seeded when navigating to a different recipe (the
  // route component is reused across param changes, so state would otherwise
  // carry over).
  const baseServings = recipe?.servings ?? null
  const defaultServings = recipe?.servingsOverride ?? baseServings
  const defaultScale =
    baseServings != null && defaultServings != null
      ? defaultServings / baseServings
      : 1
  const [scale, setScale] = useState(defaultScale)
  const [seededFor, setSeededFor] = useState(recipeId)
  if (seededFor !== recipeId) {
    setSeededFor(recipeId)
    setScale(defaultScale)
  }
  const servings = baseServings != null ? baseServings * scale : null

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

      <header className="flex flex-col gap-5 sm:gap-4">
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
          {/* Rediger left, source link pushed to the right edge — far enough
              apart that neither catches a tap meant for the other. (Delete
              lives at the bottom of the page.) */}
          <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-start">
            <Link to="/recipes/$recipeId/edit" params={{ recipeId: recipe.id }}>
              <Button variant="secondary" size="sm">
                <Pencil className="h-4 w-4" />
                Rediger
              </Button>
            </Link>
          {recipe.ingredients.length > 0 ? (
            <AddToShoppingMenu recipe={recipe} scale={scale} />
          ) : null}
          </div>
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

        {/* Roomier vertical rhythm when the actions stack on mobile. The
            servings control lives with the ingredient list it scales. */}
{recipe.sourceUrl && (
              <a
                href={recipe.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 py-1.5 text-sm font-medium text-brand-700 hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                Se original oppskrift
              </a>
            )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-5">
          {!recipe.isOwner && recipe.ownerName && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800">
              <Users className="h-4 w-4" />
              Delt av {recipe.ownerName}
            </span>
          )}
        </div>
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
              {/* The stepper below shows the count for recipes with a base;
                  this hint covers base-less recipes scaled via an ingredient. */}
              {servings == null && scale !== 1 && (
                <span className="text-sm font-normal text-stone-400">
                  skalert ×{formatServings(scale)}
                </span>
              )}
              {/* Recipes without a base portion count have no stepper, so give
                  an anchored scaling its own way back to the written amounts. */}
              {servings == null && scale !== 1 && (
                <button
                  type="button"
                  onClick={() => setScale(1)}
                  aria-label="Tilbakestill til oppskriftens mengder"
                  title="Tilbakestill til oppskriftens mengder"
                  className="self-center rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
            </h2>
            {baseServings != null && defaultServings != null && servings != null && (
              <div className="mb-4">
                <ServingsStepper
                  defaultServings={defaultServings}
                  servings={servings}
                  onServingsChange={(n) => setScale(n / baseServings)}
                />
              </div>
            )}
            <div className="flex flex-col gap-4">
              {groupByComponent(recipe.ingredients).map((group) => (
                <div key={group.component || '__none'}>
                  {group.component && (
                    <h3 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
                      {group.component}
                    </h3>
                  )}
                  <ul className="flex flex-col gap-2">
                    {group.items.map((ing) => (
                      <li
                        key={ing.id}
                        className="flex items-baseline gap-2 border-b border-stone-100 pb-2 text-sm last:border-0"
                      >
                        {ing.quantity != null ? (
                          <ScalableAmount
                            quantity={ing.quantity}
                            unit={ing.unit}
                            scale={scale}
                            name={ing.name}
                            onScale={setScale}
                          />
                        ) : (
                          formatQuantity(null, ing.unit) && (
                            <span className="font-medium text-stone-900">
                              {formatQuantity(null, ing.unit)}
                            </span>
                          )
                        )}
                        <span className="text-stone-700">{ing.name}</span>
                        {ing.note && (
                          <span className="text-stone-400">({ing.note})</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {recipe.instructions ? (
          <InstructionsSection instructions={recipe.instructions} />
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

      {/* Deletion lives at the very bottom, far from the everyday actions,
          with the same two-step confirm as before. */}
      <div className="flex items-center justify-end gap-2">
        {confirmingDelete ? (
          <>
            <span className="text-sm text-stone-600">Slette oppskriften?</span>
            <Button
              variant="danger"
              size="sm"
              isDisabled={deleting}
              onPress={handleDelete}
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? 'Sletter…' : 'Bekreft sletting'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={deleting}
              onPress={() => setConfirmingDelete(false)}
            >
              Avbryt
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-stone-400 hover:text-red-600"
            onPress={() => setConfirmingDelete(true)}
          >
            <Trash2 className="h-4 w-4" />
            Slett oppskriften
          </Button>
        )}
      </div>
    </article>
  )
}
