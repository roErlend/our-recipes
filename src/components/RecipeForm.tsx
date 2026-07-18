import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogTrigger,
  Form,
  Heading,
  Modal,
  ModalOverlay,
} from 'react-aria-components'
import { FileJson, GripVertical, ImagePlus, Plus, Upload, X } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import {
  imageFileFromDataTransfer,
  resizeImageToDataUrl,
} from '@/lib/image'
import { MEAL_TAGS } from '@/lib/tags'

export interface RecipeFormIngredient {
  name: string
  quantity: string
  unit: string
  note: string
  /** Optional sub-recipe/component label, e.g. "Saus". Empty = ungrouped. */
  component: string
}

export interface RecipeFormValues {
  title: string
  description: string
  sourceUrl: string
  /** External image URL (used when the recipe links to an image rather than an upload). */
  imageUrl: string
  /** Pre-existing uploaded-image URL, for the preview on edit (null when none/creating). */
  uploadedImageUrl: string | null
  instructions: string
  servings: string
  /** Optional display override: show the recipe scaled to this portion count by default. */
  servingsOverride: string
  tags: string[]
  ingredients: RecipeFormIngredient[]
}

export interface RecipeSubmitValues {
  title: string
  description: string | null
  sourceUrl: string | null
  imageUrl: string | null
  /** A freshly uploaded/pasted image as a data URL, or null/undefined to leave bytes untouched. */
  imageUpload?: string | null
  /** Drop any stored uploaded image (removed, or switched to a URL). */
  clearUploadedImage?: boolean
  instructions: string | null
  servings: number | null
  servingsOverride: number | null
  tags: string[]
  ingredients: {
    name: string
    quantity: number | null
    unit: string | null
    note: string | null
    component: string | null
  }[]
}

/** How the recipe's image is currently set in the form. */
type ImageState =
  | { kind: 'none' }
  | { kind: 'stored'; url: string } // an existing uploaded image (edit), unchanged
  | { kind: 'url'; url: string } // an external image URL
  | { kind: 'upload'; dataUrl: string } // a new uploaded/pasted image, not yet saved

function initialImageState(v: RecipeFormValues): ImageState {
  if (v.uploadedImageUrl) return { kind: 'stored', url: v.uploadedImageUrl }
  if (v.imageUrl.trim()) return { kind: 'url', url: v.imageUrl }
  return { kind: 'none' }
}

const emptyIngredient = (component = ''): RecipeFormIngredient => ({
  name: '',
  quantity: '',
  unit: '',
  note: '',
  component,
})

export const emptyRecipeForm = (): RecipeFormValues => ({
  title: '',
  description: '',
  sourceUrl: '',
  imageUrl: '',
  uploadedImageUrl: null,
  instructions: '',
  servings: '',
  servingsOverride: '',
  tags: [],
  ingredients: [emptyIngredient()],
})

const str = (v: unknown) =>
  v == null ? '' : typeof v === 'string' ? v : String(v)

/** Flatten various step shapes into one numbered text block for `instructions`. */
function stepsToText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value
      .map((s) =>
        typeof s === 'string'
          ? s
          : str((s as { text?: unknown; name?: unknown })?.text ?? (s as { name?: unknown })?.name),
      )
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s, i) => `${i + 1}. ${s.replace(/^\s*(steg|trinn|step)?\s*\d+[.):]?\s*/i, '')}`)
      .join('\n')
  }
  return ''
}

/**
 * Parse a full-recipe JSON object (e.g. from the `recipe-url-to-json` skill)
 * into form values. Lenient: every field is optional except a non-empty title,
 * and it accepts `instructions` as a string or `steps`/`instructions` as an
 * array of strings/step objects.
 */
export function parseRecipeImport(
  raw: string,
): { ok: true; values: RecipeFormValues } | { ok: false; error: string } {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Ugyldig JSON – sjekk at hele objektet er limt inn.' }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Forventet et JSON-objekt med en oppskrift.' }
  }
  const o = data as Record<string, unknown>
  const title = str(o.title).trim()
  if (!title) return { ok: false, error: 'Oppskriften mangler en tittel.' }

  const rawIngredients = Array.isArray(o.ingredients) ? o.ingredients : []
  const ingredients: RecipeFormIngredient[] = rawIngredients
    .map((i) => {
      const ing = (i ?? {}) as Record<string, unknown>
      const qty = ing.quantity ?? ing.amount ?? ing.qty
      return {
        name: str(ing.name ?? ing.ingredient).trim(),
        quantity: qty == null ? '' : str(qty),
        unit: str(ing.unit).trim(),
        note: str(ing.note).trim(),
        component: str(ing.component ?? ing.group ?? ing.section).trim(),
      }
    })
    .filter((i) => i.name !== '')

  return {
    ok: true,
    values: {
      title,
      description: str(o.description).trim(),
      sourceUrl: str(o.sourceUrl ?? o.source_url ?? o.url).trim(),
      imageUrl: str(o.imageUrl ?? o.image_url ?? o.image).trim(),
      uploadedImageUrl: null,
      instructions: stepsToText(o.instructions ?? o.steps),
      servings: o.servings == null ? '' : str(o.servings),
      servingsOverride: '',
      tags: Array.isArray(o.tags) ? o.tags.map(str).map((t) => t.trim()).filter(Boolean) : [],
      ingredients: ingredients.length ? ingredients : [emptyIngredient()],
    },
  }
}

function toSubmit(values: RecipeFormValues, img: ImageState): RecipeSubmitValues {
  const trimmed = (s: string) => (s.trim() === '' ? null : s.trim())

  // Image: upload and external-URL are mutually exclusive. Switching to a URL or
  // removing the image clears any stored upload; an upload replaces it.
  let imageUrl: string | null = null
  let imageUpload: string | null | undefined
  let clearUploadedImage: boolean | undefined
  switch (img.kind) {
    case 'url':
      imageUrl = trimmed(img.url)
      clearUploadedImage = true
      break
    case 'upload':
      imageUpload = img.dataUrl
      break
    case 'none':
      clearUploadedImage = true
      break
    case 'stored':
      // leave stored bytes as-is
      break
  }

  return {
    title: values.title.trim(),
    description: trimmed(values.description),
    sourceUrl: trimmed(values.sourceUrl),
    imageUrl,
    imageUpload,
    clearUploadedImage,
    instructions: trimmed(values.instructions),
    servings: values.servings.trim() ? Number(values.servings) : null,
    servingsOverride: values.servingsOverride.trim()
      ? Number(values.servingsOverride)
      : null,
    tags: values.tags,
    ingredients: values.ingredients
      .filter((i) => i.name.trim() !== '')
      .map((i) => ({
        name: i.name.trim(),
        quantity: i.quantity.trim() ? Number(i.quantity) : null,
        unit: trimmed(i.unit),
        note: trimmed(i.note),
        component: trimmed(i.component),
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
  const [image, setImage] = useState<ImageState>(() =>
    initialImageState(initialValues ?? emptyRecipeForm()),
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
    setValues((v) => ({
      ...v,
      // New rows inherit the previous row's component, so you tag a group once.
      ingredients: [
        ...v.ingredients,
        emptyIngredient(v.ingredients.at(-1)?.component ?? ''),
      ],
    }))
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

  function addTag(tag: string) {
    if (tag && !values.tags.includes(tag)) {
      set('tags', [...values.tags, tag])
    }
  }

  function commitTag() {
    addTag(tagDraft.trim().replace(/,$/, '').trim())
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
        onSubmit(toSubmit(values, image))
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
        <TextField
          label="Kilde-URL"
          type="url"
          description="Lenke til originaloppskriften (valgfritt)"
          value={values.sourceUrl}
          onChange={(v) => set('sourceUrl', v)}
          placeholder="https://…"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Porsjoner"
            description="Antallet ingrediensmengdene er skrevet for"
            type="number"
            value={values.servings}
            onChange={(v) => set('servings', v)}
            placeholder="4"
          />
          <TextField
            label="Vis som porsjoner"
            description="Valgfritt: vis oppskriften skalert til dette antallet som standard"
            type="number"
            value={values.servingsOverride}
            onChange={(v) => set('servingsOverride', v)}
            placeholder="2"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-stone-700">Bilde</span>
          <ImageField state={image} onChange={setImage} />
        </div>
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
        {MEAL_TAGS.some((t) => !values.tags.includes(t)) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-stone-400">Vanlige:</span>
            {MEAL_TAGS.filter((t) => !values.tags.includes(t)).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => addTag(tag)}
                className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm font-medium capitalize text-brand-700 ring-1 ring-brand-300 transition-colors hover:bg-brand-50"
              >
                <Plus className="h-3.5 w-3.5" />
                {tag}
              </button>
            ))}
          </div>
        )}
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
              <div className="flex flex-1 flex-col gap-2">
               <input
                 value={item.component}
                 onChange={(e) =>
                   updateIngredient(index, { component: e.target.value })
                 }
                 placeholder="Komponent (valgfritt), f.eks. «Saus»"
                 aria-label="Komponent"
                 className="rounded-md border border-stone-200 bg-white px-2 py-1 text-xs text-stone-600 outline-none focus:border-brand-500"
               />
               <div className="grid grid-cols-2 gap-2 sm:grid-cols-[5rem_5rem_1fr_1fr]">
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

/* --------------------------- recipe image field -------------------------- */

function ImageField({
  state,
  onChange,
}: {
  state: ImageState
  onChange: (next: ImageState) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(
    async (file: File) => {
      setError(null)
      if (!file.type.startsWith('image/')) {
        setError('Filen må være et bilde.')
        return
      }
      setBusy(true)
      try {
        const dataUrl = await resizeImageToDataUrl(file)
        onChange({ kind: 'upload', dataUrl })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Kunne ikke behandle bildet.')
      } finally {
        setBusy(false)
      }
    },
    [onChange],
  )

  // Paste an image from the clipboard anywhere while editing the recipe. Pastes
  // without an image (e.g. text into a field) are left untouched.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFileFromDataTransfer(e.clipboardData)
      if (!file) return
      e.preventDefault()
      void handleFile(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [handleFile])

  const preview =
    state.kind === 'upload'
      ? state.dataUrl
      : state.kind === 'none'
        ? null
        : state.url

  const openPicker = () => inputRef.current?.click()
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = imageFileFromDataTransfer(e.dataTransfer)
    if (file) void handleFile(file)
  }

  return (
    <div className="flex flex-col gap-3">
      {preview ? (
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className="relative overflow-hidden rounded-lg border border-stone-200"
        >
          <img
            src={preview}
            alt="Forhåndsvisning"
            className="max-h-56 w-full object-cover"
          />
          {state.kind === 'upload' && (
            <span className="absolute top-2 left-2 rounded-full bg-brand-600/90 px-2 py-0.5 text-xs font-medium text-white">
              Nytt bilde
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              onChange({ kind: 'none' })
              setError(null)
            }}
            aria-label="Fjern bilde"
            className="absolute top-2 right-2 rounded-full bg-stone-900/60 p-1.5 text-white transition-colors hover:bg-stone-900/80"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50/60 px-4 py-8 text-center text-sm text-stone-500 transition-colors hover:border-brand-400 hover:bg-brand-50/40"
        >
          <ImagePlus className="h-6 w-6 text-stone-400" />
          <span>
            {busy
              ? 'Behandler bilde…'
              : 'Last opp, dra og slipp, eller lim inn et bilde'}
          </span>
          <span className="text-xs text-stone-400">
            JPG, PNG eller WebP – komprimeres automatisk
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          e.target.value = ''
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onPress={openPicker}
          isDisabled={busy}
        >
          <Upload className="h-4 w-4" />
          {busy ? 'Behandler…' : 'Last opp bilde'}
        </Button>
        <span className="text-xs text-stone-400">eller</span>
        <input
          type="url"
          value={state.kind === 'url' ? state.url : ''}
          onChange={(e) => {
            const url = e.target.value
            onChange(url.trim() ? { kind: 'url', url } : { kind: 'none' })
          }}
          placeholder="lim inn en bilde-URL"
          className="min-w-[12rem] flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
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
      component: str(o.component ?? o.group ?? o.section),
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
