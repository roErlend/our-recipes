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
  Trash2,
  Users,
} from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import {
  recipeQueryOptions,
  recipesQueryOptions,
  shoppingQueryOptions,
} from '@/lib/queries'
import {
  type RecipeDetail,
  deleteRecipe,
  setRecipeActive,
} from '@/server/recipes'

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

function RecipeDetailPage() {
  const { recipeId } = Route.useParams()
  const queryClient = useQueryClient()
  const router = useRouter()
  const { data: recipe } = useSuspenseQuery(recipeQueryOptions(recipeId))
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const recipeKey = recipeQueryOptions(recipeId).queryKey

  const activeMutation = useMutation({
    mutationFn: (checked: boolean) =>
      setRecipeActive({ data: { id: recipeId, isActive: checked } }),
    onMutate: async (checked) => {
      await queryClient.cancelQueries({ queryKey: recipeKey })
      const previous = queryClient.getQueryData<RecipeDetail | null>(recipeKey)
      if (previous) {
        queryClient.setQueryData<RecipeDetail>(recipeKey, {
          ...previous,
          isActive: checked,
        })
      }
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined)
        queryClient.setQueryData(recipeKey, ctx.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: recipesQueryOptions().queryKey })
      queryClient.invalidateQueries({ queryKey: shoppingQueryOptions().queryKey })
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

  const toggleActive = (checked: boolean) => activeMutation.mutate(checked)
  const handleDelete = () => deleteMutation.mutate()
  const deleting = deleteMutation.isPending

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
            <h1 className="text-3xl font-bold text-stone-900">{recipe.title}</h1>
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
          <label className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 shadow-sm">
            <Checkbox isSelected={recipe.isActive} onChange={toggleActive}>
              Aktiv denne uken
            </Checkbox>
          </label>
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

      {recipe.imageUrl && (
        <img
          src={recipe.imageUrl}
          alt={recipe.title}
          className="max-h-96 w-full rounded-2xl object-cover"
        />
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
            <h2 className="mb-3 text-lg font-semibold text-stone-900">
              Ingredienser
            </h2>
            <ul className="flex flex-col gap-2">
              {recipe.ingredients.map((ing) => {
                const amount = formatQuantity(ing.quantity, ing.unit)
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
    </article>
  )
}
