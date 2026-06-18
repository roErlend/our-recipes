import { useState } from 'react'
import { Form } from 'react-aria-components'
import { GripVertical, Plus, X } from 'lucide-react'

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
      <Section title="Basics">
        <TextField
          label="Title"
          isRequired
          value={values.title}
          onChange={(v) => set('title', v)}
          placeholder="Grandma's lasagne"
        />
        <TextField
          label="Description"
          multiline
          rows={2}
          value={values.description}
          onChange={(v) => set('description', v)}
          placeholder="A short note about this recipe"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Source URL"
            type="url"
            description="Link to the original recipe (optional)"
            value={values.sourceUrl}
            onChange={(v) => set('sourceUrl', v)}
            placeholder="https://…"
          />
          <TextField
            label="Servings"
            type="number"
            value={values.servings}
            onChange={(v) => set('servings', v)}
            placeholder="4"
          />
        </div>
        <TextField
          label="Image URL"
          type="url"
          value={values.imageUrl}
          onChange={(v) => set('imageUrl', v)}
          placeholder="https://… (optional)"
        />
      </Section>

      <Section
        title="Tags"
        hint="Press Enter or comma to add. Use these to search and filter."
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
                aria-label={`Remove ${tag}`}
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
            placeholder={values.tags.length ? 'Add tag…' : 'e.g. dinner, vegetarian'}
            className="min-w-[8rem] flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
      </Section>

      <Section
        title="Ingredients"
        hint="Quantities and units feed the shopping list. Leave them blank for things like 'salt to taste'."
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
                  placeholder="Qty"
                  type="number"
                  step="any"
                  className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                />
                <input
                  value={item.unit}
                  onChange={(e) =>
                    updateIngredient(index, { unit: e.target.value })
                  }
                  placeholder="Unit"
                  className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                />
                <input
                  value={item.name}
                  onChange={(e) =>
                    updateIngredient(index, { name: e.target.value })
                  }
                  placeholder="Ingredient"
                  className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                />
                <input
                  value={item.note}
                  onChange={(e) =>
                    updateIngredient(index, { note: e.target.value })
                  }
                  placeholder="Note (optional)"
                  className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onPress={() => removeIngredient(index)}
                aria-label="Remove ingredient"
                className="mt-0.5"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onPress={addIngredient}
          className="mt-2 self-start"
        >
          <Plus className="h-4 w-4" />
          Add ingredient
        </Button>
      </Section>

      <Section title="Instructions">
        <TextField
          label="Steps"
          multiline
          rows={8}
          value={values.instructions}
          onChange={(v) => set('instructions', v)}
          placeholder={'1. Preheat the oven…\n2. …'}
        />
      </Section>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-stone-200 pt-4">
        <Button type="submit" isDisabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onPress={onCancel}>
            Cancel
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
