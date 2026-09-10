/**
 * Workspace sharing: who is in a household, who may change it, and how somebody joins.
 *
 * A workspace is the unit of isolation *and* the unit of sharing. Everything in this file therefore
 * answers one of two questions — *may this person act on this membership* and *is there still
 * somebody who can administer this workspace afterwards* — and the answers are enforced here rather
 * than in a screen, because a screen is one call site away from being skipped.
 *
 * ## The rules, stated once
 *
 * - **Roles.** `owner` may do everything. `admin` may invite, revoke, remove members and change a
 *   role **between `member` and `admin`**; it may neither create an owner nor act on one. Handing
 *   ownership over is an owner's decision by definition, so `member` may only read.
 * - **A workspace always keeps an owner.** Demoting, removing or leaving as the last owner raises
 *   {@link LastOwnerError}. Not a database constraint, because "the last one" is a count and SQLite
 *   cannot express it; a check plus a test is honest about that.
 * - **Removing somebody removes their access, not their work.** Transactions, accounts and budgets
 *   they created stay with the workspace — they are the household's records, not the person's.
 *   `members.test.ts` asserts a removal changes no financial row.
 * - **Seats count memberships *plus* pending invitations** (`repos/usage.ts`). Counting only
 *   accepted members lets a five-seat workspace hold twenty outstanding invites.
 *
 * ## Acceptance is the one path that acts on another workspace
 *
 * {@link acceptInvitation} is reached by somebody who is, by definition, not yet a member — so it
 * cannot take a {@link TenantScope}, and it is the only function here that does not. It is
 * authorised by three facts instead: the invitation's single-use id, its `pending` status, and the
 * **email match** between the invitation and the signed-in account. A mismatched account is refused
 * even though it holds the id, and an id that does not exist is a `NotFoundError` — never a
 * `ForbiddenError`, which would confirm that the invitation is real.
 */

import { and, asc, desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'

import {
  ORGANIZATION_ROLES,
  invitation,
  member,
  organization,
  user,
} from '#/server/db/auth-schema'

import {
  allOf,
  assertWithinLimit,
  createTenantTableAccess,
  tenantFilter,
} from './base'
import {
  ConflictError,
  ForbiddenError,
  InvitationAddresseeError,
  InvitationClosedError,
  LastOwnerError,
  NotFoundError,
} from './errors'
import { assertRole } from './scope'
import { ownerScopeFor } from './subscriptions'
import { seatsInUse } from './usage'

import type { InvitationRow, OrganizationRole } from '#/server/db/auth-schema'
import type { Database, TenantScope } from './base'

/** The metric the plan catalogue meters seats under. */
export const SEAT_QUOTA_METRIC = 'members'

/**
 * How long an invitation can be accepted for.
 *
 * A week: long enough to survive a holiday, short enough that a forwarded email does not stay a
 * live key to a household's finances indefinitely.
 */
export const INVITATION_TTL_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

const memberAccess = createTenantTableAccess(member, 'member')
const invitationAccess = createTenantTableAccess(invitation, 'invitation')

/** Matches `advanced.database.generateId` in the auth configuration. */
function newAuthId(): string {
  return nanoid(24)
}

/**
 * Addresses are compared lowercased, everywhere.
 *
 * `Anna@Example.com` and `anna@example.com` are one mailbox to every provider that matters, and an
 * invitation that cannot be accepted because of a capital letter is indistinguishable from a bug.
 */
function normaliseEmail(value: string): string {
  return value.trim().toLowerCase()
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** One person in the workspace, joined with the account facts a member list has to show. */
export interface WorkspaceMember {
  readonly memberId: string
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly image: string | null
  readonly role: OrganizationRole
  readonly joinedAt: Date
}

/** An invitation that has not been accepted, revoked or expired away. */
export interface WorkspaceInvitation {
  readonly id: string
  readonly email: string
  readonly role: OrganizationRole
  readonly expiresAt: Date
  readonly createdAt: Date
  readonly inviterName: string | null
}

function roleOf(value: string): OrganizationRole {
  // The column carries a default but no `CHECK`, so an unrecognised value is read as the least
  // privileged role rather than trusted or thrown on. Deny by default, at the read.
  return (ORGANIZATION_ROLES as ReadonlyArray<string>).includes(value)
    ? (value as OrganizationRole)
    : 'member'
}

/**
 * The workspace's own display name.
 *
 * `organization` is the one table whose **primary key is the tenant id**, so it carries no
 * `organization_id` column and `tenantFilter` has nothing to compose there. Filtering on the id
 * from the scope is the same predicate by another name, and it is written here rather than left to
 * a caller so the invitation email cannot be told to name a different household.
 */
export async function workspaceName(scope: TenantScope): Promise<string> {
  const rows = await scope.db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, scope.ctx.organizationId))
    .limit(1)
  return rows[0]?.name ?? ''
}

/** Everyone in the workspace, owners first, then by the day they joined. */
export async function listMembers(
  scope: TenantScope,
): Promise<ReadonlyArray<WorkspaceMember>> {
  const rows = await scope.db
    .select({
      memberId: member.id,
      userId: member.userId,
      role: member.role,
      joinedAt: member.createdAt,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(tenantFilter(scope, member))
    .orderBy(asc(member.createdAt))

  return rows.map((row) => ({
    memberId: row.memberId,
    userId: row.userId,
    name: row.name,
    email: row.email,
    image: row.image,
    role: roleOf(row.role),
    joinedAt: row.joinedAt,
  }))
}

/**
 * Whether one person belongs to the scope's workspace.
 *
 * `listMembers(...).some(...)` answers the same question, and the notification dispatcher asks it
 * once per recipient per occasion — a five-member household with twenty crossings would join
 * `member` to `user` and build twenty full membership lists to decide twenty booleans. This is the
 * indexed lookup that question actually is.
 *
 * It is a check on the *addressee*, not on the caller: `notify` uses it to refuse writing a row
 * addressed to somebody who could never open it.
 */
export async function isMember(
  scope: TenantScope,
  userId: string,
): Promise<boolean> {
  const rows = await scope.db
    .select({ id: member.id })
    .from(member)
    .where(allOf(tenantFilter(scope, member), eq(member.userId, userId)))
    .limit(1)
  return rows.length > 0
}

/**
 * The invitations still worth showing: `pending`, newest first.
 *
 * Expired ones are included and carry their `expiresAt`, so the screen can show "expired" with a
 * resend rather than silently losing an invitation somebody is waiting on.
 */
export async function listInvitations(
  scope: TenantScope,
): Promise<ReadonlyArray<WorkspaceInvitation>> {
  const rows = await scope.db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      inviterName: user.name,
    })
    .from(invitation)
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .where(tenantFilter(scope, invitation, eq(invitation.status, 'pending')))
    .orderBy(desc(invitation.createdAt))

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: roleOf(row.role ?? 'member'),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    inviterName: row.inviterName,
  }))
}

/* -------------------------------------------------------------------------- */
/* Invitations                                                                 */
/* -------------------------------------------------------------------------- */

export const inviteSchema = z.strictObject({
  email: z.email().max(320).transform(normaliseEmail),
  /**
   * `owner` is absent from the union rather than refused at runtime: an invitation that creates a
   * second owner is a transfer of ownership, and a transfer belongs to a deliberate flow, not to
   * the invite dialog.
   */
  role: z.enum(['admin', 'member']),
})
export type InviteInput = z.input<typeof inviteSchema>

/**
 * Invites one address, after the three checks that make a seat count mean something.
 *
 * Ordered deliberately: **role**, then **duplicates**, then **the seat ceiling**. A member who may
 * not invite at all should not learn from the error message whether the workspace is full, and a
 * person who is already here should not consume a seat to be told so.
 */
export async function inviteMember(
  scope: TenantScope,
  input: InviteInput,
  now: Date = new Date(),
): Promise<InvitationRow> {
  assertRole(scope, 'invite people to this workspace', 'admin')
  const parsed = inviteSchema.parse(input)

  const existingMembers = await scope.db
    .select({ id: member.id })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(tenantFilter(scope, member, eq(user.email, parsed.email)))
    .limit(1)
  if (existingMembers.length > 0) {
    throw new ConflictError('That person is already in this workspace.')
  }

  const outstanding = await invitationAccess.findOne(
    scope,
    allOf(eq(invitation.email, parsed.email), eq(invitation.status, 'pending')),
  )
  if (outstanding) {
    throw new ConflictError('That address already has a pending invitation.')
  }

  await assertWithinLimit(
    scope,
    SEAT_QUOTA_METRIC,
    (await seatsInUse(scope)) + 1,
  )

  return invitationAccess.insert(scope, {
    id: newAuthId(),
    email: parsed.email,
    role: parsed.role,
    status: 'pending',
    inviterId: scope.ctx.userId,
    expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * DAY_MS),
    createdAt: now,
  })
}

/** Withdraws a pending invitation. The row is kept as `canceled` rather than deleted. */
export async function revokeInvitation(
  scope: TenantScope,
  invitationId: string,
): Promise<void> {
  assertRole(scope, 'revoke an invitation', 'admin')

  const rows = await invitationAccess.updateWhere(
    scope,
    allOf(eq(invitation.id, invitationId), eq(invitation.status, 'pending')),
    { status: 'canceled' },
  )
  if (rows.length === 0) throw new NotFoundError('invitation', invitationId)
}

/**
 * Extends a pending invitation's life so the email can be sent again.
 *
 * The **same** invitation, with a new expiry, rather than a fresh row: two live invitations to one
 * address would each hold a seat, and the first link somebody clicks would be the one that fails.
 */
export async function renewInvitation(
  scope: TenantScope,
  invitationId: string,
  now: Date = new Date(),
): Promise<InvitationRow> {
  assertRole(scope, 'resend an invitation', 'admin')

  const rows = await invitationAccess.updateWhere(
    scope,
    allOf(eq(invitation.id, invitationId), eq(invitation.status, 'pending')),
    { expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * DAY_MS) },
  )
  const row = rows.at(0)
  if (!row) throw new NotFoundError('invitation', invitationId)
  return row
}

/* -------------------------------------------------------------------------- */
/* Memberships                                                                 */
/* -------------------------------------------------------------------------- */

async function requireMembership(scope: TenantScope, memberId: string) {
  const row = await memberAccess.findOne(scope, eq(member.id, memberId))
  if (!row) throw new NotFoundError('member', memberId)
  return row
}

/** How many owners the workspace has right now. The number every last-owner rule is about. */
async function ownerCount(scope: TenantScope): Promise<number> {
  return memberAccess.count(scope, eq(member.role, 'owner'))
}

/**
 * Changes somebody's role.
 *
 * Two refusals, and both are about authority rather than about data:
 *
 * - an **admin** may not act on an owner and may not create one — that is the owner/admin line;
 * - the **last owner** may not be demoted, by anybody, including themselves.
 */
export async function changeMemberRole(
  scope: TenantScope,
  input: { readonly memberId: string; readonly role: OrganizationRole },
): Promise<void> {
  assertRole(scope, 'change a role in this workspace', 'admin')

  const target = await requireMembership(scope, input.memberId)
  const current = roleOf(target.role)

  if (
    scope.ctx.role !== 'owner' &&
    (current === 'owner' || input.role === 'owner')
  ) {
    throw new ForbiddenError('change an owner’s role', ['owner'])
  }

  if (current === input.role) return

  if (current === 'owner' && (await ownerCount(scope)) <= 1) {
    throw new LastOwnerError()
  }

  await memberAccess.updateWhere(scope, eq(member.id, input.memberId), {
    role: input.role,
  })
}

/**
 * Removes somebody from the workspace. Their rows stay; their access does not.
 *
 * Removing **yourself** is refused here and belongs to {@link leaveWorkspace} — the two read
 * identically in SQL and differently to a person, and a "remove" that quietly signs you out of your
 * own household is the kind of surprise a confirmation dialog cannot undo.
 */
export async function removeMember(
  scope: TenantScope,
  memberId: string,
): Promise<void> {
  assertRole(scope, 'remove somebody from this workspace', 'admin')

  const target = await requireMembership(scope, memberId)
  if (target.userId === scope.ctx.userId) {
    throw new ConflictError('Leave the workspace instead of removing yourself.')
  }

  const current = roleOf(target.role)
  if (current === 'owner' && scope.ctx.role !== 'owner') {
    throw new ForbiddenError('remove an owner', ['owner'])
  }
  // A backstop rather than a reachable path today: only an owner may remove an owner, so the
  // sole owner attempting it is refused by the self-removal rule above. It stays because the day
  // that rule changes, this is the check that keeps the workspace administrable.
  if (current === 'owner' && (await ownerCount(scope)) <= 1) {
    throw new LastOwnerError()
  }

  await memberAccess.removeWhere(scope, eq(member.id, memberId))
}

/**
 * The caller leaves the workspace.
 *
 * Available to every role, and refused for the last owner: a workspace nobody can administer is a
 * workspace whose billing, members and settings are frozen for everyone still in it.
 */
export async function leaveWorkspace(scope: TenantScope): Promise<void> {
  const rows = await memberAccess.findMany(scope, {
    where: eq(member.userId, scope.ctx.userId),
  })
  const own = rows.at(0)
  if (!own) throw new NotFoundError('member', scope.ctx.userId)

  if (roleOf(own.role) === 'owner' && (await ownerCount(scope)) <= 1) {
    throw new LastOwnerError()
  }

  await memberAccess.removeWhere(scope, eq(member.id, own.id))
}

/* -------------------------------------------------------------------------- */
/* Acceptance — the one unscoped path                                          */
/* -------------------------------------------------------------------------- */

/** Who is looking at an invitation link. The session's facts, and nothing the URL supplied. */
export interface InvitationViewer {
  readonly userId: string
  readonly email: string
}

/** What the accept screen renders. Every state it can be in has a name here. */
export interface InvitationView {
  readonly id: string
  readonly workspaceName: string
  readonly invitedEmail: string
  readonly role: OrganizationRole
  readonly expiresAt: Date
  readonly state:
    | 'open'
    | 'expired'
    | 'revoked'
    | 'accepted'
    | 'wrong-account'
    | 'already-member'
}

/**
 * Loads an invitation for the person holding its link.
 *
 * Unscoped by necessity — the viewer is not a member of the workspace yet, so there is no scope to
 * ask for one — and narrow by construction: it reads one invitation row by primary key plus its
 * workspace's name, and returns no financial data of any kind.
 *
 * An id that does not exist is a {@link NotFoundError} rather than a state, because a screen that
 * renders "this invitation is not valid" for an id that was never issued is an oracle for guessing
 * ids.
 */
export async function getInvitationView(
  db: Database,
  input: { readonly invitationId: string; readonly viewer: InvitationViewer },
  now: Date = new Date(),
): Promise<InvitationView> {
  const rows = await db
    .select({
      id: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      workspaceName: organization.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .where(eq(invitation.id, input.invitationId))
    .limit(1)

  const row = rows.at(0)
  if (!row) throw new NotFoundError('invitation', input.invitationId)

  const base = {
    id: row.id,
    workspaceName: row.workspaceName,
    invitedEmail: row.email,
    role: roleOf(row.role ?? 'member'),
    expiresAt: row.expiresAt,
  }

  const alreadyMember = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, row.organizationId),
        eq(member.userId, input.viewer.userId),
      ),
    )
    .limit(1)
  if (alreadyMember.length > 0) return { ...base, state: 'already-member' }

  if (row.status === 'accepted') return { ...base, state: 'accepted' }
  if (row.status !== 'pending') return { ...base, state: 'revoked' }
  if (normaliseEmail(row.email) !== normaliseEmail(input.viewer.email)) {
    return { ...base, state: 'wrong-account' }
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ...base, state: 'expired' }
  }

  return { ...base, state: 'open' }
}

/**
 * Joins the workspace, and returns the id the session should switch to.
 *
 * Every refusal {@link getInvitationView} can describe is re-raised here as a typed error: the view
 * is what a screen renders, and this is what actually decides. A screen that checked the state and
 * then called this would be checking twice and enforcing once.
 *
 * The seat ceiling is checked **before** the membership is written, against the target workspace's
 * own plan — an invitation issued while there was room does not become a free seat a month later.
 * The scope it is checked under is the workspace owner's, built the same way the cron builds one
 * (`./subscriptions`, `./recurring`): the acceptor has no scope of their own yet, and inventing a
 * privileged one would be a super-user.
 */
export async function acceptInvitation(
  db: Database,
  input: { readonly invitationId: string; readonly viewer: InvitationViewer },
  now: Date = new Date(),
): Promise<{ readonly organizationId: string }> {
  const rows = await db
    .select({
      id: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .where(eq(invitation.id, input.invitationId))
    .limit(1)

  const row = rows.at(0)
  if (!row) throw new NotFoundError('invitation', input.invitationId)

  if (row.status === 'accepted') throw new InvitationClosedError('accepted')
  if (row.status !== 'pending') throw new InvitationClosedError('revoked')
  if (normaliseEmail(row.email) !== normaliseEmail(input.viewer.email)) {
    throw new InvitationAddresseeError(row.email)
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    throw new InvitationClosedError('expired')
  }

  const workspaceScope = await ownerScopeFor(db, row.organizationId)
  if (!workspaceScope) throw new NotFoundError('workspace', row.organizationId)

  const alreadyMember = await memberAccess.findOne(
    workspaceScope,
    eq(member.userId, input.viewer.userId),
  )
  if (alreadyMember) {
    await invitationAccess.updateWhere(
      workspaceScope,
      eq(invitation.id, row.id),
      { status: 'accepted' },
    )
    return { organizationId: row.organizationId }
  }

  // Not `+ 1`: this invitation is still `pending` and is therefore already counted as a seat.
  // Accepting converts it into a membership rather than adding one.
  await assertWithinLimit(
    workspaceScope,
    SEAT_QUOTA_METRIC,
    await seatsInUse(workspaceScope),
  )

  await memberAccess.insert(workspaceScope, {
    id: newAuthId(),
    userId: input.viewer.userId,
    role: roleOf(row.role ?? 'member'),
    createdAt: now,
  })

  await invitationAccess.updateWhere(
    workspaceScope,
    eq(invitation.id, row.id),
    {
      status: 'accepted',
    },
  )

  return { organizationId: row.organizationId }
}
