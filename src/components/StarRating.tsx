import { useState } from 'react'
import { Star } from 'lucide-react'

interface StarRatingProps {
  /** Current value, 0–max. */
  value: number
  max?: number
  /** Omit (or pass undefined) for a read-only display. */
  onChange?: (value: number) => void
  size?: 'sm' | 'md'
  label?: string
}

/**
 * A 1–max star rating. Read-only when `onChange` is omitted. Interactive mode
 * previews on hover and lets you clear your vote by clicking the current value.
 */
export function StarRating({
  value,
  max = 10,
  onChange,
  size = 'md',
  label,
}: StarRatingProps) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value
  const dim = size === 'sm' ? 'h-4 w-4' : 'h-6 w-6'

  if (!onChange) {
    return (
      <span className="inline-flex items-center gap-0.5" aria-label={label}>
        {Array.from({ length: max }, (_, i) => (
          <Star
            key={i}
            aria-hidden="true"
            className={`${dim} ${
              i < shown ? 'fill-amber-400 text-amber-400' : 'fill-none text-stone-300'
            }`}
          />
        ))}
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="radiogroup"
      aria-label={label}
      onMouseLeave={() => setHover(null)}
    >
      {Array.from({ length: max }, (_, i) => {
        const n = i + 1
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} av ${max}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n === value ? 0 : n)}
            className="cursor-pointer p-0.5"
          >
            <Star
              className={`${dim} transition-colors ${
                n <= shown
                  ? 'fill-amber-400 text-amber-400'
                  : 'fill-none text-stone-300 hover:text-amber-300'
              }`}
            />
          </button>
        )
      })}
    </span>
  )
}
