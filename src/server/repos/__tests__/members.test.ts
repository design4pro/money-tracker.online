/**
 * Workspace sharing, against a real SQLite built from `drizzle/*.sql`.
 *
 * The file is organised around the four claims `members.ts` makes, because they are the reason it
 * exists rather than being a thin wrapper over two tables:
 *
 * 1. **The owner/admin line holds.** An admin may run the household's membership and may not touch
 *    its ownership.
 * 2. **A workspace always keeps an owner.** Demote, remove and leave all refuse the last one.
 * 3. **Removing somebody removes access, not work.** Their transactions, accounts and balances are
 *    byte-for-byte unchanged afterwards.
 * 4. **Seats count invitations too**, and the ceiling is the plan's — asserted with the *real*
 *    resolver installed, so the wiring between `plans.ts`, `resolveLimits` and `assertWithinLimit`
 *    is what is under test rather than a stand-in for it.
 *
 * Acceptance gets the sharpest cases, because it is the one path that acts on a workspace the
 * caller is not yet in: a foreign id, a mismatched address, an expired link and a revoked one.
 */

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { invitation, member, user } from '#/server/db/auth-schema'
import { transactions } from '#/server/db/schema'
import { resolveLimit } from '#/server/billing/resolve-limits'

import { setLimitResolver } from '../base'
import {
  INVITATION_TTL_DAYS,
  acceptInvitation,
  changeMemberRole,
  getInvitationView,
  inviteMember,
  leaveWorkspace,
  listInvitations,
  listMembers,
  removeMember,
  renewInvitation,
  revokeInvitation,
  workspaceName,
} from '../members'
import {
  NOW,
  addSecondMember,
  createBudgetWorld,
  seedTransaction,
} from './budget-harness'

import type { BudgetWorld } from './budget-harness'

const DAY_MS = 24 * 60 * 60 * 1000

let world: BudgetWorld

beforeEach(async () => {
  world = await createBudgetWorld()
  // The product's own resolver, not a stand-in: the seat ceiling under test is the free plan's,
  // resolved the same way a request would resolve it.
  setLimitResolver((scope, metric) => resolveLimit(scope, metric, NOW))
})

afterEach(() => {
  setLimitResolver(null)
})

/** A scope for workspace A with a role other than owner. */
function asRole(role: 'admin' | 'member', userId = 'user-a') {
  return Object.freeze({
    db: world.db,
    ctx: Object.freeze({ userId, organizationId: 'org-a', role }),
  })
}

/** Somebody with an account but no membership of A, so they can be invited and can accept. */
async function seedOutsider(): Promise<void> {
  await world.db.insert(user).values({
    id: 'user-c',
    name: 'C',
    email: 'c@example.com',
    emailVerified: true,
    createdAt: NOW,
    updatedAt: NOW,
  })
}

async function seedInvitation(
  overrides: Partial<typeof invitation.$inferInsert> = {},
): Promise<string> {
  const id = overrides.id ?? 'inv-1'
  await world.db.insert(invitation).values({
    id,
    organizationId: 'org-a',
    email: 'c@example.com',
    role: 'member',
    status: 'pending',
    inviterId: 'user-a',
    expiresAt: new Date(NOW.getTime() + INVITATION_TTL_DAYS * DAY_MS),
    createdAt: NOW,
    ...overrides,
  })
  return id
}

/** Raise the household ceiling so a case about something *other* than seats can run. */
async function withSeats(count: number): Promise<void> {
  setLimitResolver(async (_scope, metric) =>
    metric === 'members' ? count : Number.POSITIVE_INFINITY,
  )
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

describe('the list is the workspace’s own', () => {
  it('joins each membership with the account behind it', async () => {
    const members = await listMembers(world.scope)
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({
      userId: 'user-a',
      email: 'a@example.com',
      role: 'owner',
    })
  })

  it('never shows another workspace’s people', async () => {
    await addSecondMember(world.db)
    const mine = await listMembers(world.scope)
    const theirs = await listMembers(world.otherScope)

    expect(mine.map((person) => person.userId).toSorted()).toEqual([
      'user-a',
      'user-b',
    ])
    expect(theirs.map((person) => person.userId)).toEqual(['user-b'])
  })

  it('names the workspace the invitation email will name', async () => {
    await expect(workspaceName(world.scope)).resolves.toBe('A')
  })
})

/* -------------------------------------------------------------------------- */
/* Inviting                                                                    */
/* -------------------------------------------------------------------------- */

describe('inviting', () => {
  it('is refused for a member, before anything else is checked', async () => {
    await expect(
      inviteMember(asRole('member'), {
        email: 'c@example.com',
        role: 'member',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(listInvitations(world.scope)).resolves.toEqual([])
  })

  it('creates a pending invitation an admin can see', async () => {
    await withSeats(6)
    await inviteMember(world.scope, { email: 'C@Example.com', role: 'admin' })

    const pending = await listInvitations(world.scope)
    expect(pending).toHaveLength(1)
    // Lowercased on the way in: one mailbox, one row, and an accept that cannot fail on a capital.
    expect(pending[0]).toMatchObject({ email: 'c@example.com', role: 'admin' })
    expect(pending[0].expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('refuses an address that is already in the workspace', async () => {
    await withSeats(6)
    await expect(
      inviteMember(world.scope, { email: 'a@example.com', role: 'member' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('refuses a second invitation to the same address', async () => {
    await withSeats(6)
    await seedInvitation()
    await expect(
      inviteMember(world.scope, { email: 'c@example.com', role: 'member' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  /**
   * The free plan sells one seat, and the workspace already holds it. This runs against the real
   * resolver, so it fails if the catalogue, the resolver or the call site stop agreeing.
   */
  it('refuses when the plan’s seats are gone', async () => {
    await expect(
      inviteMember(world.scope, { email: 'c@example.com', role: 'member' }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', metric: 'members' })
  })

  it('counts a pending invitation as a seat', async () => {
    await withSeats(2)
    await seedInvitation({ email: 'c@example.com' })
    await expect(
      inviteMember(world.scope, { email: 'd@example.com', role: 'member' }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', metric: 'members' })
  })

  it('extends the same invitation rather than issuing a second one', async () => {
    await withSeats(6)
    const id = await seedInvitation()
    const renewed = await renewInvitation(
      world.scope,
      id,
      new Date(NOW.getTime() + DAY_MS),
    )

    expect(renewed.id).toBe(id)
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(
      NOW.getTime() + INVITATION_TTL_DAYS * DAY_MS,
    )
    await expect(listInvitations(world.scope)).resolves.toHaveLength(1)
  })

  it('withdraws an invitation without deleting the record of it', async () => {
    const id = await seedInvitation()
    await revokeInvitation(world.scope, id)

    await expect(listInvitations(world.scope)).resolves.toEqual([])
    const rows = await world.db
      .select({ status: invitation.status })
      .from(invitation)
      .where(eq(invitation.id, id))
    expect(rows[0].status).toBe('canceled')
  })

  it('cannot reach another workspace’s invitation', async () => {
    const id = await seedInvitation({ id: 'inv-b', organizationId: 'org-b' })
    await expect(revokeInvitation(world.scope, id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

/* -------------------------------------------------------------------------- */
/* Roles and removal                                                           */
/* -------------------------------------------------------------------------- */

describe('the owner line', () => {
  beforeEach(async () => {
    await addSecondMember(world.db)
  })

  it('lets an owner promote somebody to owner', async () => {
    await changeMemberRole(world.scope, { memberId: 'mem-a2', role: 'owner' })
    const members = await listMembers(world.scope)
    expect(members.filter((person) => person.role === 'owner')).toHaveLength(2)
  })

  it('refuses to let an admin create an owner', async () => {
    await expect(
      changeMemberRole(asRole('admin'), { memberId: 'mem-a2', role: 'owner' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('refuses to let an admin act on an owner', async () => {
    await expect(
      changeMemberRole(asRole('admin', 'user-b'), {
        memberId: 'mem-a',
        role: 'member',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('refuses to demote the last owner', async () => {
    await expect(
      changeMemberRole(world.scope, { memberId: 'mem-a', role: 'admin' }),
    ).rejects.toMatchObject({ code: 'LAST_OWNER' })
  })

  it('lets one owner remove another once there are two', async () => {
    await changeMemberRole(world.scope, { memberId: 'mem-a2', role: 'owner' })
    const secondOwner = Object.freeze({
      db: world.db,
      ctx: Object.freeze({
        userId: 'user-b',
        organizationId: 'org-a',
        role: 'owner' as const,
      }),
    })

    await expect(removeMember(secondOwner, 'mem-a')).resolves.toBeUndefined()
    const members = await listMembers(world.scope)
    expect(members.map((person) => person.userId)).toEqual(['user-b'])
  })

  it('refuses to let the last owner leave', async () => {
    await expect(leaveWorkspace(world.scope)).rejects.toMatchObject({
      code: 'LAST_OWNER',
    })
  })

  it('lets a member leave', async () => {
    await leaveWorkspace(asRole('member', 'user-b'))
    await expect(listMembers(world.scope)).resolves.toHaveLength(1)
  })

  it('refuses “remove” aimed at yourself, so leaving is a deliberate act', async () => {
    await expect(removeMember(world.scope, 'mem-a')).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })

  it('cannot change a role in another workspace', async () => {
    await expect(
      changeMemberRole(world.scope, { memberId: 'mem-b', role: 'member' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const theirs = await listMembers(world.otherScope)
    expect(theirs[0].role).toBe('owner')
  })
})

describe('removing somebody takes their access and nothing else', () => {
  it('leaves every financial row exactly as it was', async () => {
    await addSecondMember(world.db)
    await seedTransaction(world.db, {
      id: 'tx-1',
      organizationId: 'org-a',
      accountId: 'acc-a',
      refAmountMinor: 123_45,
      bookedOn: '2026-03-01',
    })

    const before = await world.db.select().from(transactions)
    await removeMember(world.scope, 'mem-a2')
    const after = await world.db.select().from(transactions)

    expect(after).toEqual(before)
    await expect(listMembers(world.scope)).resolves.toHaveLength(1)
  })
})

/* -------------------------------------------------------------------------- */
/* Acceptance — the one unscoped path                                          */
/* -------------------------------------------------------------------------- */

describe('accepting an invitation', () => {
  const outsider = { userId: 'user-c', email: 'c@example.com' }

  beforeEach(async () => {
    await seedOutsider()
    await withSeats(6)
  })

  it('adds the membership and closes the invitation', async () => {
    const id = await seedInvitation()
    const result = await acceptInvitation(
      world.db,
      { invitationId: id, viewer: outsider },
      NOW,
    )

    expect(result.organizationId).toBe('org-a')
    const members = await listMembers(world.scope)
    expect(members.map((person) => person.userId).toSorted()).toEqual([
      'user-a',
      'user-c',
    ])
    const rows = await world.db
      .select({ status: invitation.status })
      .from(invitation)
      .where(eq(invitation.id, id))
    expect(rows[0].status).toBe('accepted')
  })

  it('refuses an account the invitation was not addressed to, and says which address it was', async () => {
    const id = await seedInvitation()
    await expect(
      acceptInvitation(
        world.db,
        {
          invitationId: id,
          viewer: { userId: 'user-b', email: 'b@example.com' },
        },
        NOW,
      ),
    ).rejects.toMatchObject({
      code: 'INVITATION_ADDRESSEE',
      invitedEmail: 'c@example.com',
    })
    await expect(listMembers(world.scope)).resolves.toHaveLength(1)
  })

  it('refuses an expired invitation', async () => {
    const id = await seedInvitation()
    const later = new Date(NOW.getTime() + (INVITATION_TTL_DAYS + 1) * DAY_MS)
    await expect(
      acceptInvitation(world.db, { invitationId: id, viewer: outsider }, later),
    ).rejects.toMatchObject({ code: 'INVITATION_CLOSED', state: 'expired' })
  })

  it('refuses a withdrawn invitation', async () => {
    const id = await seedInvitation({ status: 'canceled' })
    await expect(
      acceptInvitation(world.db, { invitationId: id, viewer: outsider }, NOW),
    ).rejects.toMatchObject({ code: 'INVITATION_CLOSED', state: 'revoked' })
  })

  /** Not `ForbiddenError`: a 403 would confirm that the id names a real invitation. */
  it('answers not-found for an id that was never issued', async () => {
    await expect(
      acceptInvitation(
        world.db,
        { invitationId: 'inv-nothing', viewer: outsider },
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('is refused when the workspace has no seat left, before the membership is written', async () => {
    const id = await seedInvitation()
    setLimitResolver(async (_scope, metric) => (metric === 'members' ? 1 : 99))

    await expect(
      acceptInvitation(world.db, { invitationId: id, viewer: outsider }, NOW),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', metric: 'members' })

    const rows = await world.db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, 'user-c'))
    expect(rows).toEqual([])
  })
})

describe('the invitation a person is looking at', () => {
  const outsider = { userId: 'user-c', email: 'c@example.com' }

  beforeEach(async () => {
    await seedOutsider()
  })

  it('is open for the addressee', async () => {
    const id = await seedInvitation()
    const view = await getInvitationView(
      world.db,
      { invitationId: id, viewer: outsider },
      NOW,
    )
    expect(view).toMatchObject({
      state: 'open',
      workspaceName: 'A',
      invitedEmail: 'c@example.com',
      role: 'member',
    })
  })

  it('names the invited address to the wrong account, which is the only way back', async () => {
    const id = await seedInvitation()
    const view = await getInvitationView(
      world.db,
      {
        invitationId: id,
        viewer: { userId: 'user-b', email: 'b@example.com' },
      },
      NOW,
    )
    expect(view.state).toBe('wrong-account')
    expect(view.invitedEmail).toBe('c@example.com')
  })

  it('reports somebody who is already here', async () => {
    const id = await seedInvitation({ email: 'a@example.com' })
    const view = await getInvitationView(
      world.db,
      {
        invitationId: id,
        viewer: { userId: 'user-a', email: 'a@example.com' },
      },
      NOW,
    )
    expect(view.state).toBe('already-member')
  })

  it('reports an expired link as expired rather than as broken', async () => {
    const id = await seedInvitation()
    const later = new Date(NOW.getTime() + (INVITATION_TTL_DAYS + 1) * DAY_MS)
    const view = await getInvitationView(
      world.db,
      { invitationId: id, viewer: outsider },
      later,
    )
    expect(view.state).toBe('expired')
  })
})
