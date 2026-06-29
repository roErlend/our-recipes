import { useMemo, useState } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { Link } from '@tanstack/react-router'
import { Check, Dices, Plus, ShoppingCart, Star, X } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import {
  MAX_DINNERS,
  planMeals,
  type MealPlanFailure,
  type MealPlanRecipe,
  type TagRequirement,
} from '@/lib/meal-plan'
import { MEAL_TAGS, isMealTag } from '@/lib/tags'

/** What a result row needs beyond {@link MealPlanRecipe}: the shopping-list
 *  state, so each row can mirror the /recipes add-to-list button. */
export interface MealPlanModalRecipe extends MealPlanRecipe {
  inShoppingList: boolean
  ingredientCount: number
}

/** Translate a structured failure into a clear Norwegian explanation. */
function failureMessage(f: MealPlanFailure): string {
  switch (f.code) {
    case 'invalid-count':
      return `Antall oppskrifter må være mellom 1 og ${MAX_DINNERS}.`
    case 'empty-pool':
      return f.minRating > 0
        ? `Ingen oppskrifter passer filtrene (bl.a. vurdering på minst ${f.minRating}). Løs opp filtrene.`
        : `Ingen oppskrifter passer filtrene. Løs opp måltid eller etiketter.`
    case 'not-enough-recipes':
      return `Du ba om ${f.requested} oppskrifter, men bare ${f.available} passer kravene. Velg færre eller løs opp filtrene.`
    case 'tag-shortfall':
      return `Du krevde minst ${f.requested} med etiketten «${f.tag}», men bare ${f.available} passer. Senk kravet eller minstevurderingen.`
    case 'requirements-exceed-count':
      return `Etikettkravene summerer til ${f.required} oppskrifter, men du ba bare om ${f.count}. Øk antallet eller senk kravene.`
  }
}

/**
 * "Trekk oppskrifter"-dialog: draws a random set of recipes from the
 * already-loaded recipe list (optionally scoped by meal category, tags and
 * rating). All logic lives in the pure {@link planMeals}; this component only
 * collects options, runs the draw (with a fresh RNG so "Trekk på nytt"
 * re-rolls), and renders the result as links to each recipe.
 */
export function MealPlanModal({
  isOpen,
  onOpenChange,
  recipes,
  allTags,
  initialDrawIds,
  onDrawChange,
  onToggleShopping,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  recipes: MealPlanModalRecipe[]
  /** The household's full tag vocabulary, for the requirement picker. */
  allTags: string[]
  /** Recipe ids of a previous draw, restored from the URL so the result
   *  survives navigating into a recipe and back. */
  initialDrawIds?: string[]
  /** Mirror the drawn recipe ids to the URL (empty clears it). */
  onDrawChange?: (ids: string[]) => void
  /** Toggle a recipe on/off the shopping list (same handler as /recipes). */
  onToggleShopping: (id: string, inList: boolean) => void
}) {
  const [count, setCount] = useState(3)
  const [mealFilter, setMealFilter] = useState<string[]>([])
  const [minRating, setMinRating] = useState(0)
  const [weightByRating, setWeightByRating] = useState(false)
  const [requirements, setRequirements] = useState<TagRequirement[]>([])

  // The meal categories present in the library, shown as toggle chips up top
  // (a plain pool filter, no count) — mirroring the overview's "Måltid" section.
  const mealOptions = useMemo(
    () => MEAL_TAGS.filter((t) => allTags.includes(t)),
    [allTags],
  )
  const toggleMeal = (tag: string) =>
    setMealFilter((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )

  // Look up the *live* recipe (current shopping-list state) by id, so each
  // result row's add-button reflects optimistic toggles immediately.
  const recipesById = useMemo(
    () => new Map(recipes.map((r) => [r.id, r])),
    [recipes],
  )
  const [result, setResult] = useState<
    { ok: true; recipes: MealPlanRecipe[] } | { ok: false; message: string } | null
  >(() => {
    // Restore a prior draw (from the URL) so it survives back-navigation.
    if (!initialDrawIds?.length) return null
    const byId = new Map(recipes.map((r) => [r.id, r]))
    const drawn = initialDrawIds
      .map((id) => byId.get(id))
      .filter((r): r is MealPlanModalRecipe => r != null)
    return drawn.length ? { ok: true, recipes: drawn } : null
  })

  const handleOpenChange = (open: boolean) => {
    if (!open) setResult(null)
    onOpenChange(open)
  }

  const draw = () => {
    const outcome = planMeals(recipes, {
      count,
      requiredTags: mealFilter,
      tagRequirements: requirements,
      minRating: minRating > 0 ? minRating : undefined,
      weightByRating,
    })
    setResult(
      outcome.ok
        ? { ok: true, recipes: outcome.recipes }
        : { ok: false, message: failureMessage(outcome.failure) },
    )
    // Persist the drawn ids so the result is restorable after navigating away.
    onDrawChange?.(outcome.ok ? outcome.recipes.map((r) => r.id) : [])
  }

  // Tags available for "≥N" rules: the household vocabulary minus the meal
  // categories (handled by the chips above) and tags already used by a rule.
  const availableTags = useMemo(
    () =>
      allTags.filter(
        (t) => !isMealTag(t) && !requirements.some((r) => r.tag === t),
      ),
    [allTags, requirements],
  )

  const addRequirement = () => {
    const tag = availableTags[0]
    if (!tag) return
    setRequirements((prev) => [...prev, { tag, min: 1 }])
  }

  const updateRequirement = (index: number, patch: Partial<TagRequirement>) =>
    setRequirements((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    )

  const removeRequirement = (index: number) =>
    setRequirements((prev) => prev.filter((_, i) => i !== index))

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      isDismissable
      className="fixed inset-0 z-30 flex items-start justify-center bg-stone-900/30 p-4 pt-[8vh] backdrop-blur-sm"
    >
      <Modal className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl outline-none">
        <Dialog className="outline-none">
          <Heading slot="title" className="text-lg font-semibold text-stone-900">
            Trekk oppskrifter
          </Heading>
          <p className="mt-1 text-sm text-stone-500">
            Trekk et tilfeldig sett oppskrifter. Bare antallet er påkrevd –
            måltid, etiketter og vurdering er valgfrie filtre.
          </p>

          <div className="mt-4 flex flex-col gap-4">
            {/* Meal categories — toggle chips that filter the pool (no count). */}
            {mealOptions.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-stone-700">
                  Måltid (valgfritt)
                </span>
                <div className="flex flex-wrap gap-2">
                  {mealOptions.map((tag) => {
                    const active = mealFilter.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleMeal(tag)}
                        className={[
                          'rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition-colors',
                          active
                            ? 'bg-brand-600 text-white hover:bg-brand-700'
                            : 'bg-white text-brand-700 ring-1 ring-brand-300 hover:bg-brand-50',
                        ].join(' ')}
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Number of recipes — required, 1–MAX_DINNERS. */}
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-stone-700">
                Antall oppskrifter
              </span>
              <input
                type="number"
                min={1}
                max={MAX_DINNERS}
                value={count}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  // Clamp into range so the draw never sees an invalid count.
                  setCount(
                    Number.isFinite(n)
                      ? Math.min(MAX_DINNERS, Math.max(1, Math.floor(n)))
                      : 1,
                  )
                }}
                className="w-28 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              />
            </label>

            {/* Optional tag requirements. */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-stone-700">
                Etikettkrav (valgfritt)
              </span>
              {requirements.map((req, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm text-stone-500">minst</span>
                  <input
                    type="number"
                    min={1}
                    max={MAX_DINNERS}
                    value={req.min}
                    onChange={(e) =>
                      updateRequirement(i, {
                        min: Math.max(1, Math.floor(Number(e.target.value)) || 1),
                      })
                    }
                    className="w-16 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
                  />
                  <select
                    value={req.tag}
                    onChange={(e) => updateRequirement(i, { tag: e.target.value })}
                    className="flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
                  >
                    {/* This rule's current tag plus any still-unused ones. */}
                    {[req.tag, ...availableTags].map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeRequirement(i)}
                    aria-label={`Fjern krav for ${req.tag}`}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {availableTags.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={addRequirement}
                  className="self-start"
                >
                  <Plus className="h-4 w-4" />
                  Legg til krav
                </Button>
              )}
            </div>

            {/* Quality knobs. */}
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-stone-700">
                Minste vurdering (valgfritt)
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={minRating}
                  onChange={(e) => setMinRating(Number(e.target.value))}
                  className="flex-1 accent-brand-600"
                />
                <span className="inline-flex w-20 items-center gap-1 text-sm text-stone-600">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {minRating === 0 ? 'alle' : `${minRating}+`}
                </span>
              </div>
            </label>

            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={weightByRating}
                onChange={(e) => setWeightByRating(e.target.checked)}
                className="h-4 w-4 rounded border-stone-300 accent-brand-600"
              />
              Vekt etter vurdering (høyt vurderte oftere)
            </label>
          </div>

          {/* Result / failure. */}
          {result && !result.ok && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {result.message}
            </p>
          )}
          {result && result.ok && (
            <ul className="mt-4 flex flex-col gap-1.5">
              {result.recipes.map((r) => {
                // Read live state so the add-button stays in sync with toggles.
                const live = recipesById.get(r.id)
                const inList = live?.inShoppingList ?? false
                const canAdd = (live?.ingredientCount ?? 0) > 0
                return (
                  <li key={r.id} className="flex items-center gap-2">
                    <Link
                      to="/recipes/$recipeId"
                      params={{ recipeId: r.id }}
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-800 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                    >
                      <span className="min-w-0 truncate">{r.title}</span>
                      {r.ratingCount > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-600">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          {r.ratingAvg.toFixed(1).replace('.', ',')}
                        </span>
                      )}
                    </Link>
                    <button
                      type="button"
                      disabled={!canAdd}
                      onClick={() => onToggleShopping(r.id, !inList)}
                      aria-label={
                        inList
                          ? `Fjern ${r.title} fra handlelisten`
                          : `Legg ${r.title} til handlelisten`
                      }
                      title={
                        canAdd
                          ? inList
                            ? 'På handlelisten – trykk for å fjerne'
                            : 'Legg til handlelisten'
                          : 'Ingen ingredienser å legge til'
                      }
                      className={[
                        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
                        !canAdd
                          ? 'cursor-not-allowed text-stone-300'
                          : inList
                            ? 'bg-brand-600 text-white hover:bg-brand-700'
                            : 'text-stone-400 hover:bg-stone-100 hover:text-brand-700',
                      ].join(' ')}
                    >
                      {inList ? (
                        <Check className="h-5 w-5" />
                      ) : (
                        <ShoppingCart className="h-5 w-5" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="mt-5 flex items-center justify-between gap-2">
            <Button variant="ghost" onPress={() => handleOpenChange(false)}>
              Lukk
            </Button>
            <Button onPress={draw}>
              <Dices className="h-4 w-4" />
              {result?.ok ? 'Trekk på nytt' : 'Trekk'}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
