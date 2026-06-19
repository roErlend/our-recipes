import { describe, expect, it } from 'vitest'

import { parseRecipeImport } from '@/components/RecipeForm'

/** Narrow to the success branch (throws if parsing failed). */
function values(raw: string) {
  const result = parseRecipeImport(raw)
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`)
  return result.values
}

describe('parseRecipeImport', () => {
  it('maps a full valid recipe object into form values', () => {
    const v = values(
      JSON.stringify({
        title: 'Lasagne',
        description: 'Bestemors oppskrift',
        sourceUrl: 'https://example.com/lasagne',
        imageUrl: 'https://example.com/img.jpg',
        servings: 4,
        tags: ['middag', 'pasta'],
        instructions: 'Stek kjøttet.',
        ingredients: [
          { name: 'Kjøttdeig', quantity: 400, unit: 'g', note: 'storfe' },
          { name: 'Løk', quantity: 1, unit: 'stk' },
        ],
      }),
    )

    expect(v.title).toBe('Lasagne')
    expect(v.description).toBe('Bestemors oppskrift')
    expect(v.sourceUrl).toBe('https://example.com/lasagne')
    expect(v.imageUrl).toBe('https://example.com/img.jpg')
    expect(v.servings).toBe('4') // coerced to string
    expect(v.tags).toEqual(['middag', 'pasta'])
    expect(v.instructions).toBe('Stek kjøttet.')
    expect(v.ingredients).toEqual([
      { name: 'Kjøttdeig', quantity: '400', unit: 'g', note: 'storfe' },
      { name: 'Løk', quantity: '1', unit: 'stk', note: '' },
    ])
  })

  it('filters out ingredients with an empty name', () => {
    const v = values(
      JSON.stringify({
        title: 'Test',
        ingredients: [{ name: 'Mel', quantity: 100 }, { name: '   ' }, { quantity: 5 }],
      }),
    )

    expect(v.ingredients).toEqual([
      { name: 'Mel', quantity: '100', unit: '', note: '' },
    ])
  })

  it('fails on invalid JSON', () => {
    const result = parseRecipeImport('{ not valid json ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeTruthy()
  })

  it('fails on a non-object (array)', () => {
    expect(parseRecipeImport('[1, 2, 3]').ok).toBe(false)
  })

  it('fails on a non-object (number)', () => {
    expect(parseRecipeImport('42').ok).toBe(false)
  })

  it('fails when the title is missing or blank', () => {
    expect(parseRecipeImport(JSON.stringify({ description: 'x' })).ok).toBe(false)
    expect(parseRecipeImport(JSON.stringify({ title: '   ' })).ok).toBe(false)
  })

  it('flattens an instructions array into a numbered multi-line string', () => {
    const v = values(
      JSON.stringify({
        title: 'Test',
        instructions: ['Forvarm ovnen', 'Bland alt', 'Stek i 20 min'],
      }),
    )

    expect(v.instructions).toBe(
      '1. Forvarm ovnen\n2. Bland alt\n3. Stek i 20 min',
    )
  })

  it('strips an existing step prefix when numbering array steps', () => {
    const v = values(
      JSON.stringify({
        title: 'Test',
        steps: ['Steg 1: hakk løk', 'Trinn 2. stek'],
      }),
    )

    expect(v.instructions).toBe('1. hakk løk\n2. stek')
  })

  it('keeps instructions given as a plain string', () => {
    const v = values(
      JSON.stringify({ title: 'Test', instructions: '  Bare gjør det.  ' }),
    )

    expect(v.instructions).toBe('Bare gjør det.')
  })

  it('falls back to a single empty ingredient row when none are given', () => {
    const empty = { name: '', quantity: '', unit: '', note: '' }

    expect(values(JSON.stringify({ title: 'A' })).ingredients).toEqual([empty])
    expect(
      values(JSON.stringify({ title: 'A', ingredients: [] })).ingredients,
    ).toEqual([empty])
    expect(
      values(JSON.stringify({ title: 'A', ingredients: [{ name: '' }] }))
        .ingredients,
    ).toEqual([empty])
  })

  it('accepts snake_case / alias keys (source_url, image, steps, ingredient)', () => {
    const v = values(
      JSON.stringify({
        title: 'Test',
        source_url: 'https://example.com',
        image: 'https://example.com/p.jpg',
        steps: ['Gjør noe'],
        ingredients: [{ ingredient: 'Sukker', quantity: 2, unit: 'dl' }],
      }),
    )

    expect(v.sourceUrl).toBe('https://example.com')
    expect(v.imageUrl).toBe('https://example.com/p.jpg')
    expect(v.instructions).toBe('1. Gjør noe')
    expect(v.ingredients).toEqual([
      { name: 'Sukker', quantity: '2', unit: 'dl', note: '' },
    ])
  })

  it('falls back to the `amount`/`qty` aliases when `quantity` is absent', () => {
    const v = values(
      JSON.stringify({
        title: 'Test',
        ingredients: [
          { name: 'Sukker', amount: 2, unit: 'dl' },
          { name: 'Mel', qty: 300, unit: 'g' },
        ],
      }),
    )

    expect(v.ingredients).toEqual([
      { name: 'Sukker', quantity: '2', unit: 'dl', note: '' },
      { name: 'Mel', quantity: '300', unit: 'g', note: '' },
    ])
  })

  it('leaves servings blank when absent', () => {
    expect(values(JSON.stringify({ title: 'A' })).servings).toBe('')
    expect(values(JSON.stringify({ title: 'A' })).uploadedImageUrl).toBeNull()
  })
})
