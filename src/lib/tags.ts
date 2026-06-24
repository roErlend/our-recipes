/**
 * Meal-type tags we treat as "default": offered as one-tap suggestions on the
 * recipe form and grouped into their own prominent section in the overview
 * filter. Tags stay free-form everywhere else — these are just the common ones
 * surfaced first. Order here is the display order (not alphabetical).
 */
export const MEAL_TAGS = ['middag', 'frokost', 'dessert'] as const

const MEAL_TAG_SET = new Set<string>(MEAL_TAGS)

/** Whether a tag is one of the default meal-type tags. */
export function isMealTag(tag: string): boolean {
  return MEAL_TAG_SET.has(tag)
}
