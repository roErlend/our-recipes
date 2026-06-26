import { useState } from 'react'
import { Check, ChefHat, X } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { useWakeLock } from '@/lib/useWakeLock'

/** Split a numbered instruction block into individual steps, dropping the
 *  leading "1." / "2)" markers the form stores (we re-number visually). */
function parseSteps(instructions: string): string[] {
  return instructions
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+[.)]\s*/, ''))
}

/**
 * The recipe's preparation steps. Reads as a normal text block, but a "Lag nå"
 * toggle flips it into cooking mode: large tap-to-check step cards plus a screen
 * wake lock so the phone stays awake with your hands full.
 */
export function InstructionsSection({ instructions }: { instructions: string }) {
  const [cooking, setCooking] = useState(false)
  const [done, setDone] = useState<ReadonlySet<number>>(() => new Set())
  useWakeLock(cooking)

  const steps = parseSteps(instructions)

  const exit = () => {
    setCooking(false)
    setDone(new Set())
  }
  const toggleStep = (i: number) =>
    setDone((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  if (!cooking) {
    return (
      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-stone-900">Fremgangsmåte</h2>
          {steps.length > 0 && (
            <Button variant="secondary" size="sm" onPress={() => setCooking(true)}>
              <ChefHat className="h-4 w-4" />
              Lag nå
            </Button>
          )}
        </div>
        <div className="prose prose-stone max-w-none whitespace-pre-wrap text-stone-700">
          {instructions}
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-brand-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Lager nå</h2>
          <p className="text-xs text-stone-400">
            Skjermen holdes våken. Trykk på et steg når det er gjort.
          </p>
        </div>
        <Button variant="ghost" size="sm" onPress={exit}>
          <X className="h-4 w-4" />
          Avslutt
        </Button>
      </div>
      <ol className="flex flex-col gap-3">
        {steps.map((step, i) => {
          const checked = done.has(i)
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => toggleStep(i)}
                aria-pressed={checked}
                className={[
                  'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                  checked
                    ? 'border-stone-200 bg-stone-50'
                    : 'border-stone-300 bg-white hover:bg-stone-50',
                ].join(' ')}
              >
                <span
                  className={[
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                    checked
                      ? 'bg-stone-200 text-stone-400'
                      : 'bg-brand-600 text-white',
                  ].join(' ')}
                >
                  {checked ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <span
                  className={[
                    'text-lg leading-relaxed',
                    checked ? 'text-stone-400 line-through' : 'text-stone-800',
                  ].join(' ')}
                >
                  {step}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
