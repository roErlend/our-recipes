import { describe, expect, it } from 'vitest'

import {
  aggregateShoppingEntries,
  applyOverrides,
  mergeAmounts,
  shoppingItemKey,
  type ShoppingEntryInput,
} from '@/lib/shopping-aggregate'

/** Defaults so each test only specifies the fields it cares about. */
const entry = (over: Partial<ShoppingEntryInput>): ShoppingEntryInput => ({
  itemKey: 'flour',
  name: 'Mel',
  quantity: null,
  unit: null,
  sourceRecipeId: null,
  sourceTitle: null,
  ...over,
})

const noChecks = () => false
const cat = (_: string) => 'Annet'

describe('shoppingItemKey', () => {
  it('is the lowercased, trimmed name — no unit', () => {
    expect(shoppingItemKey('  Løk ')).toBe('løk')
  })
})

describe('mergeAmounts', () => {
  it('sums within a unit', () => {
    expect(
      mergeAmounts([
        { quantity: 2, unit: 'stk' },
        { quantity: 3, unit: 'stk' },
      ]).amounts,
    ).toEqual([{ quantity: 5, unit: 'stk' }])
  })

  it('keeps incompatible units as separate buckets, first-seen order', () => {
    expect(
      mergeAmounts([
        { quantity: 2, unit: 'stk' },
        { quantity: 200, unit: 'g' },
      ]).amounts,
    ).toEqual([
      { quantity: 2, unit: 'stk' },
      { quantity: 200, unit: 'g' },
    ])
  })

  it('converts and merges compatible metric units', () => {
    expect(
      mergeAmounts([
        { quantity: 900, unit: 'g' },
        { quantity: 0.3, unit: 'kg' },
      ]).amounts,
    ).toEqual([{ quantity: 1.2, unit: 'kg' }])
    expect(
      mergeAmounts([
        { quantity: 1, unit: 'dl' },
        { quantity: 50, unit: 'ml' },
      ]).amounts,
    ).toEqual([{ quantity: 1.5, unit: 'dl' }])
  })

  it('picks a friendly display unit for the bucket total', () => {
    expect(mergeAmounts([{ quantity: 400, unit: 'g' }]).amounts).toEqual([
      { quantity: 400, unit: 'g' },
    ])
    expect(mergeAmounts([{ quantity: 1500, unit: 'ml' }]).amounts).toEqual([
      { quantity: 1.5, unit: 'l' },
    ])
    expect(mergeAmounts([{ quantity: 60, unit: 'ml' }]).amounts).toEqual([
      { quantity: 60, unit: 'ml' },
    ])
  })

  it('buckets unit spellings case-insensitively, keeping the first-seen label', () => {
    expect(
      mergeAmounts([
        { quantity: 1, unit: 'ss' },
        { quantity: 2, unit: 'SS' },
      ]).amounts,
    ).toEqual([{ quantity: 3, unit: 'ss' }])
  })

  it('flags unquantified contributions without creating a bucket', () => {
    const { amounts, hasUnquantified } = mergeAmounts([
      { quantity: null, unit: null },
      { quantity: 2, unit: 'stk' },
    ])
    expect(amounts).toEqual([{ quantity: 2, unit: 'stk' }])
    expect(hasUnquantified).toBe(true)
  })
})

describe('applyOverrides', () => {
  it('replaces only the overridden unit, leaving the others computed', () => {
    const amounts = [
      { quantity: 2, unit: 'stk' },
      { quantity: 200, unit: 'g' },
    ]
    expect(applyOverrides(amounts, { stk: 4 })).toEqual([
      { quantity: 4, unit: 'stk' },
      { quantity: 200, unit: 'g' },
    ])
  })

  it('matches by unit dimension, so a kg override replaces a g bucket', () => {
    expect(applyOverrides([{ quantity: 900, unit: 'g' }], { kg: 2 })).toEqual([
      { quantity: 2, unit: 'kg' },
    ])
  })

  it('appends overrides with no matching bucket', () => {
    expect(applyOverrides([{ quantity: 2, unit: 'stk' }], { g: 500 })).toEqual([
      { quantity: 2, unit: 'stk' },
      { quantity: 500, unit: 'g' },
    ])
  })

  it('returns the computed amounts untouched when there are no overrides', () => {
    const amounts = [{ quantity: 2, unit: 'stk' }]
    expect(applyOverrides(amounts, {})).toBe(amounts)
  })

  it("treats the '' key as a unitless amount", () => {
    expect(applyOverrides([{ quantity: 2, unit: null }], { '': 5 })).toEqual([
      { quantity: 5, unit: null },
    ])
  })
})

describe('aggregateShoppingEntries', () => {
  it('sums quantities for contributions sharing an itemKey', () => {
    const { items } = aggregateShoppingEntries(
      [
        entry({ itemKey: 'flour', quantity: 200, unit: 'g' }),
        entry({ itemKey: 'flour', quantity: 300, unit: 'g' }),
      ],
      { resolveCategory: cat, isChecked: noChecks },
    )

    expect(items).toHaveLength(1)
    expect(items[0].amounts).toEqual([{ quantity: 500, unit: 'g' }])
    expect(items[0].hasUnquantified).toBe(false)
  })

  it('merges different units of the same item into one line with per-unit amounts', () => {
    const { items } = aggregateShoppingEntries(
      [
        entry({ itemKey: 'løk', name: 'Løk', quantity: 2, unit: 'stk' }),
        entry({ itemKey: 'løk', name: 'Løk', quantity: 200, unit: 'g' }),
      ],
      { resolveCategory: cat, isChecked: noChecks },
    )

    expect(items).toHaveLength(1)
    expect(items[0].amounts).toEqual([
      { quantity: 2, unit: 'stk' },
      { quantity: 200, unit: 'g' },
    ])
  })

  it('collects and dedupes sourceTitles into sources', () => {
    const { items } = aggregateShoppingEntries(
      [
        entry({ itemKey: 'flour', quantity: 1, sourceRecipeId: 'r1', sourceTitle: 'Brød' }),
        entry({ itemKey: 'flour', quantity: 1, sourceRecipeId: 'r2', sourceTitle: 'Kake' }),
        entry({ itemKey: 'flour', quantity: 1, sourceRecipeId: 'r3', sourceTitle: 'Brød' }),
      ],
      { resolveCategory: cat, isChecked: noChecks },
    )

    expect(items[0].sources).toEqual(['Brød', 'Kake'])
  })

  it('sets hasUnquantified when any merged contribution has a null quantity', () => {
    const { items } = aggregateShoppingEntries(
      [
        entry({ itemKey: 'salt', name: 'Salt', quantity: 5, unit: 'g' }),
        entry({ itemKey: 'salt', name: 'Salt', quantity: null }),
      ],
      { resolveCategory: cat, isChecked: noChecks },
    )

    expect(items[0].amounts).toEqual([{ quantity: 5, unit: 'g' }])
    expect(items[0].hasUnquantified).toBe(true)
  })

  it('leaves amounts empty and flags unquantified for a lone null-quantity entry', () => {
    const { items } = aggregateShoppingEntries(
      [entry({ itemKey: 'pepper', name: 'Pepper', quantity: null })],
      { resolveCategory: cat, isChecked: noChecks },
    )

    expect(items[0].amounts).toEqual([])
    expect(items[0].hasUnquantified).toBe(true)
  })

  it('never sets overrides (always defaults to empty)', () => {
    const { items } = aggregateShoppingEntries(
      [entry({ itemKey: 'flour', quantity: 100 })],
      { resolveCategory: cat, isChecked: noChecks },
    )

    expect(items[0].overrides).toEqual({})
  })

  it('builds recipes from distinct (sourceRecipeId, sourceTitle) pairs', () => {
    const { recipes } = aggregateShoppingEntries(
      [
        entry({ itemKey: 'a', sourceRecipeId: 'r1', sourceTitle: 'Brød' }),
        entry({ itemKey: 'b', sourceRecipeId: 'r1', sourceTitle: 'Brød' }),
        entry({ itemKey: 'c', sourceRecipeId: 'r2', sourceTitle: 'Kake' }),
      ],
      { resolveCategory: cat, isChecked: noChecks },
    )

    expect(recipes).toEqual([
      { id: 'r1', title: 'Brød' },
      { id: 'r2', title: 'Kake' },
    ])
  })

  it('does not add a recipe for ad-hoc entries (null sourceRecipeId)', () => {
    const { recipes, items } = aggregateShoppingEntries(
      [entry({ itemKey: 'a', name: 'Banan', sourceRecipeId: null, sourceTitle: null })],
      { resolveCategory: cat, isChecked: noChecks },
    )

    expect(recipes).toEqual([])
    expect(items[0].sources).toEqual([])
  })

  it('sorts checked items last, then alphabetically by name', () => {
    const checked = new Set(['c'])
    const { items } = aggregateShoppingEntries(
      [
        entry({ itemKey: 'c', name: 'Banan' }),
        entry({ itemKey: 'b', name: 'Eple' }),
        entry({ itemKey: 'a', name: 'Agurk' }),
      ],
      {
        resolveCategory: cat,
        isChecked: (key) => checked.has(key),
      },
    )

    expect(items.map((i) => i.name)).toEqual(['Agurk', 'Eple', 'Banan'])
    expect(items.map((i) => i.checked)).toEqual([false, false, true])
  })

  it('orders checked items most-recently-checked first', () => {
    const checkedAt: Record<string, number> = { a: 100, b: 300, c: 200 }
    const { items } = aggregateShoppingEntries(
      [
        entry({ itemKey: 'a', name: 'Agurk' }),
        entry({ itemKey: 'b', name: 'Banan' }),
        entry({ itemKey: 'c', name: 'Eple' }),
      ],
      {
        resolveCategory: cat,
        isChecked: () => true,
        checkedAt: (key) => checkedAt[key] ?? null,
      },
    )

    // Highest timestamp first: b (300) → c (200) → a (100).
    expect(items.map((i) => i.name)).toEqual(['Banan', 'Eple', 'Agurk'])
    expect(items.map((i) => i.checkedAt)).toEqual([300, 200, 100])
  })

  it('derives category and checked from the injected callbacks', () => {
    const { items } = aggregateShoppingEntries(
      [entry({ itemKey: 'flour', name: 'Mel', quantity: 1 })],
      {
        resolveCategory: (name) => `cat:${name}`,
        isChecked: (key) => key === 'flour',
      },
    )

    expect(items[0].category).toBe('cat:Mel')
    expect(items[0].checked).toBe(true)
  })

  it('defaults isStaple to false when no resolver is supplied', () => {
    const { items } = aggregateShoppingEntries(
      [entry({ itemKey: 'flour', name: 'Mel', quantity: 1 })],
      { resolveCategory: cat, isChecked: noChecks },
    )

    expect(items[0].isStaple).toBe(false)
  })

  it('resolves isStaple by name from the injected callback', () => {
    const { items } = aggregateShoppingEntries(
      [
        entry({ itemKey: 'salt', name: 'Salt', quantity: 1 }),
        entry({ itemKey: 'flour', name: 'Mel', quantity: 1 }),
      ],
      {
        resolveCategory: cat,
        isChecked: noChecks,
        isStaple: (name) => name === 'Salt',
      },
    )

    const byName = Object.fromEntries(items.map((i) => [i.name, i.isStaple]))
    expect(byName).toEqual({ Salt: true, Mel: false })
  })

  it('trims the item name from the first contribution', () => {
    const { items } = aggregateShoppingEntries(
      [entry({ itemKey: 'flour', name: '  Mel  ', quantity: 1 })],
      { resolveCategory: cat, isChecked: noChecks },
    )

    expect(items[0].name).toBe('Mel')
  })
})
