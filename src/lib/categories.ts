/**
 * Grocery categories for the saved-ingredient catalog and shopping-list
 * grouping. Client-safe (no server imports) so both the catalog UI and the
 * shopping list share one canonical, ordered list — the order here is the order
 * sections appear on the shopping list (roughly a walk through the store).
 */
export const INGREDIENT_CATEGORIES = [
  'Frukt og grønt',
  'Kjøtt og fisk',
  'Meieri og egg',
  'Brød og bakeri',
  'Tørrvarer og pasta',
  'Hermetikk og konserves',
  'Krydder og saus',
  'Frysevarer',
  'Drikke',
  'Snacks og godteri',
  'Husholdning',
  'Annet',
] as const

export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number]

/** Fallback category for ingredients with no catalog entry / no category. */
export const DEFAULT_CATEGORY: IngredientCategory = 'Annet'

const ORDER = new Map(INGREDIENT_CATEGORIES.map((c, i) => [c, i]))

/** True if `name` is one of the built-in categories (which always exist). */
export function isCanonicalCategory(name: string): boolean {
  return ORDER.has(name as IngredientCategory)
}

/** Sort key for a category — unknown values sort just before "Annet". */
export function categoryRank(category: string): number {
  return ORDER.get(category as IngredientCategory) ?? ORDER.size - 1.5
}

/**
 * Clean a stored category: keep any non-empty value (custom categories are
 * allowed — they sort just before "Annet" via {@link categoryRank}), falling
 * back to the default only for null/blank.
 */
export function normalizeCategory(value: string | null | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : DEFAULT_CATEGORY
}
