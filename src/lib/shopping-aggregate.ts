/**
 * Pure, client-safe shopping-list aggregation. Lives in `lib` (no db imports) so
 * both the server (`getShoppingList`) and the realtime client view can fold the
 * same `shopping_entry` rows into the same displayed list — one source of truth,
 * no drift between the SSR snapshot and the Electric-synced live list.
 */

export interface ShoppingItem {
  key: string
  name: string
  unit: string | null
  /** Summed quantity across contributions, or null if none of them were quantified. */
  quantity: number | null
  /**
   * Manual per-line quantity override, or null when none is set. The displayed
   * amount is `overrideQuantity ?? quantity` — keeping these separate (rather
   * than baking the override into `quantity`) lets the client revert a cleared
   * override to the computed sum optimistically, without a round-trip.
   */
  overrideQuantity: number | null
  /** True when at least one contributing entry had no numeric quantity (e.g. "to taste"). */
  hasUnquantified: boolean
  /** Titles of the recipes that contributed this item (empty for ad-hoc items). */
  sources: string[]
  /** Grocery category for grouping, resolved from the ingredient catalog by name. */
  category: string
  checked: boolean
}

export interface ShoppingList {
  /** Recipes currently contributing items to the list. */
  recipes: { id: string; title: string }[]
  items: ShoppingItem[]
  /**
   * The household scope id these checks belong to. The client needs it to build
   * optimistic rows for the realtime `shopping_check` collection (Electric).
   */
  scopeId: string
}

/** One `shopping_entry` contribution, in the shape the aggregation needs. */
export interface ShoppingEntryInput {
  itemKey: string
  name: string
  quantity: number | null
  unit: string | null
  sourceRecipeId: string | null
  sourceTitle: string | null
}

/**
 * Fold per-contribution entries into the displayed list: merge by item key
 * (summing quantities, collecting recipe sources), resolve each line's category
 * and checked state via the supplied lookups. Items sort checked-last, then by
 * name.
 */
export function aggregateShoppingEntries(
  entries: ShoppingEntryInput[],
  opts: {
    resolveCategory: (name: string) => string
    isChecked: (itemKey: string) => boolean
  },
): { recipes: { id: string; title: string }[]; items: ShoppingItem[] } {
  const map = new Map<string, ShoppingItem>()
  const recipes = new Map<string, string>() // id -> title

  for (const e of entries) {
    if (e.sourceRecipeId && e.sourceTitle) recipes.set(e.sourceRecipeId, e.sourceTitle)
    const existing = map.get(e.itemKey)
    if (existing) {
      if (e.quantity != null) {
        existing.quantity = (existing.quantity ?? 0) + e.quantity
      } else {
        existing.hasUnquantified = true
      }
      if (e.sourceTitle && !existing.sources.includes(e.sourceTitle)) {
        existing.sources.push(e.sourceTitle)
      }
    } else {
      map.set(e.itemKey, {
        key: e.itemKey,
        name: e.name.trim(),
        unit: e.unit,
        quantity: e.quantity ?? null,
        overrideQuantity: null,
        hasUnquantified: e.quantity == null,
        sources: e.sourceTitle ? [e.sourceTitle] : [],
        category: opts.resolveCategory(e.name),
        checked: opts.isChecked(e.itemKey),
      })
    }
  }

  const items = [...map.values()].sort((a, b) => {
    if (a.checked !== b.checked) return a.checked ? 1 : -1
    return a.name.localeCompare(b.name)
  })

  return {
    recipes: [...recipes].map(([id, title]) => ({ id, title })),
    items,
  }
}
