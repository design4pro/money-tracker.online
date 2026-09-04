/**
 * The rule repository: the two ceilings, the references it refuses, and the tenant boundary.
 *
 * A real SQLite built from `drizzle/*.sql`, not a mock — every claim below is about SQL that ran,
 * and a fake would happily agree that a tenant predicate is present, which is the one thing worth
 * checking. Two workspaces exist in every test: **A**, who acts, and **B**, whose rows must be
 * untouched and unreachable afterwards.
 *
 * The `tenant isolation` block at the bottom is the stage's isolation suite. It lives here rather
 * than in `tenant-isolation.test.ts` because that file is shared and three agents are writing in
 * one tree this week; it covers the same ground the plan names, function by function, and is
 * written to be folded into the shared suite unchanged.
 */

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  accountGroups,
  payees,
  rules,
  tags,
  transactionTags,
  transactions,
} from '#/server/db/schema'
import { MAX_RULES_PER_WORKSPACE } from '#/server/rules/schema'
import { applyRules } from '#/server/rules/apply'

import { createBudgetWorld, seedCategory } from './budget-harness'
import { setLimitResolver } from '../base'
import {
  createRule,
  deleteRule,
  getRule,
  listApplicableRules,
  listRules,
  loadRuleSubjects,
  recordMatch,
  reorderRules,
  setRuleActive,
  updateRule,
} from '../rules'

import type { BudgetWorld, TestDb } from './budget-harness'
import type { TenantScope } from '../base'
import type { CreateRuleInput } from '../rules'

const NOW = new Date('2026-03-15T10:00:00.000Z')

let world: BudgetWorld
let db: TestDb
let scope: TenantScope
let otherScope: TenantScope

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** The smallest rule that saves: one condition, one action. */
function definition(overrides: Partial<CreateRuleInput> = {}): CreateRuleInput {
  return {
    name: 'Groceries',
    conditions: [{ field: 'note', operator: 'contains', keywords: ['zabka'] }],
    actions: [{ kind: 'set_category', categoryId: 'cat-groceries' }],
    ...overrides,
  }
}

async function seedTag(id: string, organizationId = 'org-a'): Promise<string> {
  await db
    .insert(tags)
    .values({ id, organizationId, name: id, createdAt: NOW, updatedAt: NOW })
  return id
}

async function seedPayee(
  id: string,
  organizationId = 'org-a',
): Promise<string> {
  await db
    .insert(payees)
    .values({ id, organizationId, name: id, createdAt: NOW, updatedAt: NOW })
  return id
}

async function seedGroup(
  id: string,
  organizationId = 'org-a',
): Promise<string> {
  await db.insert(accountGroups).values({
    id,
    organizationId,
    name: id,
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
  })
  return id
}

/** A rule row written straight into the table, for the cases that are not about creation. */
async function seedRuleRow(input: {
  readonly id: string
  readonly position: number
  readonly organizationId?: string
  readonly matchCount?: number
  readonly conditions?: unknown
  readonly actions?: unknown
}): Promise<string> {
  await db.insert(rules).values({
    id: input.id,
    organizationId: input.organizationId ?? 'org-a',
    name: input.id,
    position: input.position,
    matchMode: 'all',
    conditions: JSON.stringify(
      input.conditions ?? [{ field: 'direction', direction: 'expense' }],
    ),
    actions: JSON.stringify(
      input.actions ?? [{ kind: 'set_excluded', excludeFromStats: true }],
    ),
    isActive: true,
    pausedReason: null,
    matchCount: input.matchCount ?? 0,
    lastMatchedAt: null,
    runOn: JSON.stringify(['manual_create', 'import', 'edit']),
    createdAt: NOW,
    updatedAt: NOW,
  })
  return input.id
}

async function seedTransaction(input: {
  readonly id: string
  readonly organizationId?: string
  readonly accountId?: string
}): Promise<string> {
  await db.insert(transactions).values({
    id: input.id,
    organizationId: input.organizationId ?? 'org-a',
    accountId: input.accountId ?? 'acc-a',
    direction: 'expense',
    amountMinor: 100_00,
    currencyCode: 'PLN',
    refAmountMinor: 100_00,
    refCurrencyCode: 'PLN',
    rateE10: 10_000_000_000,
    bookedOn: '2026-03-10',
    bookedAt: new Date('2026-03-10T12:00:00.000Z'),
    note: 'ZABKA 4471',
    createdAt: NOW,
    updatedAt: NOW,
  })
  return input.id
}

async function ruleRow(id: string) {
  const rows = await db
    .select({
      organizationId: rules.organizationId,
      position: rules.position,
      matchCount: rules.matchCount,
      isActive: rules.isActive,
      name: rules.name,
      pausedReason: rules.pausedReason,
    })
    .from(rules)
    .where(eq(rules.id, id))
  return rows[0]
}

beforeEach(async () => {
  world = await createBudgetWorld()
  db = world.db
  scope = world.scope
  otherScope = world.otherScope
  await seedCategory(db, { id: 'cat-groceries', name: 'Groceries' })
  await seedCategory(db, {
    id: 'cat-b',
    name: "B's",
    organizationId: 'org-b',
  })
})

afterEach(() => {
  setLimitResolver(null)
})

/* -------------------------------------------------------------------------- */
/* Creating, listing and editing                                               */
/* -------------------------------------------------------------------------- */

describe('createRule', () => {
  it('appends at the end of the order and stores the definition as written', async () => {
    const first = await createRule(scope, definition({ name: 'First' }))
    const second = await createRule(scope, definition({ name: 'Second' }))

    expect(first.position).toBe(0)
    expect(second.position).toBe(1)
    expect(first.conditions).toEqual([
      { field: 'note', operator: 'contains', keywords: ['zabka'] },
    ])
    expect(first.actions).toEqual([
      { kind: 'set_category', categoryId: 'cat-groceries' },
    ])
    // The default triggers, and never a fourth one.
    expect(first.runOn).toEqual(['manual_create', 'import'])
    expect(first.matchMode).toBe('all')
  })

  it('refuses a condition or an action naming an id this workspace does not own', async () => {
    await expect(
      createRule(
        scope,
        definition({
          conditions: [
            { field: 'account', operator: 'is_any_of', ids: ['acc-nope'] },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', entity: 'account' })

    await expect(
      createRule(
        scope,
        definition({
          actions: [{ kind: 'set_category', categoryId: 'cat-nope' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', entity: 'category' })

    expect(await listRules(scope)).toHaveLength(0)
  })

  it('accepts every reference kind a rule can name, once they exist', async () => {
    await seedGroup('grp-1')
    await seedTag('tag-1')
    await seedPayee('payee-1')

    const rule = await createRule(
      scope,
      definition({
        conditions: [
          { field: 'account', operator: 'is_any_of', ids: ['acc-a'] },
          { field: 'account_group', operator: 'is_any_of', ids: ['grp-1'] },
          { field: 'tag', operator: 'is_none_of', ids: ['tag-1'] },
          {
            field: 'category',
            operator: 'is_none_of',
            ids: ['cat-groceries'],
          },
        ],
        actions: [
          { kind: 'set_payee', payeeId: 'payee-1' },
          { kind: 'add_tag', tagId: 'tag-1' },
        ],
      }),
    )
    expect(rule.conditions).toHaveLength(4)
    expect(rule.actions).toHaveLength(2)
  })

  it('refuses the 101st rule, whatever the plan allows', async () => {
    for (let index = 0; index < MAX_RULES_PER_WORKSPACE; index += 1) {
      await seedRuleRow({ id: `rule-${index}`, position: index })
    }

    await expect(createRule(scope, definition())).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      metric: 'rules',
      limit: MAX_RULES_PER_WORKSPACE,
    })
    expect(await listRules(scope)).toHaveLength(MAX_RULES_PER_WORKSPACE)
  })
})

describe('the quota', () => {
  it('is checked before the insert, with the count the workspace would end up at', async () => {
    setLimitResolver(async () => 1)
    await createRule(scope, definition({ name: 'First' }))

    await expect(
      createRule(scope, definition({ name: 'Second' })),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', metric: 'rules' })
    expect(await listRules(scope)).toHaveLength(1)
  })

  it('a zero ceiling is a locked feature, not an exhausted quota', async () => {
    setLimitResolver(async () => 0)

    await expect(createRule(scope, definition())).rejects.toMatchObject({
      code: 'FEATURE_LOCKED',
      module: 'rules',
    })
    expect(await listRules(scope)).toHaveLength(0)
  })
})

describe('listRules', () => {
  it('returns the workspace’s rules in the order they run, ties broken by id', async () => {
    await seedRuleRow({ id: 'rule-c', position: 1 })
    await seedRuleRow({ id: 'rule-a', position: 0 })
    // Two rules sharing a position: the order must still be total, and the same on every read.
    await seedRuleRow({ id: 'rule-b', position: 0 })

    const listed = await listRules(scope)
    expect(listed.map((rule) => rule.id)).toEqual([
      'rule-a',
      'rule-b',
      'rule-c',
    ])
    expect((await listRules(scope)).map((rule) => rule.id)).toEqual(
      listed.map((rule) => rule.id),
    )
  })

  it('reads a rule whose JSON this version cannot parse as matching nothing', async () => {
    await db.insert(rules).values({
      id: 'rule-broken',
      organizationId: 'org-a',
      name: 'Broken',
      position: 0,
      matchMode: 'all',
      conditions: '{ not json at all',
      actions: '[{"kind":"no_such_action"}]',
      isActive: true,
      matchCount: 0,
      runOn: 'nonsense',
      createdAt: NOW,
      updatedAt: NOW,
    })

    const [broken] = await listRules(scope)
    expect(broken.conditions).toEqual([])
    expect(broken.actions).toEqual([])
    expect(broken.runOn).toEqual([])
    // And it is not offered to a run: an unreadable rule stops acting, it does not act on everything.
    expect(await listApplicableRules(scope, 'import')).toEqual([])
  })
})

describe('updateRule', () => {
  it('replaces the conditions and the actions wholesale and clears a pause', async () => {
    const created = await createRule(scope, definition())
    await db
      .update(rules)
      .set({ pausedReason: JSON.stringify({ kind: 'missing_reference' }) })
      .where(eq(rules.id, created.id))

    const updated = await updateRule(scope, created.id, {
      name: 'Renamed',
      conditions: [{ field: 'direction', direction: 'income' }],
      runOn: ['edit'],
    })

    expect(updated.name).toBe('Renamed')
    expect(updated.conditions).toEqual([
      { field: 'direction', direction: 'income' },
    ])
    // Untouched by a patch that did not name them.
    expect(updated.actions).toEqual([
      { kind: 'set_category', categoryId: 'cat-groceries' },
    ])
    expect(updated.runOn).toEqual(['edit'])
    expect(updated.pausedReason).toBeNull()
  })

  it('refuses a patch naming another workspace’s category, and changes nothing', async () => {
    const created = await createRule(scope, definition())

    await expect(
      updateRule(scope, created.id, {
        actions: [{ kind: 'set_category', categoryId: 'cat-b' }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', entity: 'category' })

    expect((await getRule(scope, created.id)).actions).toEqual([
      { kind: 'set_category', categoryId: 'cat-groceries' },
    ])
  })
})

describe('reorderRules, setRuleActive, deleteRule and recordMatch', () => {
  it('reorderRules rewrites the whole order in one statement', async () => {
    await seedRuleRow({ id: 'rule-a', position: 0 })
    await seedRuleRow({ id: 'rule-b', position: 1 })
    await seedRuleRow({ id: 'rule-c', position: 2 })

    await reorderRules(scope, ['rule-c', 'rule-a', 'rule-b'])
    expect((await listRules(scope)).map((rule) => rule.id)).toEqual([
      'rule-c',
      'rule-a',
      'rule-b',
    ])
  })

  it('setRuleActive switches a rule off and takes it out of the run', async () => {
    const created = await createRule(scope, definition())
    expect(
      (await listApplicableRules(scope, 'import')).map((r) => r.id),
    ).toEqual([created.id])

    await setRuleActive(scope, created.id, false)
    expect(await listApplicableRules(scope, 'import')).toEqual([])
    expect((await ruleRow(created.id)).isActive).toBe(false)
  })

  it('listApplicableRules honours run_on', async () => {
    const created = await createRule(
      scope,
      definition({ runOn: ['manual_create'] }),
    )
    expect(
      (await listApplicableRules(scope, 'manual_create')).map((r) => r.id),
    ).toEqual([created.id])
    expect(await listApplicableRules(scope, 'import')).toEqual([])
  })

  it('deleteRule removes the row', async () => {
    const created = await createRule(scope, definition())
    await deleteRule(scope, created.id)

    await expect(getRule(scope, created.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      entity: 'rule',
    })
  })

  it('recordMatch adds a whole run’s matches at once', async () => {
    const created = await createRule(scope, definition())

    await recordMatch(scope, { ruleId: created.id, count: 12 })
    await recordMatch(scope, { ruleId: created.id, count: 3 })

    const after = await getRule(scope, created.id)
    expect(after.matchCount).toBe(15)
    expect(after.lastMatchedAt).not.toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* Tenant isolation                                                            */
/* -------------------------------------------------------------------------- */

describe('tenant isolation', () => {
  /** B's world: one rule at position 0 with a counter on it, plus a category, tag and account. */
  beforeEach(async () => {
    await seedRuleRow({
      id: 'rule-b',
      position: 0,
      organizationId: 'org-b',
      matchCount: 7,
    })
    await seedTag('tag-b', 'org-b')
    await seedPayee('payee-b', 'org-b')
    await seedGroup('grp-b', 'org-b')
  })

  it('A cannot read B’s rule', async () => {
    await expect(getRule(scope, 'rule-b')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      entity: 'rule',
    })
    expect(await listRules(scope)).toEqual([])
    expect(await listApplicableRules(scope, 'import')).toEqual([])
  })

  it('A cannot edit, deactivate, delete, reorder or count against B’s rule', async () => {
    await expect(
      updateRule(scope, 'rule-b', { name: 'Mine now' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', entity: 'rule' })

    await expect(setRuleActive(scope, 'rule-b', false)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      entity: 'rule',
    })

    await expect(deleteRule(scope, 'rule-b')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      entity: 'rule',
    })

    await expect(reorderRules(scope, ['rule-b'])).rejects.toMatchObject({
      code: 'NOT_FOUND',
      entity: 'rule',
    })

    await expect(
      recordMatch(scope, { ruleId: 'rule-b', count: 5 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', entity: 'rule' })

    // B's rule keeps its name, its order, its state and its counter.
    expect(await ruleRow('rule-b')).toEqual({
      organizationId: 'org-b',
      name: 'rule-b',
      position: 0,
      matchCount: 7,
      isActive: true,
      pausedReason: null,
    })
  })

  it('a reorder that names one of B’s rules moves none of A’s', async () => {
    await seedRuleRow({ id: 'rule-a1', position: 0 })
    await seedRuleRow({ id: 'rule-a2', position: 1 })

    await expect(
      reorderRules(scope, ['rule-a2', 'rule-b', 'rule-a1']),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', entity: 'rule' })

    expect((await ruleRow('rule-a1')).position).toBe(0)
    expect((await ruleRow('rule-a2')).position).toBe(1)
    expect((await ruleRow('rule-b')).position).toBe(0)
  })

  it('createRule refuses conditions naming B’s account, category or tag', async () => {
    const cases: ReadonlyArray<CreateRuleInput['conditions']> = [
      [{ field: 'account', operator: 'is_any_of', ids: ['acc-b'] }],
      [{ field: 'category', operator: 'is_any_of', ids: ['cat-b'] }],
      [{ field: 'tag', operator: 'is_any_of', ids: ['tag-b'] }],
      [{ field: 'account_group', operator: 'is_any_of', ids: ['grp-b'] }],
    ]
    for (const conditions of cases) {
      await expect(
        createRule(scope, definition({ conditions })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }

    expect(await listRules(scope)).toEqual([])
  })

  it('createRule refuses actions naming B’s category, payee or tag', async () => {
    const cases: ReadonlyArray<CreateRuleInput['actions']> = [
      [{ kind: 'set_category', categoryId: 'cat-b' }],
      [{ kind: 'set_payee', payeeId: 'payee-b' }],
      [{ kind: 'add_tag', tagId: 'tag-b' }],
      [{ kind: 'remove_tag', tagId: 'tag-b' }],
    ]
    for (const actions of cases) {
      await expect(
        createRule(scope, definition({ actions })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }

    expect(await listRules(scope)).toEqual([])
  })

  it('a run in A’s scope loads A’s rules only, and never evaluates B’s', async () => {
    await seedTag('tag-a')
    await seedTransaction({ id: 'tx-a' })
    await createRule(
      scope,
      definition({ actions: [{ kind: 'add_tag', tagId: 'tag-a' }] }),
    )

    // The set the evaluator is handed, asserted by count: one rule, and it is A's.
    const loaded = await listApplicableRules(scope, 'import')
    expect(loaded).toHaveLength(1)
    expect(loaded.map((rule) => rule.id)).not.toContain('rule-b')

    await applyRules(scope, { transactionIds: ['tx-a'], trigger: 'import' })

    // A's rule ran; B's did not, and B's counter is untouched by A's import.
    expect(
      await db
        .select({ tagId: transactionTags.tagId })
        .from(transactionTags)
        .where(eq(transactionTags.transactionId, 'tx-a')),
    ).toEqual([{ tagId: 'tag-a' }])
    expect((await ruleRow('rule-b')).matchCount).toBe(7)
  })

  it('a run in A’s scope cannot load or write one of B’s transactions', async () => {
    await seedTransaction({
      id: 'tx-b',
      organizationId: 'org-b',
      accountId: 'acc-b',
    })
    await seedTag('tag-a')
    await createRule(
      scope,
      definition({
        conditions: [{ field: 'direction', direction: 'expense' }],
        actions: [{ kind: 'add_tag', tagId: 'tag-a' }],
      }),
    )

    expect(await loadRuleSubjects(scope, ['tx-b'])).toEqual([])

    const result = await applyRules(scope, {
      transactionIds: ['tx-b'],
      trigger: 'import',
    })
    expect(result).toMatchObject({ scannedCount: 0, changedCount: 0 })
    expect(
      await db
        .select({ tagId: transactionTags.tagId })
        .from(transactionTags)
        .where(eq(transactionTags.transactionId, 'tx-b')),
    ).toEqual([])
  })

  it('B still sees B’s rule, unchanged, after all of it', async () => {
    const theirs = await listRules(otherScope)
    expect(theirs).toHaveLength(1)
    expect(theirs[0]).toMatchObject({
      id: 'rule-b',
      position: 0,
      matchCount: 7,
    })
  })
})
