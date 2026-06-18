import { queryOptions } from '@tanstack/react-query'

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

/** Aggregated shopping list across active recipes. */
export const shoppingQueryOptions = () =>
  queryOptions({
    queryKey: ['shopping'] as const,
    queryFn: () => getShoppingList(),
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
