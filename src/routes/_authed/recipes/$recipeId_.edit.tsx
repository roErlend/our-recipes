import { useState } from 'react'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'

import {
  RecipeForm,
  type RecipeFormValues,
  type RecipeSubmitValues,
} from '@/components/RecipeForm'
import {
  recipeQueryOptions,
  recipesQueryOptions,
  shoppingQueryOptions,
} from '@/lib/queries'
import { updateRecipe } from '@/server/recipes'

export const Route = createFileRoute('/_authed/recipes/$recipeId_/edit')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(recipeQueryOptions(params.recipeId)),
  component: EditRecipePage,
})

function EditRecipePage() {
  const { recipeId } = Route.useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: recipe } = useSuspenseQuery(recipeQueryOptions(recipeId))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!recipe) {
    return (
      <div className="py-16 text-center text-stone-600">
        Fant ikke oppskriften.{' '}
        <Link to="/recipes" className="text-brand-700 hover:underline">
          Tilbake til oppskrifter
        </Link>
      </div>
    )
  }

  const initialValues: RecipeFormValues = {
    title: recipe.title,
    description: recipe.description ?? '',
    sourceUrl: recipe.sourceUrl ?? '',
    imageUrl: recipe.imageUrl ?? '',
    instructions: recipe.instructions ?? '',
    servings: recipe.servings != null ? String(recipe.servings) : '',
    tags: recipe.tags,
    ingredients:
      recipe.ingredients.length > 0
        ? recipe.ingredients.map((i) => ({
            name: i.name,
            quantity: i.quantity != null ? String(i.quantity) : '',
            unit: i.unit ?? '',
            note: i.note ?? '',
          }))
        : [{ name: '', quantity: '', unit: '', note: '' }],
  }

  async function handleSubmit(values: RecipeSubmitValues) {
    setPending(true)
    setError(null)
    try {
      await updateRecipe({ data: { id: recipeId, ...values } })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: recipeQueryOptions(recipeId).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: recipesQueryOptions().queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: shoppingQueryOptions().queryKey,
        }),
      ])
      router.navigate({
        to: '/recipes/$recipeId',
        params: { recipeId },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke lagre oppskriften')
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/recipes/$recipeId"
          params={{ recipeId: recipe.id }}
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800"
        >
          <ChevronLeft className="h-4 w-4" />
          Tilbake til oppskriften
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-stone-900">
          Rediger oppskrift
        </h1>
      </div>

      <RecipeForm
        initialValues={initialValues}
        submitLabel="Lagre endringer"
        pending={pending}
        error={error}
        onSubmit={handleSubmit}
        onCancel={() =>
          router.navigate({
            to: '/recipes/$recipeId',
            params: { recipeId: recipe.id },
          })
        }
      />
    </div>
  )
}
