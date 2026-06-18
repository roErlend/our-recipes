import { queryOptions } from '@tanstack/react-query'

import { getRecipe, listRecipes } from '@/server/recipes'
import { getShoppingList } from '@/server/shopping'

/** All recipes (active toggle + search filter happen client-side). */
export const recipesQueryOptions = () =>
  queryOptions({
    queryKey: ['recipes'] as const,
    queryFn: () => listRecipes(),
  })

/** A single recipe with its ingredients. */
export const recipeQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['recipe', id] as const,
    queryFn: () => getRecipe({ data: id }),
  })

/** Aggregated shopping list across active recipes. */
export const shoppingQueryOptions = () =>
  queryOptions({
    queryKey: ['shopping'] as const,
    queryFn: () => getShoppingList(),
  })
