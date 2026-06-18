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
      setError(err instanceof Error ? err.message : 'Kunne ikke lagre oppskriften')
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
          Tilbake til oppskrifter
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-stone-900">Ny oppskrift</h1>
        <p className="text-sm text-stone-500">
          Skriv din egen, eller lim inn en lenke til en du er glad i.
        </p>
      </div>

      <RecipeForm
        submitLabel="Lagre oppskrift"
        pending={pending}
        error={error}
        onSubmit={handleSubmit}
        onCancel={() => router.navigate({ to: '/recipes' })}
      />
    </div>
  )
}
