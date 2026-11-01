import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { organization } from '../../db/auth-schema'
import { dbFromEnv } from '../../db/from-env'
import { accountGroups } from '../../db/schema'

/**
 * The foreign key `deleteAccountGroup` leans on, on the real D1 binding.
 *
 * The repository batch removes the memberships and the group row explicitly, and promotes the
 * child groups through `account_groups.parent_id ON DELETE set null`. The Node tests run SQLite
 * with `PRAGMA foreign_keys = ON`, so they cannot say whether D1 enforces the same: a migration
 * comment records that the local and the remote D1 have not always agreed. This probe is that
 * evidence. It issues the delete directly because the repository module cannot be imported inside
 * workerd (it reaches `@tanstack/start-server-core`, whose entry specifiers only the Start build
 * resolves).
 */
describe('deleting an account group in workerd', () => {
  it('promotes a child group to the top level on D1', async () => {
    const db = dbFromEnv(env)
    const now = new Date('2026-03-15T10:00:00.000Z')
    await db.insert(organization).values({
      id: 'org-probe',
      name: 'Probe',
      slug: 'probe',
      createdAt: now,
    })
    await db.insert(accountGroups).values([
      {
        id: 'grp-parent',
        organizationId: 'org-probe',
        name: 'Household',
        position: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'grp-child',
        organizationId: 'org-probe',
        parentId: 'grp-parent',
        name: 'Kids',
        position: 0,
        createdAt: now,
        updatedAt: now,
      },
    ])

    await db.delete(accountGroups).where(eq(accountGroups.id, 'grp-parent'))

    const child = await db
      .select({ parentId: accountGroups.parentId })
      .from(accountGroups)
      .where(eq(accountGroups.id, 'grp-child'))
    expect(child).toEqual([{ parentId: null }])
  })
})
