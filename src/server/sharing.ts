import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { householdMember, invite, user as userTable } from '@/db/schema'
import { requireUser } from '@/server/auth'

/**
 * Server-only: the shared scope for a user. Returns the household id (used to
 * scope the shopping list) and the set of owner ids whose recipes the user may
 * administer (everyone in the same household; just themselves when solo).
 */
export const accessibleScope = createServerOnlyFn(async (userId: string) => {
  const [mine] = await db
    .select({ householdId: householdMember.householdId })
    .from(householdMember)
    .where(eq(householdMember.userId, userId))
    .limit(1)

  const householdId = mine?.householdId ?? userId

  const members = mine
    ? await db
        .select({ userId: householdMember.userId })
        .from(householdMember)
        .where(eq(householdMember.householdId, householdId))
    : []

  const ownerIds = new Set<string>([userId])
  for (const m of members) ownerIds.add(m.userId)

  return { householdId, ownerIds: [...ownerIds] }
})

/* ------------------------------- invites -------------------------------- */

export interface PendingInvite {
  id: string
  fromName: string
  fromEmail: string
}

/** Pending invites addressed to the current user (drives the login notice). */
export const getPendingInvites = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PendingInvite[]> => {
    const user = await requireUser()
    const rows = await db
      .select({
        id: invite.id,
        fromName: userTable.name,
        fromEmail: userTable.email,
      })
      .from(invite)
      .innerJoin(userTable, eq(userTable.id, invite.fromUserId))
      .where(eq(invite.toEmail, user.email.toLowerCase()))
    return rows
  },
)

export interface SharingOverview {
  me: string
  /** Other people in my household (we share everything). */
  householdMembers: { id: string; name: string; email: string }[]
  /** Emails I've invited that haven't responded yet. */
  sentInvites: string[]
  /** Invites waiting for my response. */
  pendingForMe: PendingInvite[]
}

export const getSharing = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SharingOverview> => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)

    const members = await db
      .select({ id: userTable.id, name: userTable.name, email: userTable.email })
      .from(householdMember)
      .innerJoin(userTable, eq(userTable.id, householdMember.userId))
      .where(
        and(
          eq(householdMember.householdId, householdId),
          ne(householdMember.userId, user.id),
        ),
      )

    const sent = await db
      .select({ toEmail: invite.toEmail })
      .from(invite)
      .where(eq(invite.fromUserId, user.id))

    const pendingForMe = await db
      .select({
        id: invite.id,
        fromName: userTable.name,
        fromEmail: userTable.email,
      })
      .from(invite)
      .innerJoin(userTable, eq(userTable.id, invite.fromUserId))
      .where(eq(invite.toEmail, user.email.toLowerCase()))

    return {
      me: user.email,
      householdMembers: members,
      sentInvites: sent.map((s) => s.toEmail).sort(),
      pendingForMe,
    }
  },
)

export const sendInvite = createServerFn({ method: 'POST' })
  .validator((email: unknown) =>
    z.string().trim().email('Ugyldig e-postadresse').parse(email).toLowerCase(),
  )
  .handler(async ({ data: email }) => {
    const user = await requireUser()
    if (email === user.email.toLowerCase()) {
      throw new Error('Du kan ikke invitere deg selv')
    }
    await db
      .insert(invite)
      .values({ fromUserId: user.id, toEmail: email })
      .onConflictDoNothing({ target: [invite.fromUserId, invite.toEmail] })
    return { email }
  })

export const cancelInvite = createServerFn({ method: 'POST' })
  .validator((email: unknown) => z.string().trim().toLowerCase().parse(email))
  .handler(async ({ data: email }) => {
    const user = await requireUser()
    await db
      .delete(invite)
      .where(and(eq(invite.fromUserId, user.id), eq(invite.toEmail, email)))
    return { email }
  })

export const acceptInvite = createServerFn({ method: 'POST' })
  .validator((id: unknown) => z.string().min(1).parse(id))
  .handler(async ({ data: id }) => {
    const user = await requireUser()
    const [row] = await db.select().from(invite).where(eq(invite.id, id)).limit(1)
    if (!row || row.toEmail !== user.email.toLowerCase()) {
      throw new Error('Invitasjonen finnes ikke')
    }

    await db.transaction(async (tx) => {
      // Find (or materialise) the inviter's household.
      const [inviterRow] = await tx
        .select({ householdId: householdMember.householdId })
        .from(householdMember)
        .where(eq(householdMember.userId, row.fromUserId))
        .limit(1)

      const householdId = inviterRow?.householdId ?? crypto.randomUUID()
      if (!inviterRow) {
        await tx
          .insert(householdMember)
          .values({ userId: row.fromUserId, householdId })
          .onConflictDoNothing()
      }

      // Join (or move into) that household.
      await tx
        .insert(householdMember)
        .values({ userId: user.id, householdId })
        .onConflictDoUpdate({
          target: householdMember.userId,
          set: { householdId },
        })

      await tx.delete(invite).where(eq(invite.id, id))
    })

    return { ok: true }
  })

export const declineInvite = createServerFn({ method: 'POST' })
  .validator((id: unknown) => z.string().min(1).parse(id))
  .handler(async ({ data: id }) => {
    const user = await requireUser()
    await db
      .delete(invite)
      .where(and(eq(invite.id, id), eq(invite.toEmail, user.email.toLowerCase())))
    return { ok: true }
  })

/** Leave the shared household and go back to a private collection. */
export const leaveHousehold = createServerFn({ method: 'POST' }).handler(
  async () => {
    const user = await requireUser()
    await db.delete(householdMember).where(eq(householdMember.userId, user.id))
    return { ok: true }
  },
)

/**
 * Remove one other person from my household; everyone else stays. The removed
 * member reverts to their own private collection (same effect as them leaving).
 * Scoped to my household, so I can only remove people I actually share with.
 */
export const removeHouseholdMember = createServerFn({ method: 'POST' })
  .validator((userId: unknown) => z.string().min(1).parse(userId))
  .handler(async ({ data: targetUserId }) => {
    const user = await requireUser()
    if (targetUserId === user.id) {
      throw new Error('Bruk «Slutt å dele» for å forlate husholdningen selv')
    }
    const { householdId } = await accessibleScope(user.id)
    await db
      .delete(householdMember)
      .where(
        and(
          eq(householdMember.userId, targetUserId),
          eq(householdMember.householdId, householdId),
        ),
      )
    return { ok: true }
  })
