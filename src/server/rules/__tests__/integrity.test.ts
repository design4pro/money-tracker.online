/**
 * Self-pausing: proved against a real SQLite, and proved on the *delete paths* rather than in
 * isolation.
 *
 * The claim this stage makes is not "there is a function that writes `paused_reason`" — it is
 * **"deleting a category pauses the rules that named it, before the call returns"**. A test that
 * only called `pauseRulesReferencing` would pass on a codebase where no delete path ever calls it,
 * which is exactly the failure the weekly sweep exists to catch. So every case below deletes
 * through the shipped repository function and then reads the rule row back.
 *
 * The database is real (`drizzle/*.sql` into an in-memory SQLite, foreign keys on) and every
 * statement is captured in `executed`, which is what lets the accounting case **count** the
 * counter updates instead of timing them.
 *
 * Two workspaces exist throughout: **A**, who acts, and **B**, whose rules must be untouched.
 */

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  accountGroupMembers,
  accountGroups,
  accounts,
  categories,
  payees,
  rules,
  tags,
  transactions,
} from '#/server/db/schema'
import { createLogger } from '#/server/observability/logger'
import { applyRules } from '#/server/rules/apply'
import {
  checkRuleIntegrity,
  pauseRulesReferencing,
  readPausedReason,
  replaceRuleReference,
  ruleReferences,
} from '#/server/rules/integrity'
import { deleteAccount, deleteAccountGroup } from '#/server/repos/accounts'
import { deleteCategory } from '#/server/repos/categories'
import { deletePayee } from '#/server/repos/payees'
import { setLimitResolver } from '#/server/repos/base'
import { listApplicableRules } from '#/server/repos/rules'
import { ruleDefinitionSchema } from '#/server/rules/schema'

import {
  createBudgetWorld,
  executed,
  fault,
  seedCategory,
} from '#/server/repos/__tests__/budget-harness'

import type { LogRecord } from '#/server/observability/logger'
import type { RuleDefinition } from '#/server/rules/schema'
import type {
  BudgetWorld,
  TestDb,
} from '#/server/repos/__tests__/budget-harness'
import type { TenantScope } from '#/server/repos/base'

const NOW = new Date('2026-03-15T10:00:00.000Z')
const PAUSED_AT = new Date('2026-04-01T09:30:00.000Z')

let world: BudgetWorld
let db: TestDb
let scope: TenantScope
let otherScope: TenantScope
let logged: Array<LogRecord>

function testLogger() {
  logged = []
  return createLogger({
    level: 'debug',
    sink: {
      write(record) {
        logged.push(record)
      },
    },
  })
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

async function seedRule(input: {
  readonly id: string
  readonly organizationId?: string
  readonly conditions?: unknown
  readonly actions?: unknown
  readonly pausedReason?: string | null
  readonly position?: number
}): Promise<string> {
  await db.insert(rules).values({
    id: input.id,
    organizationId: input.organizationId ?? 'org-a',
    name: input.id,
    position: input.position ?? 0,
    matchMode: 'all',
    conditions: JSON.stringify(
      input.conditions ?? [{ field: 'direction', direction: 'expense' }],
    ),
    actions: JSON.stringify(
      input.actions ?? [{ kind: 'set_excluded', excludeFromStats: true }],
    ),
    isActive: true,
    pausedReason: input.pausedReason ?? null,
    matchCount: 0,
    lastMatchedAt: null,
    runOn: JSON.stringify(['manual_create', 'import', 'edit']),
    createdAt: NOW,
    updatedAt: NOW,
  })
  return input.id
}

async function seedTag(id: string, name: string, organizationId = 'org-a') {
  await db
    .insert(tags)
    .values({ id, organizationId, name, createdAt: NOW, updatedAt: NOW })
  return id
}

async function seedPayee(id: string, name: string, organizationId = 'org-a') {
  await db
    .insert(payees)
    .values({ id, organizationId, name, createdAt: NOW, updatedAt: NOW })
  return id
}

async function seedGroup(
  id: string,
  name: string,
  organizationId = 'org-a',
  parentId: string | null = null,
) {
  await db.insert(accountGroups).values({
    id,
    organizationId,
    parentId,
    name,
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
  })
  return id
}

async function seedAccount(id: string, name: string, organizationId = 'org-a') {
  await db.insert(accounts).values({
    id,
    organizationId,
    name,
    currencyCode: 'PLN',
    createdAt: NOW,
    updatedAt: NOW,
  })
  return id
}

async function seedTransaction(id: string, note = 'ZABKA 4471') {
  await db.insert(transactions).values({
    id,
    organizationId: 'org-a',
    accountId: 'acc-a',
    direction: 'expense',
    amountMinor: 100_00,
    currencyCode: 'PLN',
    refAmountMinor: 100_00,
    refCurrencyCode: 'PLN',
    rateE10: 10_000_000_000,
    bookedOn: '2026-03-10',
    bookedAt: new Date('2026-03-10T12:00:00.000Z'),
    note,
    createdAt: NOW,
    updatedAt: NOW,
  })
  return id
}

async function pausedReasonOf(ruleId: string) {
  const rows = await db
    .select({ pausedReason: rules.pausedReason })
    .from(rules)
    .where(eq(rules.id, ruleId))
  return readPausedReason(rows[0]?.pausedReason ?? null)
}

/** Every `UPDATE "rules" …` the run caused. The accounting case counts these. */
function ruleUpdateStatements(): Array<string> {
  return executed.filter((statement) => /^update\s+"rules"/i.test(statement))
}

beforeEach(async () => {
  world = await createBudgetWorld()
  db = world.db
  scope = world.scope
  otherScope = world.otherScope
  await seedCategory(db, { id: 'cat-groceries', name: 'Groceries' })
})

afterEach(() => {
  setLimitResolver(null)
})

/* -------------------------------------------------------------------------- */
/* The delete paths write the pause                                            */
/* -------------------------------------------------------------------------- */

describe('the deleting operation pauses the rules that named the row', () => {
  it('deleteCategory pauses a rule whose action set that category', async () => {
    await seedRule({
      id: 'rule-cat',
      actions: [{ kind: 'set_category', categoryId: 'cat-groceries' }],
    })

    await deleteCategory(scope, 'cat-groceries')

    expect(await pausedReasonOf('rule-cat')).toMatchObject({
      kind: 'missing_reference',
      ref_type: 'category',
      ref_id: 'cat-groceries',
      label: 'Groceries',
    })
  })

  it('deleteCategory pauses a rule whose *condition* named that category', async () => {
    await seedCategory(db, { id: 'cat-fuel', name: 'Fuel' })
    await seedRule({
      id: 'rule-cond',
      conditions: [
        { field: 'category', operator: 'is_any_of', ids: ['cat-fuel'] },
      ],
    })

    await deleteCategory(scope, 'cat-fuel')

    expect(await pausedReasonOf('rule-cond')).toMatchObject({
      ref_type: 'category',
      ref_id: 'cat-fuel',
      label: 'Fuel',
    })
  })

  it('deleteAccount pauses a rule whose condition named that account', async () => {
    await seedAccount('acc-spare', 'Spare wallet')
    await seedRule({
      id: 'rule-acc',
      conditions: [
        { field: 'account', operator: 'is_any_of', ids: ['acc-spare'] },
      ],
    })

    await deleteAccount(scope, 'acc-spare')

    expect(await pausedReasonOf('rule-acc')).toMatchObject({
      ref_type: 'account',
      ref_id: 'acc-spare',
      label: 'Spare wallet',
    })
  })

  it('deleteAccountGroup pauses a rule whose condition named that group', async () => {
    await seedGroup('grp-cards', 'Cards')
    await seedRule({
      id: 'rule-grp',
      conditions: [
        { field: 'account_group', operator: 'is_any_of', ids: ['grp-cards'] },
      ],
    })

    await deleteAccountGroup(scope, 'grp-cards')

    expect(await pausedReasonOf('rule-grp')).toMatchObject({
      ref_type: 'account_group',
      ref_id: 'grp-cards',
      label: 'Cards',
    })
  })

  describe('deleteAccountGroup is never half-applied', () => {
    /** A group with a member and a child, named by a live rule: everything a delete touches. */
    async function seedGroupWithEverything() {
      await seedGroup('grp-cards', 'Cards')
      await seedGroup('grp-kids', 'Kids', 'org-a', 'grp-cards')
      await seedAccount('acc-spare', 'Spare wallet')
      await db.insert(accountGroupMembers).values({
        organizationId: 'org-a',
        groupId: 'grp-cards',
        accountId: 'acc-spare',
        position: 0,
      })
      await seedRule({
        id: 'rule-grp',
        conditions: [
          {
            field: 'account_group',
            operator: 'is_any_of',
            ids: ['grp-cards'],
          },
        ],
      })
    }

    const parentOfKids = async () =>
      (
        await db
          .select({ parentId: accountGroups.parentId })
          .from(accountGroups)
          .where(eq(accountGroups.id, 'grp-kids'))
      ).at(0)?.parentId

    it('leaves the group, its members, its children and the rule untouched when the delete fails', async () => {
      await seedGroupWithEverything()
      fault.when = (query) => /^delete\s+from\s+"account_groups"/i.test(query)

      await expect(deleteAccountGroup(scope, 'grp-cards')).rejects.toThrow(
        'Failed query: delete from "account_groups"',
      )

      expect(
        await db
          .select({ id: accountGroups.id })
          .from(accountGroups)
          .where(eq(accountGroups.id, 'grp-cards')),
      ).toHaveLength(1)
      expect(await db.select().from(accountGroupMembers)).toHaveLength(1)
      expect(await parentOfKids()).toBe('grp-cards')
      expect(await pausedReasonOf('rule-grp')).toBeNull()
    })

    it('leaves a consistent deleted group when only the pause fails, and the sweep pauses the rule', async () => {
      await seedGroupWithEverything()
      fault.when = (query) => /^update\s+"rules"/i.test(query)

      await expect(deleteAccountGroup(scope, 'grp-cards')).rejects.toThrow(
        'Failed query: update "rules"',
      )

      expect(
        await db
          .select({ id: accountGroups.id })
          .from(accountGroups)
          .where(eq(accountGroups.id, 'grp-cards')),
      ).toHaveLength(0)
      expect(await db.select().from(accountGroupMembers)).toHaveLength(0)
      expect(await parentOfKids()).toBeNull()
      expect(await pausedReasonOf('rule-grp')).toBeNull()

      fault.when = null
      const report = await checkRuleIntegrity({
        scope,
        logger: testLogger(),
        at: PAUSED_AT,
      })

      expect(report.paused).toEqual([
        { ruleId: 'rule-grp', refType: 'account_group', refId: 'grp-cards' },
      ])
      expect(await pausedReasonOf('rule-grp')).toMatchObject({
        ref_type: 'account_group',
        ref_id: 'grp-cards',
      })
    })
  })

  it('deletePayee pauses a rule whose action set that payee', async () => {
    await seedPayee('payee-zabka', 'Żabka')
    await seedRule({
      id: 'rule-payee',
      actions: [{ kind: 'set_payee', payeeId: 'payee-zabka' }],
    })

    await deletePayee(scope, 'payee-zabka')

    expect(await pausedReasonOf('rule-payee')).toMatchObject({
      ref_type: 'payee',
      ref_id: 'payee-zabka',
      label: 'Żabka',
    })
  })

  it('pauses on a deleted tag through the module directly, there being no tag repository yet', async () => {
    // `08-S2` has not landed: there is no `deleteTag`, so nothing can call this for a tag. The
    // contract is proved here so that whoever writes that delete path has the assertion waiting.
    await seedTag('tag-coffee', 'coffee')
    await seedRule({
      id: 'rule-tag',
      actions: [{ kind: 'add_tag', tagId: 'tag-coffee' }],
    })
    await db.delete(tags).where(eq(tags.id, 'tag-coffee'))

    const paused = await pauseRulesReferencing({
      scope,
      refType: 'tag',
      refId: 'tag-coffee',
      label: 'coffee',
    })

    expect(paused).toBe(1)
    expect(await pausedReasonOf('rule-tag')).toMatchObject({
      ref_type: 'tag',
      label: 'coffee',
    })
  })

  it('captures the label at pause time, when it is the last moment it exists', async () => {
    await seedCategory(db, { id: 'cat-gone', name: 'Season tickets' })
    await seedRule({
      id: 'rule-label',
      actions: [{ kind: 'set_category', categoryId: 'cat-gone' }],
    })

    await deleteCategory(scope, 'cat-gone')

    // The row it names is gone, so nothing but the stored label can say what broke.
    expect(await db.select().from(rules).where(eq(rules.id, 'never'))).toEqual(
      [],
    )
    expect((await pausedReasonOf('rule-label'))?.label).toBe('Season tickets')
    expect(
      await db
        .select({ id: rules.id })
        .from(rules)
        .where(eq(rules.id, 'rule-label')),
    ).toHaveLength(1)
  })

  it('records the instant it was handed, and reads back as an ISO-8601 timestamp', async () => {
    await seedCategory(db, { id: 'cat-when', name: 'When' })
    await seedRule({
      id: 'rule-when',
      actions: [{ kind: 'set_category', categoryId: 'cat-when' }],
    })
    await db.delete(rules).where(eq(rules.id, 'never'))

    await pauseRulesReferencing({
      scope,
      refType: 'category',
      refId: 'cat-when',
      label: 'When',
      at: PAUSED_AT,
    })

    expect((await pausedReasonOf('rule-when'))?.at).toBe(
      PAUSED_AT.toISOString(),
    )
  })

  it('leaves an already-paused rule with the reason that named what broke first', async () => {
    await seedCategory(db, { id: 'cat-first', name: 'First' })
    await seedPayee('payee-second', 'Second')
    await seedRule({
      id: 'rule-two',
      conditions: [
        { field: 'category', operator: 'is_any_of', ids: ['cat-first'] },
      ],
      actions: [{ kind: 'set_payee', payeeId: 'payee-second' }],
    })

    await deleteCategory(scope, 'cat-first')
    await deletePayee(scope, 'payee-second')

    expect(await pausedReasonOf('rule-two')).toMatchObject({
      ref_type: 'category',
      label: 'First',
    })
  })

  it('pauses every rule that named the row in one UPDATE, not one per rule', async () => {
    await seedCategory(db, { id: 'cat-many', name: 'Many' })
    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) {
      await seedRule({
        id,
        actions: [{ kind: 'set_category', categoryId: 'cat-many' }],
      })
    }

    executed.length = 0
    await deleteCategory(scope, 'cat-many')

    expect(ruleUpdateStatements()).toHaveLength(1)
    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) {
      expect((await pausedReasonOf(id))?.ref_id).toBe('cat-many')
    }
  })

  it('pauses nothing when no rule named the row', async () => {
    await seedCategory(db, { id: 'cat-unused', name: 'Unused' })
    await seedRule({ id: 'rule-unrelated' })

    executed.length = 0
    await deleteCategory(scope, 'cat-unused')

    expect(ruleUpdateStatements()).toEqual([])
    expect(await pausedReasonOf('rule-unrelated')).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* A paused rule stops applying — the money-adjacent property                  */
/* -------------------------------------------------------------------------- */

describe('a paused rule stops applying immediately', () => {
  it('is excluded from the very next run, so no dangling category is written', async () => {
    await seedCategory(db, { id: 'cat-doomed', name: 'Doomed' })
    await seedRule({
      id: 'rule-doomed',
      actions: [{ kind: 'set_category', categoryId: 'cat-doomed' }],
    })
    await seedTransaction('tx-1')

    expect(await listApplicableRules(scope, 'import')).toHaveLength(1)

    await deleteCategory(scope, 'cat-doomed')

    expect(await listApplicableRules(scope, 'import')).toEqual([])
    const result = await applyRules(scope, {
      transactionIds: ['tx-1'],
      trigger: 'import',
    })
    expect(result).toMatchObject({ scannedCount: 1, changedCount: 0 })

    const [row] = await db
      .select({ categoryId: transactions.categoryId })
      .from(transactions)
      .where(eq(transactions.id, 'tx-1'))
    expect(row.categoryId).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* Match accounting: one update per run                                        */
/* -------------------------------------------------------------------------- */

describe('match accounting', () => {
  /**
   * Counted, never timed.
   *
   * A wall-clock bound would pass on a machine fast enough to run five thousand updates inside it
   * and fail on a loaded CI box that ran one. The property is *how many statements*, so that is
   * what is asserted.
   */
  it('adds a whole run to the counters in one UPDATE, whatever the row count', async () => {
    await seedRule({
      id: 'rule-count-a',
      position: 0,
      actions: [{ kind: 'set_excluded', excludeFromStats: true }],
    })
    await seedRule({
      id: 'rule-count-b',
      position: 1,
      actions: [{ kind: 'mark_planned', isPlanned: true }],
    })

    const ids: Array<string> = []
    for (let index = 0; index < 20; index += 1) {
      ids.push(await seedTransaction(`tx-${index}`))
    }

    executed.length = 0
    const result = await applyRules(scope, {
      transactionIds: ids,
      trigger: 'import',
    })

    expect(result.scannedCount).toBe(20)
    // Two rules × twenty transactions = forty matches, and exactly one counter statement.
    expect(result.matchesByRule.get('rule-count-a')).toBe(20)
    expect(result.matchesByRule.get('rule-count-b')).toBe(20)
    expect(ruleUpdateStatements()).toHaveLength(1)

    const rows = await db
      .select({ id: rules.id, matchCount: rules.matchCount })
      .from(rules)
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: 'rule-count-a', matchCount: 20 },
        { id: 'rule-count-b', matchCount: 20 },
      ]),
    )
  })

  it('writes no counter statement at all when nothing matched', async () => {
    await seedRule({
      id: 'rule-never',
      conditions: [
        { field: 'note', operator: 'contains', keywords: ['nothing-here'] },
      ],
    })
    await seedTransaction('tx-quiet')

    executed.length = 0
    await applyRules(scope, {
      transactionIds: ['tx-quiet'],
      trigger: 'import',
    })

    expect(ruleUpdateStatements()).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* The weekly sweep                                                            */
/* -------------------------------------------------------------------------- */

describe('checkRuleIntegrity', () => {
  it('finds nothing on a healthy workspace and says nothing about it', async () => {
    await seedTag('tag-ok', 'ok')
    await seedRule({
      id: 'rule-ok',
      conditions: [
        { field: 'category', operator: 'is_any_of', ids: ['cat-groceries'] },
      ],
      actions: [{ kind: 'add_tag', tagId: 'tag-ok' }],
    })

    const report = await checkRuleIntegrity({ scope, logger: testLogger() })

    expect(report).toEqual({ checked: 1, paused: [] })
    expect(logged.filter((record) => record.level === 'warn')).toEqual([])
    expect(await pausedReasonOf('rule-ok')).toBeNull()
  })

  it('pauses and warns with the rule id when a delete path missed its call', async () => {
    await seedCategory(db, { id: 'cat-orphan', name: 'Orphan' })
    await seedRule({
      id: 'rule-orphan',
      actions: [{ kind: 'set_category', categoryId: 'cat-orphan' }],
    })
    // The delete path that forgot to call `pauseRulesReferencing`, simulated exactly: the row
    // goes, the rule stays live.
    await db.delete(categories).where(eq(categories.id, 'cat-orphan'))

    const report = await checkRuleIntegrity({
      scope,
      logger: testLogger(),
      at: PAUSED_AT,
    })

    expect(report.paused).toEqual([
      { ruleId: 'rule-orphan', refType: 'category', refId: 'cat-orphan' },
    ])
    const warnings = logged.filter((record) => record.level === 'warn')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ ruleId: 'rule-orphan' })

    // No name survives to a sweep, so the id is what it can honestly record — and a banner
    // showing an id is itself the visible symptom of the missing delete-path call.
    expect(await pausedReasonOf('rule-orphan')).toMatchObject({
      ref_type: 'category',
      ref_id: 'cat-orphan',
      label: 'cat-orphan',
      at: PAUSED_AT.toISOString(),
    })
  })

  it('skips a rule that is already paused rather than re-reporting it', async () => {
    await seedCategory(db, { id: 'cat-known', name: 'Known' })
    await seedRule({
      id: 'rule-known',
      actions: [{ kind: 'set_category', categoryId: 'cat-known' }],
    })
    await deleteCategory(scope, 'cat-known')

    const report = await checkRuleIntegrity({ scope, logger: testLogger() })

    expect(report).toEqual({ checked: 0, paused: [] })
    expect(logged.filter((record) => record.level === 'warn')).toEqual([])
  })

  it('pauses many rules broken by one deletion in a single UPDATE', async () => {
    await seedCategory(db, { id: 'cat-shared', name: 'Shared' })
    for (const id of ['s1', 's2', 's3']) {
      await seedRule({
        id,
        actions: [{ kind: 'set_category', categoryId: 'cat-shared' }],
      })
    }
    await db.delete(categories).where(eq(categories.id, 'cat-shared'))

    executed.length = 0
    const report = await checkRuleIntegrity({ scope, logger: testLogger() })

    expect(report.paused).toHaveLength(3)
    expect(ruleUpdateStatements()).toHaveLength(1)
  })
})

/* -------------------------------------------------------------------------- */
/* Rewriting a reference — the repair half                                     */
/* -------------------------------------------------------------------------- */

describe('replaceRuleReference', () => {
  function draft(overrides: Partial<RuleDefinition> = {}): RuleDefinition {
    return {
      name: 'Groceries',
      matchMode: 'all',
      conditions: [
        { field: 'category', operator: 'is_any_of', ids: ['cat-dead'] },
      ],
      actions: [{ kind: 'set_category', categoryId: 'cat-dead' }],
      runOn: ['manual_create', 'import'],
      ...overrides,
    }
  }

  /**
   * Written first because it is the one that fails silently.
   *
   * An id is unique only *within its kind*. A payee whose id happens to equal a category id must
   * not be rewritten by a category repair: nothing would throw, nothing would look wrong, and a
   * rule nobody opened would quietly start classifying against a different row.
   */
  it('never rewrites a matching id of a different kind', () => {
    const collision = draft({
      conditions: [
        { field: 'category', operator: 'is_any_of', ids: ['shared-id'] },
      ],
      actions: [{ kind: 'set_payee', payeeId: 'shared-id' }],
    })

    const next = replaceRuleReference(
      collision,
      'category',
      'shared-id',
      'cat-new',
    )

    expect(next.conditions).toEqual([
      { field: 'category', operator: 'is_any_of', ids: ['cat-new'] },
    ])
    // The payee kept the very same string, because it is a payee.
    expect(next.actions).toEqual([{ kind: 'set_payee', payeeId: 'shared-id' }])
  })

  it('replaces every occurrence — the condition and the action both', () => {
    const next = replaceRuleReference(
      draft(),
      'category',
      'cat-dead',
      'cat-live',
    )

    expect(next.conditions).toEqual([
      { field: 'category', operator: 'is_any_of', ids: ['cat-live'] },
    ])
    expect(next.actions).toEqual([
      { kind: 'set_category', categoryId: 'cat-live' },
    ])
  })

  it('replaces every occurrence inside one id list, and leaves its neighbours alone', () => {
    const next = replaceRuleReference(
      draft({
        conditions: [
          {
            field: 'tag',
            operator: 'is_any_of',
            ids: ['tag-a', 'tag-dead', 'tag-b'],
          },
        ],
        actions: [
          { kind: 'add_tag', tagId: 'tag-dead' },
          { kind: 'remove_tag', tagId: 'tag-b' },
        ],
      }),
      'tag',
      'tag-dead',
      'tag-live',
    )

    expect(next.conditions).toEqual([
      {
        field: 'tag',
        operator: 'is_any_of',
        ids: ['tag-a', 'tag-live', 'tag-b'],
      },
    ])
    expect(next.actions).toEqual([
      { kind: 'add_tag', tagId: 'tag-live' },
      { kind: 'remove_tag', tagId: 'tag-b' },
    ])
  })

  it('rewrites only the kind asked for when a rule names two kinds', () => {
    const next = replaceRuleReference(
      draft({
        conditions: [
          { field: 'account', operator: 'is_any_of', ids: ['acc-dead'] },
          {
            field: 'account_group',
            operator: 'is_any_of',
            ids: ['grp-dead'],
          },
        ],
        actions: [{ kind: 'set_payee', payeeId: 'payee-1' }],
      }),
      'account',
      'acc-dead',
      'acc-live',
    )

    expect(next.conditions).toEqual([
      { field: 'account', operator: 'is_any_of', ids: ['acc-live'] },
      { field: 'account_group', operator: 'is_any_of', ids: ['grp-dead'] },
    ])
    expect(next.actions).toEqual([{ kind: 'set_payee', payeeId: 'payee-1' }])
  })

  it('returns the argument itself, untouched, when there is nothing to replace', () => {
    const original = draft()
    const next = replaceRuleReference(
      original,
      'category',
      'cat-absent',
      'cat-live',
    )

    // Reference identity, all the way down: the docblock promises it, so it is pinned.
    expect(next).toBe(original)
    expect(next.conditions).toBe(original.conditions)
    expect(next.actions).toBe(original.actions)
  })

  it('leaves a rule that carries no id of that kind at all alone', () => {
    const original = draft({
      conditions: [
        { field: 'note', operator: 'contains', keywords: ['zabka'] },
      ],
      actions: [{ kind: 'set_excluded', excludeFromStats: true }],
    })

    expect(replaceRuleReference(original, 'tag', 'tag-dead', 'tag-live')).toBe(
      original,
    )
  })

  it('does not mutate the definition it was handed', () => {
    const original = draft()
    const snapshot = structuredClone(original)

    replaceRuleReference(original, 'category', 'cat-dead', 'cat-live')

    expect(original).toEqual(snapshot)
  })

  it('is the inverse of ruleReferences: what it rewrote is what that enumerated', () => {
    const original = draft({
      conditions: [
        { field: 'category', operator: 'is_any_of', ids: ['cat-dead'] },
        { field: 'payee', operator: 'contains', keywords: ['zabka'] },
      ],
      actions: [
        { kind: 'set_category', categoryId: 'cat-dead' },
        { kind: 'add_tag', tagId: 'tag-1' },
      ],
    })

    // The two functions walk the same ground, so the enumeration predicts the rewrite exactly.
    expect(ruleReferences(original)).toEqual([
      { refType: 'category', refId: 'cat-dead' },
      { refType: 'category', refId: 'cat-dead' },
      { refType: 'tag', refId: 'tag-1' },
    ])

    const next = replaceRuleReference(
      original,
      'category',
      'cat-dead',
      'cat-live',
    )
    expect(ruleReferences(next)).toEqual([
      { refType: 'category', refId: 'cat-live' },
      { refType: 'category', refId: 'cat-live' },
      { refType: 'tag', refId: 'tag-1' },
    ])
  })

  it('does not touch a payee *condition*, which matches on the name and carries no id', () => {
    const original = draft({
      conditions: [
        { field: 'payee', operator: 'contains', keywords: ['zabka'] },
      ],
      actions: [{ kind: 'set_payee', payeeId: 'payee-dead' }],
    })

    const next = replaceRuleReference(original, 'payee', 'zabka', 'payee-live')

    expect(next).toBe(original)
  })

  it('round-trips through the definition schema, so the result is savable', () => {
    const next = replaceRuleReference(
      draft(),
      'category',
      'cat-dead',
      'cat-live',
    )

    expect(ruleDefinitionSchema.parse(next)).toEqual(next)
  })
})

/* -------------------------------------------------------------------------- */
/* Tenant isolation                                                            */
/* -------------------------------------------------------------------------- */

describe('tenant isolation', () => {
  beforeEach(async () => {
    await seedCategory(db, {
      id: 'cat-b',
      name: "B's groceries",
      organizationId: 'org-b',
    })
    await seedRule({
      id: 'rule-b',
      organizationId: 'org-b',
      actions: [{ kind: 'set_category', categoryId: 'cat-b' }],
    })
    await seedRule({
      id: 'rule-a',
      actions: [{ kind: 'set_category', categoryId: 'cat-groceries' }],
    })
  })

  it('pauseRulesReferencing in A’s scope, given B’s refId, pauses nothing at all', async () => {
    const paused = await pauseRulesReferencing({
      scope,
      refType: 'category',
      refId: 'cat-b',
      label: "B's groceries",
    })

    expect(paused).toBe(0)
    expect(await pausedReasonOf('rule-b')).toBeNull()
    expect(await pausedReasonOf('rule-a')).toBeNull()
  })

  it('a delete in A’s scope cannot pause B’s rule that named the same kind of row', async () => {
    await deleteCategory(scope, 'cat-groceries')

    expect(await pausedReasonOf('rule-a')).toMatchObject({
      ref_id: 'cat-groceries',
    })
    expect(await pausedReasonOf('rule-b')).toBeNull()
  })

  it('checkRuleIntegrity sweeps one scope at a time and never reads across tenants', async () => {
    // B's category is deleted behind B's back. A's sweep must not see B's rule at all — neither
    // to report it nor to pause it.
    await db.delete(categories).where(eq(categories.id, 'cat-b'))

    const report = await checkRuleIntegrity({ scope, logger: testLogger() })

    expect(report).toEqual({ checked: 1, paused: [] })
    expect(await pausedReasonOf('rule-b')).toBeNull()

    // B's own sweep does find it, which is what proves the first assertion was isolation and not
    // an inert sweep.
    const theirs = await checkRuleIntegrity({
      scope: otherScope,
      logger: testLogger(),
    })
    expect(theirs.paused).toEqual([
      { ruleId: 'rule-b', refType: 'category', refId: 'cat-b' },
    ])
  })

  it('A’s scope cannot resolve one of B’s ids as existing', async () => {
    // `cat-b` exists in the database and not in A's workspace, so A's sweep treats a rule of A's
    // naming it as broken rather than as satisfied by B's row.
    await seedRule({
      id: 'rule-a-borrowing',
      position: 1,
      actions: [{ kind: 'set_category', categoryId: 'cat-b' }],
    })

    const report = await checkRuleIntegrity({ scope, logger: testLogger() })

    expect(report.paused).toEqual([
      { ruleId: 'rule-a-borrowing', refType: 'category', refId: 'cat-b' },
    ])
  })
})
