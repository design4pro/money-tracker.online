import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { organization } from '../../db/auth-schema'
import { dbFromEnv } from '../../db/from-env'
import { accountGroupMembers, accountGroups, accounts } from '../../db/schema'

/**
 * The statement `deleteAccountGroup` relies on, on the real D1 binding.
 *
 * The repository removes only the group row and leaves the memberships and the child groups to the
 * foreign keys (`ON DELETE cascade` and `ON DELETE set null`). The Node tests run SQLite with
 * `PRAGMA foreign_keys = ON`, so they cannot say whether D1 enforces the same: a migration comment
 * records that the local and the remote D1 have not always agreed. This probe is that evidence.
 * It issues the delete directly because the repository module cannot be imported inside workerd
 * (it reaches `@tanstack/start-server-core`, whose entry specifiers only the Start build resolves).
 */
describe('deleting an account group in workerd', () => {
  it('cascades the memberships and promotes a child group on D1', async () => {
    const db = dbFromEnv(env)
    const now = new Date('2026-03-15T10:00:00.000Z')
    await db.insert(organization).values({
      id: 'org-probe',
      name: 'Probe',
      slug: 'probe',
      createdAt: now,
    })
    await db.insert(accounts).values({
      id: 'acc-probe',
      organizationId: 'org-probe',
      name: 'Everyday',
      currencyCode: 'PLN',
      createdAt: now,
      updatedAt: now,
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
    await db.insert(accountGroupMembers).values({
      organizationId: 'org-probe',
      groupId: 'grp-parent',
      accountId: 'acc-probe',
      position: 0,
    })

    await db.delete(accountGroups).where(eq(accountGroups.id, 'grp-parent'))

    expect(await db.select().from(accountGroupMembers)).toEqual([])
    const child = await db
      .select({ parentId: accountGroups.parentId })
      .from(accountGroups)
      .where(eq(accountGroups.id, 'grp-child'))
    expect(child).toEqual([{ parentId: null }])
    const account = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, 'acc-probe'))
    expect(account).toEqual([{ id: 'acc-probe' }])
  })
})
