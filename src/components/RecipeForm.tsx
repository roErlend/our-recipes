import { useState } from 'react'
import {
  Dialog,
  DialogTrigger,
  Form,
  Heading,
  Modal,
  ModalOverlay,
} from 'react-aria-components'
import { FileJson, GripVertical, Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'

export interface RecipeFormIngredient {
  name: string
  quantity: string
  unit: string
  note: string
}

export interface RecipeFormValues {
  title: string
  description: string
  sourceUrl: string
  imageUrl: string
  instructions: string
  servings: string
  tags: string[]
  ingredients: RecipeFormIngredient[]
}

export interface RecipeSubmitValues {
  title: string
  description: string | null
  sourceUrl: string | null
  imageUrl: string | null
  instructions: string | null
  servings: number | null
  tags: string[]
  ingredients: {
    name: string
    quantity: number | null
    unit: string | null
    note: string | null
  }[]
}

const emptyIngredient = (): RecipeFormIngredient => ({
  name: '',
  quantity: '',
  unit: '',
  note: '',
})

export const emptyRecipeForm = (): RecipeFormValues => ({
  title: '',
  description: '',
  sourceUrl: '',
  imageUrl: '',
  instructions: '',
  servings: '',
  tags: [],
  ingredients: [emptyIngredient()],
})

function toSubmit(values: RecipeFormValues): RecipeSubmitValues {
  const trimmed = (s: string) => (s.trim() === '' ? null : s.trim())
  return {
    title: values.title.trim(),
    description: trimmed(values.description),
    sourceUrl: trimmed(values.sourceUrl),
    imageUrl: trimmed(values.imageUrl),
    instructions: trimmed(values.instructions),
    servings: values.servings.trim() ? Number(values.servings) : null,
    tags: values.tags,
    ingredients: values.ingredients
      .filter((i) => i.name.trim() !== '')
      .map((i) => ({
        name: i.name.trim(),
        quantity: i.quantity.trim() ? Number(i.quantity) : null,
        unit: trimmed(i.unit),
        note: trimmed(i.note),
      })),
  }
}

interface RecipeFormProps {
  initialValues?: RecipeFormValues
  submitLabel: string
  pending?: boolean
  error?: string | null
  onSubmit: (values: RecipeSubmitValues) => void
  onCancel?: () => void
}

export function RecipeForm({
  initialValues,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: RecipeFormProps) {
  const [values, setValues] = useState<RecipeFormValues>(
    initialValues ?? emptyRecipeForm(),
  )
  const [tagDraft, setTagDraft] = useState('')

  const set = <K extends keyof RecipeFormValues>(
    key: K,
    value: RecipeFormValues[K],
  ) => setValues((v) => ({ ...v, [key]: value }))

  function updateIngredient(
    index: number,
    patch: Partial<RecipeFormIngredient>,
  ) {
    setValues((v) => ({
      ...v,
      ingredients: v.ingredients.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }))
  }

  function addIngredient() {
    setValues((v) => ({ ...v, ingredients: [...v.ingredients, emptyIngredient()] }))
  }

  function removeIngredient(index: number) {
    setValues((v) => ({
      ...v,
      ingredients: v.ingredients.filter((_, i) => i !== index),
    }))
  }

  function importIngredients(items: RecipeFormIngredient[]) {
    setValues((v) => {
      // Drop empty placeholder rows, then append the imported ingredients.
      const existing = v.ingredients.filter((i) => i.name.trim() !== '')
      return { ...v, ingredients: [...existing, ...items] }
    })
  }

  function commitTag() {
    const tag = tagDraft.trim().replace(/,$/, '').trim()
    if (tag && !values.tags.includes(tag)) {
      set('tags', [...values.tags, tag])
    }
    setTagDraft('')
  }

  function removeTag(tag: string) {
    set(
      'tags',
      values.tags.filter((t) => t !== tag),
    )
  }

  return (
    <Form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(toSubmit(values))
      }}
      className="flex flex-col gap-6"
    >
      <Section title="Grunnleggende">
        <TextField
          label="Tittel"
          isRequired
          value={values.title}
          onChange={(v) => set('title', v)}
          placeholder="Bestemors lasagne"
        />
        <TextField
          label="Beskrivelse"
          multiline
          rows={2}
          value={values.description}
          onChange={(v) => set('description', v)}
          placeholder="En kort beskrivelse av oppskriften"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Kilde-URL"
            type="url"
            description="Lenke til originaloppskriften (valgfritt)"
            value={values.sourceUrl}
            onChange={(v) => set('sourceUrl', v)}
            placeholder="https://…"
          />
          <TextField
            label="Porsjoner"
            type="number"
            value={values.servings}
            onChange={(v) => set('servings', v)}
            placeholder="4"
          />
        </div>
        <TextField
          label="Bilde-URL"
          type="url"
          value={values.imageUrl}
          onChange={(v) => set('imageUrl', v)}
          placeholder="https://… (valgfritt)"
        />
      </Section>

      <Section
        title="Etiketter"
        hint="Trykk Enter eller komma for å legge til. Brukes til søk og filtrering."
      >
        <div className="flex flex-wrap items-center gap-2">
          {values.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-3 py-1 text-sm font-medium text-brand-800"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="cursor-pointer text-brand-600 hover:text-brand-900"
                aria-label={`Fjern ${tag}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                commitTag()
              } else if (
                e.key === 'Backspace' &&
                tagDraft === '' &&
                values.tags.length
              ) {
                removeTag(values.tags[values.tags.length - 1])
              }
            }}
            onBlur={commitTag}
            placeholder={
              values.tags.length ? 'Legg til etikett…' : 'f.eks. middag, vegetar'
            }
            className="min-w-[8rem] flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
      </Section>

      <Section
        title="Ingredienser"
        hint="Mengde og enhet brukes i handlelisten. La dem stå tomme for ting som «salt etter smak». Du kan også importere en JSON-liste."
      >
        <div className="flex flex-col gap-2">
          {values.ingredients.map((item, index) => (
            <div
              key={index}
              className="flex items-start gap-2 rounded-lg border border-stone-200 bg-stone-50/60 p-2"
            >
              <GripVertical className="mt-2.5 h-4 w-4 shrink-0 text-stone-300" />
              <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-[5rem_5rem_1fr_1fr]">
                <input
                  value={item.quantity}
                  onChange={(e) =>
                    updateIngredient(index, { quantity: e.target.value })
                  }
                  placeholder="Mengde"
                  type="number"
                  step="any"
                  className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                />
                <input
                  value={item.unit}
                  onChange={(e) =>
                    updateIngredient(index, { unit: e.target.value })
                  }
                  placeholder="Enhet"
                  className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                />
                <input
                  value={item.name}
                  onChange={(e) =>
                    updateIngredient(index, { name: e.target.value })
                  }
                  placeholder="Ingrediens"
                  className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                />
                <input
                  value={item.note}
                  onChange={(e) =>
                    updateIngredient(index, { note: e.target.value })
                  }
                  placeholder="Notat (valgfritt)"
                  className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onPress={() => removeIngredient(index)}
                aria-label="Fjern ingrediens"
                className="mt-0.5"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onPress={addIngredient}
          >
            <Plus className="h-4 w-4" />
            Legg til ingrediens
          </Button>
          <IngredientImportDialog onImport={importIngredients} />
        </div>
      </Section>

      <Section title="Fremgangsmåte">
        <TextField
          label="Steg"
          multiline
          rows={8}
          value={values.instructions}
          onChange={(v) => set('instructions', v)}
          placeholder={'1. Forvarm ovnen…\n2. …'}
        />
      </Section>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-stone-200 pt-4">
        <Button type="submit" isDisabled={pending}>
          {pending ? 'Lagrer…' : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onPress={onCancel}>
            Avbryt
          </Button>
        )}
      </div>
    </Form>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-base font-semibold text-stone-900">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-stone-500">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/* ----------------------- JSON ingredient import -------------------------- */

const IMPORT_EXAMPLE = `[
  { "name": "Spaghetti", "quantity": 400, "unit": "g" },
  { "name": "Hvitløk", "quantity": 2, "unit": "fedd", "note": "finhakket" },
  { "name": "Kokosmelk", "quantity": 3, "unit": "dl" },
  { "name": "Salt" }
]`

type ParseResult =
  | { ok: true; items: RecipeFormIngredient[]; skipped: number }
  | { ok: false; error: string }

/**
 * Parse a pasted JSON blob into ingredient rows. Accepts either a top-level
 * array, or an object with an `ingredients` array (e.g. a whole recipe export).
 * Field aliases are tolerated: name|ingredient, quantity|amount|qty.
 */
export function parseIngredientsJson(text: string): ParseResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: 'Lim inn JSON først.' }

  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch (e) {
    return { ok: false, error: `Ugyldig JSON: ${(e as Error).message}` }
  }

  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { ingredients?: unknown })?.ingredients)
      ? (data as { ingredients: unknown[] }).ingredients
      : null

  if (!arr) {
    return {
      ok: false,
      error:
        'Forventet et JSON-array med ingredienser, eller et objekt med et "ingredients"-array.',
    }
  }

  const str = (v: unknown) =>
    typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''

  const items: RecipeFormIngredient[] = []
  let skipped = 0
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') {
      skipped++
      continue
    }
    const o = raw as Record<string, unknown>
    const name = str(o.name) || str(o.ingredient)
    if (!name) {
      skipped++
      continue
    }
    const qty = o.quantity ?? o.amount ?? o.qty
    items.push({
      name,
      quantity: str(qty),
      unit: str(o.unit),
      note: str(o.note),
    })
  }

  if (!items.length) {
    return {
      ok: false,
      error: 'Fant ingen gyldige ingredienser – hvert element må ha minst et «name».',
    }
  }

  return { ok: true, items, skipped }
}

function IngredientImportDialog({
  onImport,
}: {
  onImport: (items: RecipeFormIngredient[]) => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <DialogTrigger
      onOpenChange={(open) => {
        if (!open) {
          setText('')
          setError(null)
        }
      }}
    >
      <Button type="button" variant="secondary" size="sm">
        <FileJson className="h-4 w-4" />
        Importer JSON
      </Button>

      <ModalOverlay
        isDismissable
        className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-sm"
      >
        <Modal className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
          <Dialog className="outline-none">
            {({ close }) => (
              <div className="flex flex-col gap-4 p-6">
                <div>
                  <Heading
                    slot="title"
                    className="text-lg font-semibold text-stone-900"
                  >
                    Importer ingredienser fra JSON
                  </Heading>
                  <p className="mt-1 text-sm text-stone-500">
                    Lim inn et JSON-array med ingredienser. De importerte
                    elementene legges til i listen nedenfor.
                  </p>
                </div>

                <textarea
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value)
                    if (error) setError(null)
                  }}
                  rows={10}
                  spellCheck={false}
                  placeholder={IMPORT_EXAMPLE}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-xs text-stone-900 outline-none placeholder:text-stone-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
                />

                <p className="text-xs text-stone-400">
                  Hvert element trenger et <code>name</code>;{' '}
                  <code>quantity</code>, <code>unit</code> og <code>note</code>{' '}
                  er valgfrie. Bruk metriske enheter (g, dl, ts, ss).
                </p>

                {error && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}

                <div className="flex justify-end gap-3">
                  <Button type="button" variant="ghost" onPress={close}>
                    Avbryt
                  </Button>
                  <Button
                    type="button"
                    onPress={() => {
                      const result = parseIngredientsJson(text)
                      if (!result.ok) {
                        setError(result.error)
                        return
                      }
                      onImport(result.items)
                      close()
                    }}
                  >
                    Importer
                  </Button>
                </div>
              </div>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  )
}
