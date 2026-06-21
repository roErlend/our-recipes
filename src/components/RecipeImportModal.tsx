import { useState } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'

import { Button } from '@/components/ui/Button'
import { parseRecipeImport, type RecipeFormValues } from '@/components/RecipeForm'

/**
 * A complete, valid example shown by the "Vis eksempel" button so it's obvious
 * what the JSON should look like — fields, metric units, `component` grouping,
 * and a numbered `instructions` string. Mirrors the `recipe-url-to-json` output.
 */
const EXAMPLE_RECIPE = {
  title: 'Kylling Shawarma',
  description: 'Marinert kylling med hvitløksaus, servert i pitabrød.',
  sourceUrl: '',
  imageUrl: null,
  servings: 4,
  instructions:
    '1. Bland alt til marinaden og vend inn kyllingen. La stå minst 1 time (gjerne over natten).\n' +
    '2. Stek kyllingen i en varm panne til den er gjennomstekt og får fin farge. Skjær i strimler.\n' +
    '3. Rør sammen hvitløksaus av yoghurt, hvitløk, sitron og olivenolje. Smak til med salt.\n' +
    '4. Varm pitabrødene. Fyll med kylling, grønnsaker og hvitløksaus.',
  tags: ['middag', 'kylling', 'midtøsten'],
  ingredients: [
    { name: 'Kyllinglårfilet', quantity: 600, unit: 'g', component: 'Kylling' },
    { name: 'Olivenolje', quantity: 2, unit: 'ss', component: 'Kylling' },
    { name: 'Hvitløk', quantity: 2, unit: 'fedd', note: 'finhakket', component: 'Kylling' },
    { name: 'Sitron', quantity: 0.5, unit: 'stk', note: 'saften', component: 'Kylling' },
    { name: 'Spisskummen', quantity: 1, unit: 'ts', component: 'Kylling' },
    { name: 'Paprikakrydder', quantity: 1, unit: 'ts', component: 'Kylling' },
    { name: 'Salt', component: 'Kylling' },
    { name: 'Gresk yoghurt', quantity: 1.5, unit: 'dl', component: 'Hvitløksaus' },
    { name: 'Hvitløk', quantity: 1, unit: 'fedd', note: 'revet', component: 'Hvitløksaus' },
    { name: 'Sitron', quantity: 0.5, unit: 'stk', note: 'saften', component: 'Hvitløksaus' },
    { name: 'Olivenolje', quantity: 1, unit: 'ss', component: 'Hvitløksaus' },
    { name: 'Pitabrød', quantity: 4, unit: 'stk', component: 'Servering' },
    { name: 'Tomat', quantity: 2, unit: 'stk', note: 'i båter', component: 'Servering' },
    { name: 'Rødløk', quantity: 1, unit: 'stk', note: 'tynt skåret', component: 'Servering' },
    { name: 'Salat', component: 'Servering' },
  ],
}

const EXAMPLE_RECIPE_JSON = JSON.stringify(EXAMPLE_RECIPE, null, 2)

/**
 * A paste-JSON dialog that parses a full recipe (from the `recipe-url-to-json`
 * skill) into form values. Shared by the "Ny oppskrift" menu (create) and the
 * edit page (overwrite) — both just take the parsed values via `onImport`.
 */
export function RecipeImportModal({
  isOpen,
  onOpenChange,
  onImport,
  title = 'Importer oppskrift fra JSON',
  description,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onImport: (values: RecipeFormValues) => void
  title?: string
  description?: React.ReactNode
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setText('')
      setError(null)
    }
    onOpenChange(open)
  }

  const submit = () => {
    const result = parseRecipeImport(text)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onImport(result.values)
    handleOpenChange(false)
  }

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      isDismissable
      className="fixed inset-0 z-30 flex items-start justify-center bg-stone-900/30 p-4 pt-[10vh] backdrop-blur-sm"
    >
      <Modal className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl outline-none">
        <Dialog className="outline-none">
          <Heading slot="title" className="text-lg font-semibold text-stone-900">
            {title}
          </Heading>
          <p className="mt-1 text-sm text-stone-500">
            {description ?? (
              <>
                Lim inn JSON-objektet fra <code>/recipe-url-to-json</code>. Du får
                se oppskriften i skjemaet før du lagrer.
              </>
            )}
          </p>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (error) setError(null)
            }}
            placeholder={'{\n  "title": "…",\n  "ingredients": [ … ]\n}'}
            rows={10}
            className="mt-3 w-full resize-y rounded-lg border border-stone-300 bg-white p-3 font-mono text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                setText(EXAMPLE_RECIPE_JSON)
                setError(null)
              }}
            >
              Vis eksempel
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onPress={() => handleOpenChange(false)}>
                Avbryt
              </Button>
              <Button onPress={submit} isDisabled={text.trim() === ''}>
                Importer
              </Button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
