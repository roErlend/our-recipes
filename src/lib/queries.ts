import { queryOptions } from '@tanstack/react-query'

import { withOfflineCache } from '@/lib/offline'
import { adminListIngredients } from '@/server/admin'
import { listCategories, listIngredients } from '@/server/ingredients'
import { getRecipe, listRecipes } from '@/server/recipes'
import { getShoppingList } from '@/server/shopping'
import { getPendingInvites, getSharing } from '@/server/sharing'

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

/** Aggregated shopping list across active recipes. Cached for offline use so the
 *  list still opens in a shop with no signal (see {@link withOfflineCache}). */
export const shoppingQueryOptions = () =>
  queryOptions({
    queryKey: ['shopping'] as const,
    queryFn: withOfflineCache('shopping', () => getShoppingList()),
  })

/**
 * The household's ingredient catalog for the add-box autocomplete. Preloaded
 * (route loader) and cached with a long staleTime — the catalog changes rarely,
 * and saving a new ingredient invalidates this key explicitly.
 */
export const ingredientsQueryOptions = () =>
  queryOptions({
    queryKey: ['ingredients'] as const,
    queryFn: withOfflineCache('ingredients', () => listIngredients()),
    staleTime: 5 * 60 * 1000,
  })

/** All available category names (canonical ∪ admin-created). */
export const categoriesQueryOptions = () =>
  queryOptions({
    queryKey: ['categories'] as const,
    queryFn: withOfflineCache('categories', () => listCategories()),
    staleTime: 5 * 60 * 1000,
  })

/** Sharing overview: household members, sent invites, invites awaiting me. */
export const sharingQueryOptions = () =>
  queryOptions({
    queryKey: ['sharing'] as const,
    queryFn: () => getSharing(),
  })

/** Pending invites addressed to me (drives the login notification). */
export const pendingInvitesQueryOptions = () =>
  queryOptions({
    queryKey: ['pending-invites'] as const,
    queryFn: () => getPendingInvites(),
  })

/** Admin-only: the full ingredient catalog for cleanup/editing. */
export const adminIngredientsQueryOptions = () =>
  queryOptions({
    queryKey: ['admin', 'ingredients'] as const,
    queryFn: () => adminListIngredients(),
  })
