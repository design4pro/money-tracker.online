/**
 * Transaction groups and templates: the auto-dissolve, the recomputed total, and the draft that is
 * never a transaction.
 *
 * The database is a real SQLite built from `drizzle/*.sql`, not a mock: every claim here is about
 * SQL that ran, and a fake would happily agree that a tenant predicate is present — the one thing
 * worth checking. Two workspaces exist in every test: **A**, who acts, and **B**, whose rows must
 * be untouched and unreachable afterwards.
 *
 * `docs/plans/11-splits-groups-attachments.md` files the tenant cases in `tenant-isolation.test.ts`
 * and the money cases in `money-invariants.test.ts`. They are written here instead, under the two
 * `describe` blocks named after those suites, for the reason `splits.test.ts` gives: several agents
 * were in this tree at once and a shared spec file is a merge conflict rather than a test. Moving
 * them is a copy-paste.
 *
 * Every expected figure below is worked out by hand in the comment beside it, in integer minor
 * units. Nothing here times anything: the properties this stage has are counted, not clocked.
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  tags,
  transactionGroupItems,
  transactionGroups,
  transactionTemplateTags,
  transactionTemplates,
  transactions,
} from '#/server/db/schema'

import { ConflictError, NotFoundError } from '../errors'
import {
  MAX_MEMBERS_PER_ADD,
  addToGroup,
  createGroup,
  deleteGroup,
  listGroups,
  removeFromGroup,
  renameGroup,
} from '../transaction-groups'
import {
  applyTemplate,
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
} from '../transaction-templates'
import {
  NOW,
  createBudgetWorld,
  seedCategory,
  seedTransaction,
} from './budget-harness'

import type { BudgetWorld, TestDb } from './budget-harness'

let world: BudgetWorld
let db: TestDb

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A group row written straight into the table.
 *
 * Written directly rather than through {@link createGroup} wherever a test is about membership: a
 * fixture built by the code under test cannot fail independently of it.
 */
async function seedGroup(input: {
  readonly id: string
  readonly organizationId?: string
}): Promise<string> {
  await db.insert(transactionGroups).values({
    id: input.id,
    organizationId: input.organizationId ?? 'org-a',
    name: input.id,
    createdAt: NOW,
    updatedAt: NOW,
  })
  return input.id
}

async function seedMembership(input: {
  readonly groupId: string
  readonly transactionId: string
  readonly organizationId?: string
  readonly position?: number
}): Promise<void> {
  await db.insert(transactionGroupItems).values({
    organizationId: input.organizationId ?? 'org-a',
    groupId: input.groupId,
    transactionId: input.transactionId,
    position: input.position ?? 0,
  })
}

async function seedTag(input: {
  readonly id: string
  readonly organizationId?: string
}): Promise<string> {
  await db.insert(tags).values({
    id: input.id,
    organizationId: input.organizationId ?? 'org-a',
    name: input.id,
    createdAt: NOW,
    updatedAt: NOW,
  })
  return input.id
}

/** The rows actually in the tables, read outside any scope. */
async function storedMembers(groupId: string) {
  return db
    .select()
    .from(transactionGroupItems)
    .where(eq(transactionGroupItems.groupId, groupId))
}

async function storedGroup(groupId: string) {
  return db
    .select()
    .from(transactionGroups)
    .where(eq(transactionGroups.id, groupId))
}

beforeEach(async () => {
  world = await createBudgetWorld()
  db = world.db
  await seedCategory(db, { id: 'cat-travel', name: 'Travel' })
  // Three expenses in A, in the base currency, so `ref_amount_minor === amount_minor` and every
  // figure below is readable at a glance.
  await seedTransaction(db, { id: 'txn-1', refAmountMinor: 120_00 })
  await seedTransaction(db, { id: 'txn-2', refAmountMinor: 80_00 })
  await seedTransaction(db, { id: 'txn-3', refAmountMinor: 45_00 })
})

/* -------------------------------------------------------------------------- */
/* Groups: membership                                                          */
/* -------------------------------------------------------------------------- */

describe('addToGroup', () => {
  it('adds the transactions it was given, in the order it was given them', async () => {
    await seedGroup({ id: 'grp-1' })

    const group = await addToGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-1', 'txn-2'],
    })

    expect(group.memberCount).toBe(2)
    const rows = await storedMembers('grp-1')
    expect(
      rows
        .toSorted((left, right) => left.position - right.position)
        .map((row) => row.transactionId),
    ).toEqual(['txn-1', 'txn-2'])
    expect(rows.map((row) => row.position).toSorted()).toEqual([0, 1])
  })

  it('deduplicates the ids at parse, so one selection is one membership', async () => {
    await seedGroup({ id: 'grp-1' })

    const group = await addToGroup(world.scope, {
      groupId: 'grp-1',
      // Three ids, two distinct. A bulk selection that offers the same row twice is one row.
      transactionIds: ['txn-1', 'txn-2', 'txn-1'],
    })

    expect(group.memberCount).toBe(2)
    expect(await storedMembers('grp-1')).toHaveLength(2)
  })

  it('is a no-op for a transaction already in the group and keeps the rest', async () => {
    await seedGroup({ id: 'grp-1' })
    await addToGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-1', 'txn-2'],
    })

    const group = await addToGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-2', 'txn-3'],
    })

    // 2 already in, 1 of the 2 sent is new: 3 members, and `txn-2` was not written twice.
    expect(group.memberCount).toBe(3)
    const rows = await storedMembers('grp-1')
    expect(rows).toHaveLength(3)
    expect(rows.filter((row) => row.transactionId === 'txn-2')).toHaveLength(1)
    // The new row continues the run rather than colliding with position 1.
    expect(rows.map((row) => row.position).toSorted()).toEqual([0, 1, 2])
  })

  it('refuses more ids in one call than a D1 statement can bind', async () => {
    await seedGroup({ id: 'grp-1' })
    // Four columns per membership row against D1's hundred-parameter ceiling is twenty-five rows.
    expect(MAX_MEMBERS_PER_ADD).toBe(25)

    const tooMany = Array.from(
      { length: MAX_MEMBERS_PER_ADD + 1 },
      (_, index) => `txn-over-${index}`,
    )
    await expect(
      addToGroup(world.scope, { groupId: 'grp-1', transactionIds: tooMany }),
    ).rejects.toThrow()
  })

  it('refuses a group that does not exist before looking at the transactions', async () => {
    await expect(
      addToGroup(world.scope, {
        groupId: 'grp-missing',
        transactionIds: ['txn-1', 'txn-2'],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('removeFromGroup', () => {
  it('removes a member and leaves the group standing while two remain', async () => {
    await seedGroup({ id: 'grp-1' })
    await addToGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-1', 'txn-2', 'txn-3'],
    })

    const result = await removeFromGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-3'],
    })

    // 3 members less 1 removed is 2, which is the minimum a grouping can be.
    expect(result).toMatchObject({ removed: 1, dissolved: false })
    expect(result.group?.memberCount).toBe(2)
    expect(await storedGroup('grp-1')).toHaveLength(1)
  })

  it('dissolves the group when the removal would leave one member', async () => {
    await seedGroup({ id: 'grp-1' })
    await addToGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-1', 'txn-2'],
    })

    const result = await removeFromGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-2'],
    })

    // 2 members less 1 removed is 1, which is a label rather than a grouping.
    expect(result).toMatchObject({ dissolved: true, group: null })
    // Both memberships went, not just the one named: the group they belonged to is gone, and the
    // cascade took them with it in the same statement.
    expect(result.removed).toBe(2)
    expect(await storedGroup('grp-1')).toHaveLength(0)
    expect(await storedMembers('grp-1')).toHaveLength(0)
  })

  it('leaves no one-member group behind for any consumer to find', async () => {
    await seedGroup({ id: 'grp-1' })
    await addToGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-1', 'txn-2'],
    })
    await removeFromGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-1'],
    })

    // The property stated as the list sees it: no group in the workspace has fewer than two
    // members, so no consumer needs a `length > 1` branch.
    const groups = await listGroups(world.scope)
    expect(groups).toEqual([])
    expect(
      groups.filter((group) => group.memberCount < 2).map((group) => group.id),
    ).toEqual([])
  })

  it('dissolves when every member is removed at once', async () => {
    await seedGroup({ id: 'grp-1' })
    await addToGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-1', 'txn-2', 'txn-3'],
    })

    const result = await removeFromGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-1', 'txn-2', 'txn-3'],
    })

    // 3 less 3 is 0, which is the same branch as 1: fewer than two survivors.
    expect(result).toMatchObject({ removed: 3, dissolved: true, group: null })
    expect(await storedGroup('grp-1')).toHaveLength(0)
  })

  it('ignores an id that is not a member and does not dissolve on it', async () => {
    await seedGroup({ id: 'grp-1' })
    await addToGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-1', 'txn-2'],
    })

    const result = await removeFromGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-3'],
    })

    // `txn-3` is not in the group, so nothing leaves and both members survive.
    expect(result).toMatchObject({ removed: 0, dissolved: false })
    expect(result.group?.memberCount).toBe(2)
  })
})

describe('createGroup, renameGroup and deleteGroup', () => {
  it('creates an empty group, which has never claimed to be a grouping', async () => {
    const group = await createGroup(world.scope, {
      name: 'Sicily 2026',
      note: 'Flights, hotel, the car',
      color: '#0d6abb',
    })

    expect(group.name).toBe('Sicily 2026')
    expect(group.memberCount).toBe(0)
    expect(group.totalMinor).toBe(0)
    expect(group.currencyCode).toBe('PLN')
  })

  it('refuses a colour the CHECK constraint would refuse', async () => {
    await expect(
      createGroup(world.scope, { name: 'Bad', color: 'blue' }),
    ).rejects.toThrow()
  })

  it('renames a group and keeps its membership', async () => {
    await seedGroup({ id: 'grp-1' })
    await addToGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-1', 'txn-2'],
    })

    const renamed = await renameGroup(world.scope, {
      groupId: 'grp-1',
      name: 'Kitchen',
    })

    expect(renamed.name).toBe('Kitchen')
    expect(renamed.memberCount).toBe(2)
  })

  it('deletes a group and its memberships, and never its transactions', async () => {
    await seedGroup({ id: 'grp-1' })
    await addToGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-1', 'txn-2'],
    })

    await deleteGroup(world.scope, { groupId: 'grp-1' })

    expect(await storedGroup('grp-1')).toHaveLength(0)
    expect(await storedMembers('grp-1')).toHaveLength(0)
    // A group is a way of reading rows. Deleting the reading has never deleted the rows.
    await expect(
      listGroups(world.scope, { transactionId: 'txn-1' }),
    ).resolves.toEqual([])
  })

  it('refuses to delete a group that is not there', async () => {
    await expect(
      deleteGroup(world.scope, { groupId: 'grp-missing' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

/* -------------------------------------------------------------------------- */
/* Groups: reads                                                               */
/* -------------------------------------------------------------------------- */

describe('listGroups', () => {
  it('is empty for a workspace that has none', async () => {
    await expect(listGroups(world.scope)).resolves.toEqual([])
  })

  it('narrows to the groups one transaction is in', async () => {
    await seedGroup({ id: 'grp-1' })
    await seedGroup({ id: 'grp-2' })
    await addToGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-1', 'txn-2'],
    })
    await addToGroup(world.scope, {
      groupId: 'grp-2',
      transactionIds: ['txn-2', 'txn-3'],
    })

    await expect(
      listGroups(world.scope, { transactionId: 'txn-1' }),
    ).resolves.toMatchObject([{ id: 'grp-1' }])
    // `txn-2` is in both, and the filter says so rather than picking one.
    const both = await listGroups(world.scope, { transactionId: 'txn-2' })
    expect(both.map((group) => group.id).toSorted()).toEqual(['grp-1', 'grp-2'])
  })
})

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

describe('templates', () => {
  it('saves a shape, appends it to the order and reads it back with its tags', async () => {
    await seedTag({ id: 'tag-fuel' })
    await seedTag({ id: 'tag-car' })

    const first = await createTemplate(world.scope, {
      name: 'Weekly shop',
      direction: 'expense',
      accountId: 'acc-a',
      categoryId: 'cat-travel',
      amountMinor: 250_00,
      currencyCode: 'PLN',
    })
    const second = await createTemplate(world.scope, {
      name: 'Fuel',
      direction: 'expense',
      tagIds: ['tag-fuel', 'tag-car'],
    })

    // The first template sits at 0 and the next one is appended, never given a chosen slot.
    expect(first.position).toBe(0)
    expect(second.position).toBe(1)
    expect(second.tagIds.toSorted()).toEqual(['tag-car', 'tag-fuel'])

    const listed = await listTemplates(world.scope)
    expect(listed.map((template) => template.name)).toEqual([
      'Weekly shop',
      'Fuel',
    ])
  })

  it('leaves the amount blank when the template deliberately does', async () => {
    const template = await createTemplate(world.scope, {
      name: 'Groceries, you type the number',
      direction: 'expense',
    })

    expect(template.amountMinor).toBeNull()
    expect(template.currencyCode).toBeNull()
  })

  it('refuses an amount with no currency, naming the field', async () => {
    const attempt = createTemplate(world.scope, {
      name: 'Broken',
      direction: 'expense',
      amountMinor: 100_00,
    })

    await expect(attempt).rejects.toThrow()
    // The refusal is Zod's, at the boundary, rather than the CHECK constraint's from the driver.
    await expect(attempt).rejects.toThrow(/currency/i)
  })

  it('refuses an edit that clears the currency and keeps the amount', async () => {
    const template = await createTemplate(world.scope, {
      name: 'Rent',
      direction: 'expense',
      amountMinor: 2_500_00,
      currencyCode: 'PLN',
    })

    // Only the merged row sees this: the patch itself names one field.
    await expect(
      updateTemplate(world.scope, {
        templateId: template.id,
        currencyCode: null,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('replaces the tag set wholesale when an edit names one', async () => {
    await seedTag({ id: 'tag-fuel' })
    await seedTag({ id: 'tag-car' })
    const template = await createTemplate(world.scope, {
      name: 'Fuel',
      direction: 'expense',
      tagIds: ['tag-fuel', 'tag-car'],
    })

    const edited = await updateTemplate(world.scope, {
      templateId: template.id,
      tagIds: ['tag-car'],
    })
    expect(edited.tagIds).toEqual(['tag-car'])

    // An absent `tagIds` leaves them alone rather than clearing them.
    const renamed = await updateTemplate(world.scope, {
      templateId: template.id,
      name: 'Diesel',
    })
    expect(renamed.name).toBe('Diesel')
    expect(renamed.tagIds).toEqual(['tag-car'])
  })

  it('deletes a template and its tag rows', async () => {
    await seedTag({ id: 'tag-fuel' })
    const template = await createTemplate(world.scope, {
      name: 'Fuel',
      direction: 'expense',
      tagIds: ['tag-fuel'],
    })

    await deleteTemplate(world.scope, { templateId: template.id })

    await expect(listTemplates(world.scope)).resolves.toEqual([])
    expect(
      await db
        .select()
        .from(transactionTemplateTags)
        .where(eq(transactionTemplateTags.templateId, template.id)),
    ).toHaveLength(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Money invariants — the cases 11-S2 files in money-invariants.test.ts         */
/* -------------------------------------------------------------------------- */

/**
 * This stage moves no money, so it adds nothing to `money-invariants.test.ts` about a sum that has
 * to balance. What it owes the money path is the three properties below: the group total is
 * *derived*, it is *signed*, and a template carries no reference amount at all.
 */
describe('money invariants', () => {
  it('the group total equals the integer sum of its members’ ref_amount_minor', async () => {
    await seedGroup({ id: 'grp-1' })
    await addToGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-1', 'txn-2', 'txn-3'],
    })

    const [group] = await listGroups(world.scope)
    // Three expenses: 120,00 + 80,00 + 45,00 = 245,00, and every one of them is money going out,
    // so the signed total is −245,00 → −24500 minor units.
    expect(group.totalMinor).toBe(-24_500)
    expect(group.memberCount).toBe(3)
    expect(group.currencyCode).toBe('PLN')
  })

  it('is recomputed on read, so editing a member changes it without a second write path', async () => {
    await seedGroup({ id: 'grp-1' })
    await addToGroup(world.scope, {
      groupId: 'grp-1',
      transactionIds: ['txn-1', 'txn-2'],
    })

    const before = await listGroups(world.scope)
    // 120,00 + 80,00 out = −20000.
    expect(before[0].totalMinor).toBe(-20_000)

    // The amount changes underneath the group, with nothing telling the group about it.
    await db
      .update(transactions)
      .set({ amountMinor: 200_00, refAmountMinor: 200_00 })
      .where(eq(transactions.id, 'txn-2'))

    const after = await listGroups(world.scope)
    // 120,00 + 200,00 out = −32000. No group row was written between the two reads.
    expect(after[0].totalMinor).toBe(-32_000)
    expect(await storedGroup('grp-1')).toHaveLength(1)
  })

  it('a group holding both legs of an internal transfer totals zero in base', async () => {
    // The two legs of one 300,00 movement: money leaves one account and arrives in the other, each
    // leg a positive amount with its own direction. Together they are not a change in net worth.
    await seedTransaction(db, {
      id: 'txn-leg-out',
      refAmountMinor: 300_00,
      direction: 'expense',
      transferKind: 'internal',
      transferId: 'tr-1',
    })
    await seedTransaction(db, {
      id: 'txn-leg-in',
      refAmountMinor: 300_00,
      direction: 'income',
      transferKind: 'internal',
      transferId: 'tr-1',
    })
    await seedGroup({ id: 'grp-transfer' })
    await addToGroup(world.scope, {
      groupId: 'grp-transfer',
      transactionIds: ['txn-leg-out', 'txn-leg-in'],
    })

    const [group] = await listGroups(world.scope)
    // +30000 in, −30000 out. Zero is the correct answer, not a bug to "fix" into the gross 30000.
    expect(group.totalMinor).toBe(0)
    expect(group.memberCount).toBe(2)
  })

  it('applyTemplate returns a draft with no ref_amount_minor', async () => {
    await seedTag({ id: 'tag-fuel' })
    const template = await createTemplate(world.scope, {
      name: 'Fuel',
      direction: 'expense',
      accountId: 'acc-a',
      categoryId: 'cat-travel',
      amountMinor: 300_00,
      currencyCode: 'EUR',
      note: 'Tank full',
      paymentMethod: 'card',
      tagIds: ['tag-fuel'],
    })

    const draft = await applyTemplate(world.scope, { templateId: template.id })

    expect(draft).toEqual({
      templateId: template.id,
      name: 'Fuel',
      accountId: 'acc-a',
      direction: 'expense',
      amountMinor: 300_00,
      currencyCode: 'EUR',
      categoryId: 'cat-travel',
      payeeId: null,
      note: 'Tank full',
      paymentMethod: 'card',
      tagIds: ['tag-fuel'],
    })

    // The shape is the guarantee, not a value: there is nowhere to put a reference amount, a rate
    // or a booking date, so a template cannot post March's rate in June.
    expect(Object.keys(draft).toSorted()).not.toContain('refAmountMinor')
    expect(Object.keys(draft).toSorted()).not.toContain('rateE10')
    expect(Object.keys(draft).toSorted()).not.toContain('bookedOn')
  })

  it('applyTemplate writes no transaction', async () => {
    const template = await createTemplate(world.scope, {
      name: 'Fuel',
      direction: 'expense',
      amountMinor: 300_00,
      currencyCode: 'PLN',
    })

    const before = await db.select().from(transactions)
    await applyTemplate(world.scope, { templateId: template.id })
    const after = await db.select().from(transactions)

    // Counted, not clocked: a draft is a draft precisely when the row count does not move.
    expect(after).toHaveLength(before.length)
  })
})

/* -------------------------------------------------------------------------- */
/* Tenant isolation — the cases 11-S2 files in tenant-isolation.test.ts         */
/* -------------------------------------------------------------------------- */

/**
 * A calls every one of the eleven exports against B's ids, and B is re-read from the table
 * afterwards. A write that matched no row but changed one anyway is the failure this shape catches
 * and a return-value assertion does not.
 */
describe('tenant isolation', () => {
  /** A group of B's with two members, and a template of B's. Neither may be reachable from A. */
  async function seedBsWorld() {
    await seedTransaction(db, {
      id: 'txn-b-1',
      organizationId: 'org-b',
      accountId: 'acc-b',
      refAmountMinor: 500_00,
    })
    await seedTransaction(db, {
      id: 'txn-b-2',
      organizationId: 'org-b',
      accountId: 'acc-b',
      refAmountMinor: 250_00,
    })
    await seedGroup({ id: 'grp-b', organizationId: 'org-b' })
    await seedMembership({
      groupId: 'grp-b',
      transactionId: 'txn-b-1',
      organizationId: 'org-b',
      position: 0,
    })
    await seedMembership({
      groupId: 'grp-b',
      transactionId: 'txn-b-2',
      organizationId: 'org-b',
      position: 1,
    })
    await db.insert(transactionTemplates).values({
      id: 'tpl-b',
      organizationId: 'org-b',
      name: "B's rent",
      direction: 'expense',
      amountMinor: 3_000_00,
      currencyCode: 'PLN',
      position: 0,
      createdAt: NOW,
      updatedAt: NOW,
    })
  }

  beforeEach(seedBsWorld)

  it('does not list another workspace’s groups or templates', async () => {
    await expect(listGroups(world.scope)).resolves.toEqual([])
    await expect(listTemplates(world.scope)).resolves.toEqual([])
  })

  it('answers empty rather than not-found when filtering by another workspace’s transaction', async () => {
    // A filter, not a lookup: a `NotFoundError` here would confirm the id exists somewhere.
    await expect(
      listGroups(world.scope, { transactionId: 'txn-b-1' }),
    ).resolves.toEqual([])
  })

  it('refuses every group write aimed at B, and B keeps its membership', async () => {
    await expect(
      renameGroup(world.scope, { groupId: 'grp-b', name: 'Mine now' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      addToGroup(world.scope, {
        groupId: 'grp-b',
        transactionIds: ['txn-1'],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      removeFromGroup(world.scope, {
        groupId: 'grp-b',
        transactionIds: ['txn-b-1'],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      deleteGroup(world.scope, { groupId: 'grp-b' }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const rows = await storedMembers('grp-b')
    expect(rows.map((row) => row.transactionId).toSorted()).toEqual([
      'txn-b-1',
      'txn-b-2',
    ])
    const [group] = await storedGroup('grp-b')
    expect(group.name).toBe('grp-b')
  })

  it('refuses addToGroup with B’s transaction ids onto A’s own group', async () => {
    await seedGroup({ id: 'grp-a' })

    await expect(
      addToGroup(world.scope, {
        groupId: 'grp-a',
        transactionIds: ['txn-1', 'txn-b-1'],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    // The refusal happens before the write, so A's group is left empty rather than half-filled.
    expect(await storedMembers('grp-a')).toHaveLength(0)
  })

  it('never counts another workspace’s rows in a group total', async () => {
    // A group of A's whose membership row points across the boundary — the state a bug would
    // produce. The total must still be zero, because the transaction side is scoped too.
    await seedGroup({ id: 'grp-a' })
    await seedMembership({ groupId: 'grp-a', transactionId: 'txn-b-1' })

    const [group] = await listGroups(world.scope)
    expect(group.totalMinor).toBe(0)
    expect(group.memberCount).toBe(0)
  })

  it('refuses every template write aimed at B, and B’s template is unchanged', async () => {
    await expect(
      updateTemplate(world.scope, { templateId: 'tpl-b', name: 'Mine now' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      deleteTemplate(world.scope, { templateId: 'tpl-b' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      applyTemplate(world.scope, { templateId: 'tpl-b' }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const [template] = await db
      .select()
      .from(transactionTemplates)
      .where(eq(transactionTemplates.id, 'tpl-b'))
    expect(template.name).toBe("B's rent")
  })

  it('refuses a template naming another workspace’s account, category, payee or tag', async () => {
    await seedTag({ id: 'tag-b', organizationId: 'org-b' })

    await expect(
      createTemplate(world.scope, {
        name: 'Reaching',
        direction: 'expense',
        accountId: 'acc-b',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      createTemplate(world.scope, {
        name: 'Reaching',
        direction: 'expense',
        tagIds: ['tag-b'],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    // Nothing was written on the way to either refusal.
    await expect(listTemplates(world.scope)).resolves.toEqual([])
  })
})
