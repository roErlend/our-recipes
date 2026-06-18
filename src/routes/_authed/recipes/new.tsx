import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'

import {
  RecipeForm,
  type RecipeSubmitValues,
} from '@/components/RecipeForm'
import { createRecipe } from '@/server/recipes'

export const Route = createFileRoute('/_authed/recipes/new')({
  component: NewRecipePage,
})

function NewRecipePage() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(values: RecipeSubmitValues) {
    setPending(true)
    setError(null)
    try {
      const created = await createRecipe({ data: values })
      await router.invalidate()
      router.navigate({
        to: '/recipes/$recipeId',
        params: { recipeId: created.id },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save recipe')
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/recipes"
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to recipes
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-stone-900">New recipe</h1>
        <p className="text-sm text-stone-500">
          Write your own, or just paste a link to one you love.
        </p>
      </div>

      <RecipeForm
        submitLabel="Save recipe"
        pending={pending}
        error={error}
        onSubmit={handleSubmit}
        onCancel={() => router.navigate({ to: '/recipes' })}
      />
    </div>
  )
}
