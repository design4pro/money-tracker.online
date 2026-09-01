/**
 * `requireUser` and `requireOrg` — the two doors, tested as an attacker would push on them.
 *
 * The three properties worth breaking:
 *
 * 1. an unauthenticated or suspended caller gets nothing;
 * 2. the role comes from the `member` table on **this** request, not from the session cookie;
 * 3. a workspace id supplied by the caller cannot select a workspace.
 *
 * The session is a fixture rather than a real cookie because none of the above is about cookies.
 * The database is real, because (2) and (3) are entirely about what a row says.
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { member } from '#/server/db/auth-schema'

import { createGuards } from '../guards'
import { provisionPersonalWorkspace } from '../organization'
import { AuthRequirementError, isAuthRequirementError } from '../tenant'
import { openAuthTestDb, seedOrganization, seedUser } from './harness'

import type { AppDatabase } from '../db'
import type { AuthSession, AuthUser } from '../tenant'

let db: AppDatabase
let workspaceId: string

const ANNA = { id: 'user-anna', name: 'Anna', email: 'anna@example.com' }

function userFixture(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: ANNA.id,
    email: ANNA.email,
    name: ANNA.name,
    emailVerified: true,
    image: null,
    twoFactorEnabled: false,
    role: null,
    banned: false,
    banReason: null,
    banExpires: null,
    ...overrides,
  }
}

function sessionFixture(
  overrides: {
    user?: Partial<AuthUser>
    activeOrganizationId?: string | null
  } = {},
): AuthSession {
  return {
    user: userFixture(overrides.user),
    session: {
      id: 'session-1',
      token: 'token-1',
      userId: ANNA.id,
      activeOrganizationId:
        overrides.activeOrganizationId === undefined
          ? workspaceId
          : overrides.activeOrganizationId,
      expiresAt: new Date('2026-12-31T00:00:00.000Z'),
      impersonatedBy: null,
    },
  }
}

function guardsFor(session: AuthSession | null) {
  return createGuards({ getSession: async () => session, db })
}

/** The failure reason, or the error itself if it was not an auth refusal. */
async function reasonOf(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => 'did not throw',
    (error: unknown) =>
      isAuthRequirementError(error) ? error.reason : (error as Error).message,
  )
}

beforeEach(async () => {
  db = openAuthTestDb()
  await seedUser(db, ANNA)
  workspaceId = await provisionPersonalWorkspace(db, ANNA)
})

describe('requireUser', () => {
  it('refuses a request with no session', async () => {
    await expect(reasonOf(guardsFor(null).requireUser())).resolves.toBe(
      'unauthenticated',
    )
  })

  it('refuses a suspended account before anything else is decided', async () => {
    const guards = guardsFor(sessionFixture({ user: { banned: true } }))

    await expect(reasonOf(guards.requireUser())).resolves.toBe('banned')
    // And the same refusal on the workspace door, so "suspended" means one thing everywhere.
    await expect(reasonOf(guards.requireOrg())).resolves.toBe('banned')
  })

  it('returns the signed-in user', async () => {
    const user = await guardsFor(sessionFixture()).requireUser()
    expect(user.id).toBe(ANNA.id)
  })
})

describe('requireOrg', () => {
  it('returns a scope for the session’s workspace with the caller’s real role', async () => {
    const scope = await guardsFor(sessionFixture()).requireOrg()

    expect(scope.ctx).toEqual({
      userId: ANNA.id,
      organizationId: workspaceId,
      role: 'owner',
    })
  })

  it('hands back a scope the repositories can use, not just an id', async () => {
    const scope = await guardsFor(sessionFixture()).requireOrg()
    expect(scope.db).toBe(db)
    expect(Object.isFrozen(scope.ctx)).toBe(true)
  })

  it('re-reads the role, so a demotion takes effect on the next request', async () => {
    const session = sessionFixture()
    const guards = guardsFor(session)

    await expect(guards.requireOrg({ role: 'admin' })).resolves.toBeDefined()

    await db
      .update(member)
      .set({ role: 'member' })
      .where(eq(member.userId, ANNA.id))

    // The same session object, unchanged. Only the row moved, and the row is what decides.
    await expect(reasonOf(guards.requireOrg({ role: 'admin' }))).resolves.toBe(
      'insufficient-role',
    )
    await expect(guards.requireOrg()).resolves.toBeDefined()
  })

  it('ignores a forged workspace id in the request rather than honouring it', async () => {
    await seedOrganization(db, { id: 'org-victim', name: 'V', slug: 'v' })

    // The caller asserts they are in someone else's workspace. The assertion is refused; under no
    // circumstances does it *select* that workspace.
    await expect(
      reasonOf(
        guardsFor(sessionFixture()).requireOrg({
          organizationId: 'org-victim',
        }),
      ),
    ).resolves.toBe('not-a-member')

    const scope = await guardsFor(sessionFixture()).requireOrg()
    expect(scope.ctx.organizationId).toBe(workspaceId)
  })

  it('accepts a matching assertion, so the option is usable as a sanity check', async () => {
    const scope = await guardsFor(sessionFixture()).requireOrg({
      organizationId: workspaceId,
    })
    expect(scope.ctx.organizationId).toBe(workspaceId)
  })

  it('refuses a session pinned to a workspace the caller has no row in', async () => {
    await seedOrganization(db, { id: 'org-victim', name: 'V', slug: 'v' })

    await expect(
      reasonOf(
        guardsFor(
          sessionFixture({ activeOrganizationId: 'org-victim' }),
        ).requireOrg(),
      ),
    ).resolves.toBe('not-a-member')
  })

  it('provisions a workspace for a session that has none, instead of failing', async () => {
    const other = { id: 'user-b', name: 'B', email: 'b@example.com' }
    await seedUser(db, other)

    const scope = await createGuards({
      getSession: async () => ({
        user: userFixture({
          id: other.id,
          email: other.email,
          name: other.name,
        }),
        session: {
          id: 'session-2',
          token: 'token-2',
          userId: other.id,
          activeOrganizationId: null,
          expiresAt: new Date('2026-12-31T00:00:00.000Z'),
          impersonatedBy: null,
        },
      }),
      db,
    }).requireOrg()

    expect(scope.ctx.organizationId).not.toBe(workspaceId)
    expect(scope.ctx.role).toBe('owner')
  })

  it('refuses rather than inventing a workspace when the account is gone', async () => {
    const ghost = createGuards({
      getSession: async () => ({
        user: userFixture({ id: 'user-ghost' }),
        session: {
          id: 'session-3',
          token: 'token-3',
          userId: 'user-ghost',
          activeOrganizationId: null,
          expiresAt: new Date('2026-12-31T00:00:00.000Z'),
          impersonatedBy: null,
        },
      }),
      db,
    })

    await expect(reasonOf(ghost.requireOrg())).resolves.toBe(
      'no-active-organization',
    )
  })

  it('enforces the role ladder in one direction only', async () => {
    await db
      .update(member)
      .set({ role: 'admin' })
      .where(eq(member.userId, ANNA.id))
    const guards = guardsFor(sessionFixture())

    await expect(guards.requireOrg({ role: 'member' })).resolves.toBeDefined()
    await expect(guards.requireOrg({ role: 'admin' })).resolves.toBeDefined()
    await expect(reasonOf(guards.requireOrg({ role: 'owner' }))).resolves.toBe(
      'insufficient-role',
    )
  })

  it('refuses a membership row carrying a role outside the workspace dictionary', async () => {
    // The column has a default but no `CHECK`, so a bad value is reachable through a migration or
    // a console edit. It must read as "not a member", never as "some role, therefore allowed".
    await db
      .update(member)
      .set({ role: 'superuser' })
      .where(eq(member.userId, ANNA.id))

    await expect(
      reasonOf(guardsFor(sessionFixture()).requireOrg()),
    ).resolves.toBe('not-a-member')
  })
})

describe('AuthRequirementError', () => {
  it('maps only the missing session to 401, and every other refusal to 403', () => {
    expect(new AuthRequirementError('unauthenticated', '').status).toBe(401)
    expect(new AuthRequirementError('banned', '').status).toBe(403)
    expect(new AuthRequirementError('not-a-member', '').status).toBe(403)
    expect(new AuthRequirementError('insufficient-role', '').status).toBe(403)
  })
})
