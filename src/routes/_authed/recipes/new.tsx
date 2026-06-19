import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'

import {
  RecipeForm,
  type RecipeFormValues,
  type RecipeSubmitValues,
} from '@/components/RecipeForm'
import { RECIPE_IMPORT_KEY } from '@/components/NewRecipeMenu'
import { recipesQueryOptions } from '@/lib/queries'
import { createRecipe } from '@/server/recipes'

export const Route = createFileRoute('/_authed/recipes/new')({
  component: NewRecipePage,
})

/** One-shot read of a recipe handed off from the "Importer fra JSON" flow. Runs
 *  on the client only (the import always arrives via client-side navigation). */
function takeImportedRecipe(): RecipeFormValues | undefined {
  if (typeof window === 'undefined') return undefined
  const raw = window.sessionStorage.getItem(RECIPE_IMPORT_KEY)
  if (!raw) return undefined
  window.sessionStorage.removeItem(RECIPE_IMPORT_KEY)
  try {
    return JSON.parse(raw) as RecipeFormValues
  } catch {
    return undefined
  }
}

function NewRecipePage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imported] = useState(takeImportedRecipe)

  async function handleSubmit(values: RecipeSubmitValues) {
    setPending(true)
    setError(null)
    try {
      const created = await createRecipe({ data: values })
      await queryClient.invalidateQueries({
        queryKey: recipesQueryOptions().queryKey,
      })
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
          {imported
            ? 'Importert fra JSON – se over og lagre.'
            : 'Skriv din egen, eller lim inn en lenke til en du er glad i.'}
        </p>
      </div>

      <RecipeForm
        initialValues={imported}
        submitLabel="Lagre oppskrift"
        pending={pending}
        error={error}
        onSubmit={handleSubmit}
        onCancel={() => router.navigate({ to: '/recipes' })}
      />
    </div>
  )
}
