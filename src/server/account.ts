import { createServerFn } from '@tanstack/react-start'
import { and, eq, ne } from 'drizzle-orm'

import { db } from '@/db'
import {
  householdMember,
  ingredientCatalog,
  shoppingCheck,
  shoppingEntry,
  user as userTable,
} from '@/db/schema'
import { requireUser } from '@/server/auth'
import { accessibleScope } from '@/server/sharing'

/**
 * Permanently delete the signed-in user and their data.
 *
 * Deleting the user row cascades (FK onDelete) to: sessions, accounts, the
 * user's recipes — and through them their ingredients, uploaded images and
 * ratings — plus household membership, sent invites, and the user's own recipe
 * ratings.
 *
 * The shopping list and household ingredient-catalog rows key off an opaque
 * household `scopeId` (not a user FK), so they aren't cascaded. We clear them
 * here, but only when the household scope has no *other* members left — so when
 * you share with someone, deleting your account leaves their shared list intact.
 *
 * Note: recipes you own are removed for everyone you shared them with — that's
 * inherent to deleting "your data".
 */
export const deleteAccount = createServerFn({ method: 'POST' }).handler(
  async () => {
    const me = await requireUser()
    const { householdId } = await accessibleScope(me.id)

    const others = await db
      .select({ userId: householdMember.userId })
      .from(householdMember)
      .where(
        and(
          eq(householdMember.householdId, householdId),
          ne(householdMember.userId, me.id),
        ),
      )
    const scopeBecomesEmpty = others.length === 0

    await db.transaction(async (tx) => {
      if (scopeBecomesEmpty) {
        // No one left to share with — take the list + custom catalog with us.
        await tx
          .delete(shoppingEntry)
          .where(eq(shoppingEntry.scopeId, householdId))
        await tx
          .delete(shoppingCheck)
          .where(eq(shoppingCheck.scopeId, householdId))
        await tx
          .delete(ingredientCatalog)
          .where(eq(ingredientCatalog.scopeId, householdId))
      }
      // Cascades clean up sessions, accounts, recipes (+ ingredients, images,
      // ratings), household membership, and sent invites.
      await tx.delete(userTable).where(eq(userTable.id, me.id))
    })

    return { ok: true }
  },
)
