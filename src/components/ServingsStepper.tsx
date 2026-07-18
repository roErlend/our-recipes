import { useRef, useState } from 'react'
import { Minus, Plus, RotateCcw, Users } from 'lucide-react'

/** "3" for whole counts, "2,7" (one decimal, Norwegian comma) for fractional
 *  ones — which happen when the recipe is scaled by an anchored ingredient. */
export function formatServings(n: number) {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace('.', ',')
}

/**
 * Interactive replacement for the static "{n} porsjoner" label. Steps the target
 * portion count (1–100), which the recipe page uses to scale ingredient amounts.
 * The count can be fractional (after scaling by an anchored ingredient amount);
 * stepping from a fraction snaps to the neighboring whole numbers. When scaled
 * away from the recipe's default (its display override, falling back to the
 * base), a reset icon snaps back. Render only when the recipe declares a base
 * count.
 */
export function ServingsStepper({
  defaultServings,
  servings,
  onServingsChange,
}: {
  /** Reset target: the recipe's display override, or its base portion count. */
  defaultServings: number
  servings: number
  onServingsChange: (n: number) => void
}) {
  const scaled = servings !== defaultServings

  // The count doubles as a direct input: tap, type the target (party of 15!),
  // Enter/blur commits, Escape reverts. `draft` is null when not editing.
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  const commit = () => {
    const wasCancelled = cancelled.current
    cancelled.current = false
    const raw = draft
    setDraft(null)
    if (wasCancelled || raw == null) return
    const v = Number(raw.trim().replace(',', '.'))
    if (!Number.isFinite(v) || v <= 0) return
    onServingsChange(Math.min(100, Math.max(1, v)))
  }

  return (
    <div className="inline-flex items-center gap-2 text-sm text-stone-600">
      <Users className="h-4 w-4 text-stone-400" />
      <div className="inline-flex items-center rounded-lg border border-stone-300 bg-white">
        <button
          type="button"
          aria-label="Færre porsjoner"
          onClick={() => onServingsChange(Math.max(1, Math.ceil(servings) - 1))}
          disabled={servings <= 1}
          className="flex h-8 w-8 items-center justify-center rounded-l-lg text-stone-600 hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-300"
        >
          <Minus className="h-4 w-4" />
        </button>
        <input
          inputMode="decimal"
          value={draft ?? formatServings(servings)}
          aria-label="Antall porsjoner"
          onFocus={(e) => {
            setDraft(formatServings(servings))
            e.currentTarget.select()
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              cancelled.current = true
              e.currentTarget.blur()
            }
          }}
          className="w-10 bg-transparent text-center font-medium tabular-nums text-stone-900 outline-none focus:bg-brand-50"
        />
        <button
          type="button"
          aria-label="Flere porsjoner"
          onClick={() => onServingsChange(Math.min(100, Math.floor(servings) + 1))}
          disabled={servings >= 100}
          className="flex h-8 w-8 items-center justify-center rounded-r-lg text-stone-600 hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-300"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <span>porsjoner</span>
      {scaled && (
        <button
          type="button"
          aria-label={`Tilbakestill til ${formatServings(defaultServings)} porsjoner`}
          title={`Tilbakestill til ${formatServings(defaultServings)} porsjoner`}
          onClick={() => onServingsChange(defaultServings)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-700"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
