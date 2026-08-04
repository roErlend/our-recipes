/**
 * Pure, client-safe shopping-list aggregation. Lives in `lib` (no db imports) so
 * both the server (`getShoppingList`) and the realtime client view can fold the
 * same `shopping_entry` rows into the same displayed list — one source of truth,
 * no drift between the SSR snapshot and the Electric-synced live list.
 */

/** One displayed amount on a line — a per-unit bucket, already normalized. */
export interface ShoppingAmount {
  quantity: number
  unit: string | null
}

export interface ShoppingItem {
  key: string
  name: string
  /**
   * Per-unit amounts. Contributions merge by ingredient *name*, so the same
   * item from two recipes lands on one line even when their units differ —
   * «2 stk + 200 g» is one line, one checkbox. Compatible metric units are
   * normalized into a single bucket (900 g + 0,3 kg → 1,2 kg). Empty when no
   * contribution was quantified.
   */
  amounts: ShoppingAmount[]
  /**
   * Manual per-unit overrides: unit key (lowercased, '' = unitless) → quantity.
   * Applied onto `amounts` at display time via {@link applyOverrides} — an
   * override replaces the computed bucket of the same unit dimension, so each
   * unit of a multi-unit line («2 stk + 200 g») is adjustable independently.
   * Kept separate from `amounts` (rather than baked in) so the client can
   * revert a cleared override to the computed amounts optimistically, without
   * a round-trip. Empty object = no overrides.
   */
  overrides: Record<string, number>
  /** True when at least one contributing entry had no numeric quantity (e.g. "to taste"). */
  hasUnquantified: boolean
  /** Titles of the recipes that contributed this item (empty for ad-hoc items). */
  sources: string[]
  /** Grocery category for grouping, resolved from the ingredient catalog by name. */
  category: string
  /**
   * True when the ingredient is flagged as a pantry staple in the catalog
   * (resolved by name, like {@link category}). Staple lines are de-emphasized
   * into a "Har hjemme" section and left out of the "to buy" count.
   */
  isStaple: boolean
  checked: boolean
  /** When this line was last ticked off (epoch ms), or null when unchecked.
   *  Drives "most-recently-checked first" ordering in the checked section. */
  checkedAt: number | null
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

/** Normalized grouping key for a shopping line — the lowercased name. Unit is
 *  deliberately NOT part of the key: the same ingredient in different units is
 *  still one thing to buy, so it merges into one line (with per-unit amounts).
 *  Mirrored by `shopping_entry.item_key`; shared by the server and the client
 *  picker so a selected ingredient maps to exactly the line it produces. */
export function shoppingItemKey(name: string) {
  return name.trim().toLowerCase()
}

/* --------------------------- unit normalization -------------------------- */

/** Metric mass units → grams. */
const MASS: Record<string, number> = { g: 1, gram: 1, kg: 1000 }
/** Metric volume units → millilitres. */
const VOLUME: Record<string, number> = { ml: 1, cl: 10, dl: 100, l: 1000, liter: 1000 }

const round2 = (n: number) => Math.round(n * 100) / 100

/** Pick the friendliest display unit for a normalized bucket total. */
function displayAmount(dim: 'mass' | 'volume', base: number): ShoppingAmount {
  if (dim === 'mass') {
    return base >= 1000
      ? { quantity: round2(base / 1000), unit: 'kg' }
      : { quantity: round2(base), unit: 'g' }
  }
  if (base >= 1000) return { quantity: round2(base / 1000), unit: 'l' }
  if (base >= 100) return { quantity: round2(base / 100), unit: 'dl' }
  return { quantity: round2(base), unit: 'ml' }
}

/**
 * Fold raw (quantity, unit) contributions into displayed per-unit amounts:
 * compatible metric units are converted and summed into one bucket (mass /
 * volume); everything else ("ss", "stk", "fedd", unitless numbers…) sums within
 * its own unit. Buckets keep first-appearance order. Contributions without a
 * quantity only set `hasUnquantified`.
 */
export function mergeAmounts(
  contributions: { quantity: number | null; unit: string | null }[],
): { amounts: ShoppingAmount[]; hasUnquantified: boolean } {
  interface Bucket {
    dim: 'mass' | 'volume' | 'other'
    total: number
    /** Display label for 'other' buckets — the first-seen spelling. */
    label: string | null
  }
  const buckets = new Map<string, Bucket>()
  let hasUnquantified = false

  for (const c of contributions) {
    if (c.quantity == null) {
      hasUnquantified = true
      continue
    }
    const u = (c.unit ?? '').trim()
    const lower = u.toLowerCase()
    if (lower in MASS) {
      const b = buckets.get('mass') ?? { dim: 'mass' as const, total: 0, label: null }
      b.total += c.quantity * MASS[lower]
      buckets.set('mass', b)
    } else if (lower in VOLUME) {
      const b = buckets.get('volume') ?? { dim: 'volume' as const, total: 0, label: null }
      b.total += c.quantity * VOLUME[lower]
      buckets.set('volume', b)
    } else {
      const b = buckets.get(lower) ?? { dim: 'other' as const, total: 0, label: u || null }
      b.total += c.quantity
      buckets.set(lower, b)
    }
  }

  const amounts = [...buckets.values()].map((b) =>
    b.dim === 'other'
      ? { quantity: round2(b.total), unit: b.label }
      : displayAmount(b.dim, b.total),
  )
  return { amounts, hasUnquantified }
}

/* ------------------------------- overrides ------------------------------- */

/** Normalized unit key for the per-unit override map ('' = unitless). */
export function unitKeyOf(unit: string | null | undefined) {
  return (unit ?? '').trim().toLowerCase()
}

/**
 * The bucket a unit belongs to: 'mass' / 'volume' for the convertible metric
 * units, else the unit key itself. Overrides match computed buckets by
 * dimension, so an override saved as «kg» still replaces a bucket that happens
 * to display in «g» today.
 */
export function unitDimension(unit: string | null | undefined): string {
  const key = unitKeyOf(unit)
  if (key in MASS) return 'mass'
  if (key in VOLUME) return 'volume'
  return key
}

/**
 * Apply per-unit manual overrides onto the computed amounts: an override
 * replaces the computed bucket of the same unit dimension (shown in the
 * override's own unit); overrides with no matching bucket become buckets of
 * their own. Pure — used identically by the row display and the edit dialog.
 */
export function applyOverrides(
  amounts: ShoppingAmount[],
  overrides: Record<string, number>,
): ShoppingAmount[] {
  const entries = Object.entries(overrides)
  if (!entries.length) return amounts

  const used = new Set<string>()
  const result = amounts.map((a) => {
    const dim = unitDimension(a.unit)
    const hit = entries.find(([unitKey]) => unitDimension(unitKey) === dim)
    if (!hit) return a
    used.add(hit[0])
    return { quantity: hit[1], unit: hit[0] || null }
  })
  for (const [unitKey, quantity] of entries) {
    if (!used.has(unitKey)) result.push({ quantity, unit: unitKey || null })
  }
  return result
}

/* ------------------------------ aggregation ------------------------------ */

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
 * (bucketing quantities per unit via {@link mergeAmounts}, collecting recipe
 * sources), resolve each line's category and checked state via the supplied
 * lookups. Items sort checked-last, then by name.
 */
export function aggregateShoppingEntries(
  entries: ShoppingEntryInput[],
  opts: {
    resolveCategory: (name: string) => string
    isChecked: (itemKey: string) => boolean
    /** Whether the ingredient is a pantry staple. Defaults to never. */
    isStaple?: (name: string) => boolean
    /** When the line was checked (epoch ms), or null. Defaults to null. */
    checkedAt?: (itemKey: string) => number | null
  },
): { recipes: { id: string; title: string }[]; items: ShoppingItem[] } {
  const grouped = new Map<string, ShoppingEntryInput[]>()
  const recipes = new Map<string, string>() // id -> title

  for (const e of entries) {
    if (e.sourceRecipeId && e.sourceTitle) recipes.set(e.sourceRecipeId, e.sourceTitle)
    const list = grouped.get(e.itemKey)
    if (list) list.push(e)
    else grouped.set(e.itemKey, [e])
  }

  const items = [...grouped.entries()].map(([key, group]): ShoppingItem => {
    const { amounts, hasUnquantified } = mergeAmounts(group)
    const sources: string[] = []
    for (const e of group) {
      if (e.sourceTitle && !sources.includes(e.sourceTitle)) sources.push(e.sourceTitle)
    }
    const name = group[0].name.trim()
    return {
      key,
      name,
      amounts,
      overrides: {},
      hasUnquantified,
      sources,
      category: opts.resolveCategory(name),
      isStaple: opts.isStaple?.(name) ?? false,
      checked: opts.isChecked(key),
      checkedAt: opts.checkedAt?.(key) ?? null,
    }
  })

  items.sort((a, b) => {
    if (a.checked !== b.checked) return a.checked ? 1 : -1
    // Among checked items, most-recently-checked first; otherwise by name.
    if (a.checked)
      return (b.checkedAt ?? 0) - (a.checkedAt ?? 0) || a.name.localeCompare(b.name)
    return a.name.localeCompare(b.name)
  })

  return {
    recipes: [...recipes].map(([id, title]) => ({ id, title })),
    items,
  }
}
