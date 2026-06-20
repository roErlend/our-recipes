import { describe, expect, it } from 'vitest'

import {
  aggregateShoppingEntries,
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

describe('aggregateShoppingEntries', () => {
  it('sums quantities for contributions sharing an itemKey', () => {
    const { items } = aggregateShoppingEntries(
      [
        entry({ itemKey: 'flour', quantity: 200 }),
        entry({ itemKey: 'flour', quantity: 300 }),
      ],
      { resolveCategory: cat, isChecked: noChecks },
    )

    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBe(500)
    expect(items[0].hasUnquantified).toBe(false)
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
        entry({ itemKey: 'salt', name: 'Salt', quantity: 5 }),
        entry({ itemKey: 'salt', name: 'Salt', quantity: null }),
      ],
      { resolveCategory: cat, isChecked: noChecks },
    )

    expect(items[0].quantity).toBe(5)
    expect(items[0].hasUnquantified).toBe(true)
  })

  it('leaves quantity null and flags unquantified for a lone null-quantity entry', () => {
    const { items } = aggregateShoppingEntries(
      [entry({ itemKey: 'pepper', name: 'Pepper', quantity: null })],
      { resolveCategory: cat, isChecked: noChecks },
    )

    expect(items[0].quantity).toBeNull()
    expect(items[0].hasUnquantified).toBe(true)
  })

  it('never sets overrideQuantity (always defaults to null)', () => {
    const { items } = aggregateShoppingEntries(
      [entry({ itemKey: 'flour', quantity: 100 })],
      { resolveCategory: cat, isChecked: noChecks },
    )

    expect(items[0].overrideQuantity).toBeNull()
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
