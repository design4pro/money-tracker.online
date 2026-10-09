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

import {
  DEFAULT_BASE_CURRENCY_CODE,
  DEFAULT_WORKSPACE_CURRENCY_CODES,
} from '#/server/catalog/data/currencies'
import { member, organization } from '#/server/db/auth-schema'
import { currencies, organizationCurrencies } from '#/server/db/schema'

import {
  firstOrganizationIdFor,
  membershipRoleFor,
  personalWorkspaceId,
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

async function currencyRowsOf(organizationId: string) {
  return db
    .select()
    .from(organizationCurrencies)
    .where(eq(organizationCurrencies.organizationId, organizationId))
}

/** What a read that ran before the other hook's batch committed would have seen: no rows. */
const STALE_MEMBER_READ = {
  from: () => ({
    where: () => ({ orderBy: () => ({ limit: async () => [] }) }),
  }),
}

/**
 * Wraps the harness database so a test can force a race and count `batch` calls.
 *
 * `beforeFirstBatch` runs once, on the first `batch` call only, because a retried batch goes through
 * the same wrapper and must not fire the side effect again. `staleFirstSelect` answers the first
 * `select` with an empty member read, so the caller believes the user has no workspace yet; that is
 * the read of `firstOrganizationIdFor`, which `select()` being synchronous cannot be made to await.
 */
function instrument(
  target: AppDatabase,
  options: {
    beforeFirstBatch?: () => Promise<void>
    staleFirstSelect?: boolean
  },
) {
  let batchCalls = 0
  let selectCalls = 0

  const wrapped = new Proxy(target, {
    get(inner, property) {
      const value: unknown = Reflect.get(inner, property, inner)
      if (property === 'batch') {
        return async (...args: Parameters<AppDatabase['batch']>) => {
          batchCalls += 1
          if (batchCalls === 1) await options.beforeFirstBatch?.()
          return inner.batch(...args)
        }
      }
      if (property === 'select' && typeof value === 'function') {
        return (...args: Array<unknown>) => {
          selectCalls += 1
          if (options.staleFirstSelect && selectCalls === 1) {
            return STALE_MEMBER_READ
          }
          return Reflect.apply(value, inner, args)
        }
      }
      return typeof value === 'function' ? value.bind(inner) : value
    },
  })

  return { db: wrapped, batchCalls: () => batchCalls }
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

describe('personalWorkspaceId', () => {
  it('is a pure function of the user id, in the shape of every other auth id', async () => {
    const first = await personalWorkspaceId('user-anna')

    await expect(personalWorkspaceId('user-anna')).resolves.toBe(first)
    await expect(personalWorkspaceId('user-other')).resolves.not.toBe(first)
    expect(first).toMatch(/^[A-Za-z0-9_-]{24}$/)
  })
})

describe('provisionPersonalWorkspace under a race', () => {
  it('calls the batch exactly once when nothing collides', async () => {
    const spy = instrument(db, {})

    const organizationId = await provisionPersonalWorkspace(spy.db, ANNA)

    expect(spy.batchCalls()).toBe(1)
    expect(organizationId).toBe(await personalWorkspaceId(ANNA.id))
  })

  it('lands a workspace for the loser of a slug collision between two different users', async () => {
    const spy = instrument(db, {
      beforeFirstBatch: () =>
        seedOrganization(db, {
          id: 'org-clash',
          name: 'Someone else',
          slug: personalWorkspaceSlug(ANNA),
        }),
    })

    const organizationId = await provisionPersonalWorkspace(spy.db, ANNA)

    const memberships = await membershipsOf(ANNA.id)
    expect(memberships).toHaveLength(1)
    expect(memberships[0]).toMatchObject({ organizationId, role: 'owner' })
    const [workspace] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
    expect(workspace?.slug).not.toBe(personalWorkspaceSlug(ANNA))
    expect(workspace?.slug.startsWith(`${personalWorkspaceSlug(ANNA)}-`)).toBe(
      true,
    )
    await expect(currencyRowsOf(organizationId)).resolves.toHaveLength(
      DEFAULT_WORKSPACE_CURRENCY_CODES.length,
    )
    expect(spy.batchCalls()).toBe(2)
  })

  it('returns the winner’s workspace when the same user races, the loser having drawn the base slug', async () => {
    let winnerId = ''
    const spy = instrument(db, {
      beforeFirstBatch: async () => {
        winnerId = await provisionPersonalWorkspace(db, ANNA)
      },
    })

    const organizationId = await provisionPersonalWorkspace(spy.db, ANNA)

    expect(organizationId).toBe(winnerId)
    await expect(db.select().from(organization)).resolves.toHaveLength(1)
    await expect(membershipsOf(ANNA.id)).resolves.toHaveLength(1)
  })

  it('returns the winner’s workspace when the same user races, the loser having drawn a suffixed slug', async () => {
    const winnerId = await provisionPersonalWorkspace(db, ANNA)
    // The loser's first read predates the winner's commit, so it believes the user has no workspace,
    // then finds the winner's base slug taken and draws a suffixed one.
    const spy = instrument(db, { staleFirstSelect: true })

    const organizationId = await provisionPersonalWorkspace(spy.db, ANNA)

    expect(organizationId).toBe(winnerId)
    expect(spy.batchCalls()).toBe(1)
    await expect(membershipsOf(ANNA.id)).resolves.toHaveLength(1)
    // The suffixed attempt was rolled back whole: only the winner's base slug is left.
    const workspaces = await db.select().from(organization)
    expect(workspaces.map((row) => row.slug)).toEqual([
      personalWorkspaceSlug(ANNA),
    ])
  })

  it('does not lock the user out when the deterministic id is held by a foreign workspace', async () => {
    await seedOrganization(db, {
      id: await personalWorkspaceId(ANNA.id),
      name: 'Foreign',
      slug: 'foreign',
    })
    const spy = instrument(db, {})

    const organizationId = await provisionPersonalWorkspace(spy.db, ANNA)

    expect(organizationId).not.toBe(await personalWorkspaceId(ANNA.id))
    const memberships = await membershipsOf(ANNA.id)
    expect(memberships).toHaveLength(1)
    expect(memberships[0]?.organizationId).toBe(organizationId)
    // The attempt on the deterministic id, then the one on a random id.
    expect(spy.batchCalls()).toBe(2)
  })

  it('rethrows a failure that is not a collision, once, and leaves nothing behind', async () => {
    const ghost = {
      id: 'user-ghost',
      name: 'Ghost',
      email: 'ghost@example.com',
    }
    const spy = instrument(db, {})

    await expect(provisionPersonalWorkspace(spy.db, ghost)).rejects.toThrow()

    expect(spy.batchCalls()).toBe(1)
    await expect(db.select().from(organization)).resolves.toHaveLength(0)
    await expect(db.select().from(member)).resolves.toHaveLength(0)
    await expect(
      db.select().from(organizationCurrencies),
    ).resolves.toHaveLength(0)
  })
})

describe('provisioned base currency', () => {
  it('a provisioned workspace always has exactly one base currency', async () => {
    const organizationId = await provisionPersonalWorkspace(db, ANNA)

    const rows = await currencyRowsOf(organizationId)
    const bases = rows.filter((row) => row.isBase)
    expect(bases).toHaveLength(1)
    expect(bases[0]?.currencyCode).toBe(DEFAULT_BASE_CURRENCY_CODE)

    // The base is a catalogue code: read the table rather than restating one.
    const catalogue = new Set(
      (await db.select({ code: currencies.code }).from(currencies)).map(
        (row) => row.code,
      ),
    )
    expect(catalogue.has(bases[0]?.currencyCode ?? '')).toBe(true)

    expect(rows.filter((row) => !row.isBase)).toHaveLength(rows.length - 1)
    expect(rows.map((row) => row.currencyCode).sort()).toEqual(
      [...DEFAULT_WORKSPACE_CURRENCY_CODES].sort(),
    )
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
