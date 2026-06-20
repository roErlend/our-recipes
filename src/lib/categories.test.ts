import { describe, expect, it } from 'vitest'

import {
  categoryRank,
  DEFAULT_CATEGORY,
  guessIngredientCategory,
  INGREDIENT_CATEGORIES,
  isCanonicalCategory,
  normalizeCategory,
} from '@/lib/categories'

describe('isCanonicalCategory', () => {
  it('is true for built-in categories', () => {
    expect(isCanonicalCategory('Frukt og grønt')).toBe(true)
    expect(isCanonicalCategory('Annet')).toBe(true)
  })

  it('is false for unknown categories', () => {
    expect(isCanonicalCategory('Bakeri-ting')).toBe(false)
    expect(isCanonicalCategory('')).toBe(false)
  })
})

describe('categoryRank', () => {
  it('ranks canonical categories in their declared order', () => {
    const ranks = INGREDIENT_CATEGORIES.map((c) => categoryRank(c))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(categoryRank('Frukt og grønt')).toBe(0)
    expect(categoryRank('Annet')).toBe(INGREDIENT_CATEGORIES.length - 1)
  })

  it('ranks unknown categories just before "Annet"', () => {
    const rank = categoryRank('Min egen kategori')
    expect(rank).toBe(INGREDIENT_CATEGORIES.length - 1.5)
    expect(rank).toBeLessThan(categoryRank('Annet'))
    expect(rank).toBeGreaterThan(categoryRank('Husholdning'))
  })
})

describe('normalizeCategory', () => {
  it('falls back to the default for null/undefined/blank', () => {
    expect(normalizeCategory(null)).toBe(DEFAULT_CATEGORY)
    expect(normalizeCategory(undefined)).toBe(DEFAULT_CATEGORY)
    expect(normalizeCategory('')).toBe(DEFAULT_CATEGORY)
    expect(normalizeCategory('   ')).toBe(DEFAULT_CATEGORY)
  })

  it('trims whitespace from a value', () => {
    expect(normalizeCategory('  Drikke  ')).toBe('Drikke')
  })

  it('keeps a non-blank custom value', () => {
    expect(normalizeCategory('Min egen kategori')).toBe('Min egen kategori')
  })
})

describe('guessIngredientCategory', () => {
  it('files common ingredients under a sensible section', () => {
    expect(guessIngredientCategory('Kyllingfilet')).toBe('Kjøtt og fisk')
    expect(guessIngredientCategory('Hvetemel')).toBe('Tørrvarer og pasta')
    expect(guessIngredientCategory('Revet parmesan')).toBe('Meieri og egg')
    expect(guessIngredientCategory('Rødløk')).toBe('Frukt og grønt')
    expect(guessIngredientCategory('Olivenolje')).toBe('Krydder og saus')
  })

  it('prefers the more specific rule when keywords overlap', () => {
    // "kokosmelk" must not be pulled into Meieri by "melk".
    expect(guessIngredientCategory('Kokosmelk')).toBe('Hermetikk og konserves')
    // "paprikapulver" is a spice, not produce.
    expect(guessIngredientCategory('Paprikapulver')).toBe('Krydder og saus')
  })

  it('does not let a 2-letter keyword match inside a word', () => {
    // "te" lives inside "potet" but must not make it a drink.
    expect(guessIngredientCategory('Potet')).toBe('Frukt og grønt')
  })

  it('falls back to the default when nothing matches', () => {
    expect(guessIngredientCategory('Quzzlewump')).toBe(DEFAULT_CATEGORY)
    expect(guessIngredientCategory('')).toBe(DEFAULT_CATEGORY)
  })
})
