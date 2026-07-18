import { useState } from 'react'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ChevronLeft, FileJson } from 'lucide-react'

import {
  RecipeForm,
  type RecipeFormValues,
  type RecipeSubmitValues,
} from '@/components/RecipeForm'
import { RecipeImportModal } from '@/components/RecipeImportModal'
import { Button } from '@/components/ui/Button'
import {
  ingredientsQueryOptions,
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
  const [importing, setImporting] = useState(false)
  // A recipe imported from JSON that overwrites the form. `importKey` bumps on
  // each import so RecipeForm remounts and picks up the new values.
  const [imported, setImported] = useState<RecipeFormValues | null>(null)
  const [importKey, setImportKey] = useState(0)

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
    uploadedImageUrl: recipe.uploadedImageUrl,
    instructions: recipe.instructions ?? '',
    servings: recipe.servings != null ? String(recipe.servings) : '',
    servingsOverride:
      recipe.servingsOverride != null ? String(recipe.servingsOverride) : '',
    tags: recipe.tags,
    ingredients:
      recipe.ingredients.length > 0
        ? recipe.ingredients.map((i) => ({
            name: i.name,
            quantity: i.quantity != null ? String(i.quantity) : '',
            unit: i.unit ?? '',
            note: i.note ?? '',
            component: i.component ?? '',
          }))
        : [{ name: '', quantity: '', unit: '', note: '', component: '' }],
  }

  function onImport(values: RecipeFormValues) {
    // Overwrite the form with the JSON, but keep the existing image when the
    // imported recipe doesn't bring its own (avoid silently dropping it).
    const hasJsonImage = values.imageUrl.trim() !== ''
    setImported({
      ...values,
      imageUrl: hasJsonImage ? values.imageUrl : recipe!.imageUrl ?? '',
      uploadedImageUrl: hasJsonImage ? null : recipe!.uploadedImageUrl,
      // Imports never carry a display override — keep the recipe's own.
      servingsOverride:
        recipe!.servingsOverride != null ? String(recipe!.servingsOverride) : '',
    })
    setImportKey((k) => k + 1)
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
        // New ingredients may have joined the catalog — refresh autocomplete.
        queryClient.invalidateQueries({
          queryKey: ingredientsQueryOptions().queryKey,
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
      <div className="flex items-start justify-between gap-4">
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
          {imported && (
            <p className="text-sm text-stone-500">
              Overskrevet fra JSON – se over og lagre.
            </p>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onPress={() => setImporting(true)}
          className="mt-1 shrink-0"
        >
          <FileJson className="h-4 w-4" />
          Importer fra JSON
        </Button>
      </div>

      <RecipeForm
        key={importKey}
        initialValues={imported ?? initialValues}
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

      <RecipeImportModal
        isOpen={importing}
        onOpenChange={setImporting}
        onImport={onImport}
        title="Overskriv oppskrift med JSON"
        description={
          <>
            Lim inn JSON fra <code>/recipe-url-to-json</code>. Feltene under
            erstattes med innholdet – du lagrer selv etterpå.
          </>
        }
      />
    </div>
  )
}
