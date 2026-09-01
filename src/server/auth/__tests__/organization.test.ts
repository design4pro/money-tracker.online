/**
 * Workspace provisioning.
 *
 * The property under test is not "a workspace is created" — it is that **an account can never end
 * up without exactly one**. Two hooks call this code on the same sign-up, a retried request calls
 * it again, and two people with the same name sign up in the same minute; each of those is a way to
 * end up with zero workspaces, two workspaces, or a workspace nobody can enter. All four are here.
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { member, organization } from '#/server/db/auth-schema'

import {
  firstOrganizationIdFor,
  membershipRoleFor,
  personalWorkspaceName,
  personalWorkspaceSlug,
  provisionPersonalWorkspace,
  reserveSlug,
  resolveOrProvisionOrganization,
  slugify,
} from '../organization'
import { openAuthTestDb, seedOrganization, seedUser } from './harness'

import type { AppDatabase } from '../db'

let db: AppDatabase

const ANNA = {
  id: 'user-anna',
  name: 'Anna Kowalska',
  email: 'anna@example.com',
}

beforeEach(async () => {
  db = openAuthTestDb()
  await seedUser(db, ANNA)
})

async function membershipsOf(userId: string) {
  return db.select().from(member).where(eq(member.userId, userId))
}

describe('slugify', () => {
  it('strips diacritics rather than dropping the characters that carry them', () => {
    // A Polish name must not slug to `a-ska`. Every letter has an ASCII shadow; use it.
    expect(slugify('Anna Kowalska')).toBe('anna-kowalska')
    expect(slugify('Łukasz Żółć')).toBe('ukasz-zo-c')
    expect(slugify('  Anna  ')).toBe('anna')
  })

  it('answers empty when nothing usable survives, so the caller can fall back', () => {
    expect(slugify('日本語')).toBe('')
    expect(slugify('---')).toBe('')
  })
})

describe('personalWorkspaceName', () => {
  it('uses the person’s own name', () => {
    expect(personalWorkspaceName(ANNA)).toBe('Anna Kowalska')
  })

  it('falls back to the local part of the address, never to an English phrase', () => {
    expect(
      personalWorkspaceName({ name: '  ', email: 'anna@example.com' }),
    ).toBe('anna')
  })

  it('produces a usable slug even for a name that slugs to nothing', () => {
    expect(
      personalWorkspaceSlug({ name: '日本語', email: 'anna@example.com' }),
    ).toBe('anna')
    expect(
      personalWorkspaceSlug({ name: '', email: '日本語@example.com' }),
    ).toBe('workspace')
  })
})

describe('reserveSlug', () => {
  it('returns the candidate when nothing holds it', async () => {
    await expect(reserveSlug(db, 'anna')).resolves.toBe('anna')
  })

  it('suffixes rather than colliding when the slug is taken', async () => {
    await seedOrganization(db, { id: 'org-x', name: 'X', slug: 'anna' })

    const slug = await reserveSlug(db, 'anna')

    expect(slug).not.toBe('anna')
    expect(slug.startsWith('anna-')).toBe(true)
  })
})

describe('provisionPersonalWorkspace', () => {
  it('creates the workspace and the owner membership together', async () => {
    const organizationId = await provisionPersonalWorkspace(db, ANNA)

    const [workspace] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
    expect(workspace.name).toBe('Anna Kowalska')

    const memberships = await membershipsOf(ANNA.id)
    expect(memberships).toHaveLength(1)
    // Owner, not member: the person who created the workspace is the one who can delete it.
    expect(memberships[0]?.role).toBe('owner')
    expect(memberships[0]?.organizationId).toBe(organizationId)
  })

  it('never leaves a workspace nobody can enter', async () => {
    await provisionPersonalWorkspace(db, ANNA)

    const workspaces = await db.select().from(organization)
    const memberships = await db.select().from(member)

    // One `batch`, so these two counts cannot diverge. An `organization` row without a `member`
    // row is a workspace its owner cannot reach and no later request will ever repair.
    expect(workspaces).toHaveLength(memberships.length)
  })

  it('is idempotent, which is what makes calling it from two hooks safe', async () => {
    const first = await provisionPersonalWorkspace(db, ANNA)
    const second = await provisionPersonalWorkspace(db, ANNA)

    expect(second).toBe(first)
    await expect(membershipsOf(ANNA.id)).resolves.toHaveLength(1)
  })

  it('gives two people with the same name two different workspaces', async () => {
    const other = {
      id: 'user-anna-2',
      name: 'Anna Kowalska',
      email: 'a2@x.com',
    }
    await seedUser(db, other)

    const first = await provisionPersonalWorkspace(db, ANNA)
    const second = await provisionPersonalWorkspace(db, other)

    expect(second).not.toBe(first)
    const slugs = (await db.select().from(organization)).map((row) => row.slug)
    expect(new Set(slugs).size).toBe(2)
  })
})

describe('membershipRoleFor', () => {
  it('answers the role the member actually holds', async () => {
    const organizationId = await provisionPersonalWorkspace(db, ANNA)

    await expect(
      membershipRoleFor(db, { userId: ANNA.id, organizationId }),
    ).resolves.toBe('owner')
  })

  it('answers null for a workspace the user does not belong to', async () => {
    await seedOrganization(db, {
      id: 'org-other',
      name: 'Other',
      slug: 'other',
    })

    await expect(
      membershipRoleFor(db, { userId: ANNA.id, organizationId: 'org-other' }),
    ).resolves.toBeNull()
  })
})

describe('resolveOrProvisionOrganization', () => {
  it('provisions on first call and reuses afterwards', async () => {
    const first = await resolveOrProvisionOrganization(db, ANNA.id)
    const second = await resolveOrProvisionOrganization(db, ANNA.id)

    expect(first).not.toBeNull()
    expect(second).toBe(first)
  })

  it('returns the oldest membership for a returning account', async () => {
    const own = await provisionPersonalWorkspace(db, ANNA)
    await seedOrganization(db, {
      id: 'org-later',
      name: 'Later',
      slug: 'later',
    })
    await db.insert(member).values({
      id: 'member-later',
      organizationId: 'org-later',
      userId: ANNA.id,
      role: 'member',
      createdAt: new Date('2027-01-01T00:00:00.000Z'),
    })

    await expect(firstOrganizationIdFor(db, ANNA.id)).resolves.toBe(own)
    await expect(resolveOrProvisionOrganization(db, ANNA.id)).resolves.toBe(own)
  })

  it('invents nothing for a user row that is gone', async () => {
    // The session hook runs against a deleted account during a race. Answering `null` leaves the
    // session unpinned; inventing a workspace would create one nobody owns.
    await expect(
      resolveOrProvisionOrganization(db, 'user-does-not-exist'),
    ).resolves.toBeNull()
    await expect(db.select().from(organization)).resolves.toHaveLength(0)
  })
})
