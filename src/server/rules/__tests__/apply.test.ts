/**
 * The run: the order, what wins, what a trigger gates, and the columns a rule may never touch.
 *
 * The pure half is folded with hand-built rules, because ordering is a claim about a list and a
 * fixture would only hide it. The effectful half runs against a real SQLite built from
 * `drizzle/*.sql`, because the money invariant this stage owes is a claim about **columns after a
 * write**, and a mock would happily agree that `amount_minor` did not move.
 *
 * The case the whole stage rests on is `applying every action kind leaves the money columns
 * byte-identical`. It is what lets a rule run skip the ledger batch entirely; the day it fails, the
 * skip is a corruption and not an optimisation.
 */

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  payees,
  rules,
  tags,
  transactionTags,
  transactions,
} from '#/server/db/schema'

import {
  createBudgetWorld,
  executed,
  seedCategory,
} from '../../repos/__tests__/budget-harness'
import { runWithLedgerCollector, setLimitResolver } from '../../repos/base'
import { applyRules, resolveOutcome } from '../apply'
import { ruleActionsSchema, ruleConditionsSchema } from '../schema'

import type { BudgetWorld, TestDb } from '../../repos/__tests__/budget-harness'
import type { TenantScope } from '../../repos/base'
import type { Rule, RuleSubject } from '#/server/repos/rules'

const NOW = new Date('2026-03-15T10:00:00.000Z')

let world: BudgetWorld
let db: TestDb
let scope: TenantScope

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

interface RuleInput {
  readonly id: string
  readonly position: number
  readonly conditions: unknown
  readonly actions: unknown
  readonly matchMode?: 'all' | 'any'
  readonly runOn?: ReadonlyArray<string>
  readonly isActive?: boolean
  readonly pausedReason?: string | null
  readonly organizationId?: string
}

/** A rule row written straight into the table: the creation path is `repos/__tests__/rules`. */
async function seedRule(input: RuleInput): Promise<string> {
  await db.insert(rules).values({
    id: input.id,
    organizationId: input.organizationId ?? 'org-a',
    name: input.id,
    position: input.position,
    matchMode: input.matchMode ?? 'all',
    conditions: JSON.stringify(ruleConditionsSchema.parse(input.conditions)),
    actions: JSON.stringify(ruleActionsSchema.parse(input.actions)),
    isActive: input.isActive ?? true,
    pausedReason: input.pausedReason ?? null,
    matchCount: 0,
    lastMatchedAt: null,
    runOn: JSON.stringify(input.runOn ?? ['manual_create', 'import', 'edit']),
    createdAt: NOW,
    updatedAt: NOW,
  })
  return input.id
}

interface TransactionInput {
  readonly id: string
  readonly note?: string | null
  readonly payeeId?: string | null
  readonly payeeLocked?: boolean
  readonly amountMinor?: number
  readonly categoryId?: string | null
  readonly organizationId?: string
  readonly accountId?: string
  readonly bookedOn?: string
  readonly isPlanned?: boolean
}

const IDENTITY_RATE_E10 = 10_000_000_000

async function seedTransaction(input: TransactionInput): Promise<string> {
  const amountMinor = input.amountMinor ?? 100_00
  await db.insert(transactions).values({
    id: input.id,
    organizationId: input.organizationId ?? 'org-a',
    accountId: input.accountId ?? 'acc-a',
    direction: 'expense',
    amountMinor,
    currencyCode: 'PLN',
    refAmountMinor: amountMinor,
    refCurrencyCode: 'PLN',
    rateE10: IDENTITY_RATE_E10,
    bookedOn: input.bookedOn ?? '2026-03-10',
    bookedAt: new Date('2026-03-10T12:00:00.000Z'),
    isPlanned: input.isPlanned ?? false,
    categoryId: input.categoryId ?? null,
    payeeId: input.payeeId ?? null,
    payeeLocked: input.payeeLocked ?? false,
    note: input.note ?? 'ZABKA 4471',
    createdAt: NOW,
    updatedAt: NOW,
  })
  return input.id
}

async function seedTag(id: string, organizationId = 'org-a'): Promise<string> {
  await db
    .insert(tags)
    .values({ id, organizationId, name: id, createdAt: NOW, updatedAt: NOW })
  return id
}

async function seedPayee(id: string): Promise<string> {
  await db.insert(payees).values({
    id,
    organizationId: 'org-a',
    name: id,
    createdAt: NOW,
    updatedAt: NOW,
  })
  return id
}

/** A rule as `resolveOutcome` reads one, for the cases that need no database at all. */
function rule(input: {
  readonly id: string
  readonly conditions: unknown
  readonly actions: unknown
  readonly matchMode?: 'all' | 'any'
  readonly runOn?: ReadonlyArray<'manual_create' | 'import' | 'edit'>
}): Rule {
  return {
    id: input.id,
    name: input.id,
    position: 0,
    matchMode: input.matchMode ?? 'all',
    conditions: ruleConditionsSchema.parse(input.conditions),
    actions: ruleActionsSchema.parse(input.actions),
    isActive: true,
    pausedReason: null,
    matchCount: 0,
    lastMatchedAt: null,
    runOn: input.runOn ?? ['manual_create', 'import', 'edit'],
  }
}

function subject(overrides: Partial<RuleSubject> = {}): RuleSubject {
  return {
    transactionId: 'tx-1',
    note: 'ZABKA 4471',
    payeeName: 'Żabka',
    accountId: 'acc-a',
    accountGroupIds: [],
    categoryId: null,
    tagIds: [],
    amountMinor: 100_00,
    currencyCode: 'PLN',
    direction: 'expense',
    bookedOn: '2026-03-10',
    payeeLocked: false,
    ...overrides,
  }
}

const EXPENSE = [{ field: 'direction', direction: 'expense' }]

beforeEach(async () => {
  world = await createBudgetWorld()
  db = world.db
  scope = world.scope
  await seedCategory(db, { id: 'cat-groceries', name: 'Groceries' })
  await seedCategory(db, { id: 'cat-treats', name: 'Treats' })
})

afterEach(() => {
  setLimitResolver(null)
})

/* -------------------------------------------------------------------------- */
/* Order                                                                       */
/* -------------------------------------------------------------------------- */

describe('rules apply in order, cumulatively', () => {
  it('a later rule overwrites an earlier rule’s category', () => {
    const first = rule({
      id: 'rule-1',
      conditions: EXPENSE,
      actions: [{ kind: 'set_category', categoryId: 'cat-groceries' }],
    })
    const second = rule({
      id: 'rule-2',
      conditions: EXPENSE,
      actions: [{ kind: 'set_category', categoryId: 'cat-treats' }],
    })

    expect(
      resolveOutcome([first, second], subject(), 'manual_create').outcome,
    ).toMatchObject({ categoryId: 'cat-treats' })
    // The same two rules the other way round say the other thing — which is the whole contract.
    expect(
      resolveOutcome([second, first], subject(), 'manual_create').outcome,
    ).toMatchObject({ categoryId: 'cat-groceries' })
  })

  it('reports the rules that matched, in the order they ran', () => {
    const matching = rule({
      id: 'rule-1',
      conditions: EXPENSE,
      actions: [{ kind: 'add_tag', tagId: 'tag-1' }],
    })
    const notMatching = rule({
      id: 'rule-2',
      conditions: [{ field: 'direction', direction: 'income' }],
      actions: [{ kind: 'add_tag', tagId: 'tag-2' }],
    })
    const alsoMatching = rule({
      id: 'rule-3',
      conditions: EXPENSE,
      actions: [{ kind: 'add_tag', tagId: 'tag-3' }],
    })

    const resolved = resolveOutcome(
      [matching, notMatching, alsoMatching],
      subject(),
      'import',
    )
    expect(resolved.matchedRuleIds).toEqual(['rule-1', 'rule-3'])
    expect(resolved.outcome.addTagIds).toEqual(['tag-1', 'tag-3'])
  })

  it('the last operation naming a tag wins, so a run never adds and removes the same one', () => {
    const adds = rule({
      id: 'rule-1',
      conditions: EXPENSE,
      actions: [{ kind: 'add_tag', tagId: 'tag-1' }],
    })
    const removes = rule({
      id: 'rule-2',
      conditions: EXPENSE,
      actions: [{ kind: 'remove_tag', tagId: 'tag-1' }],
    })

    const resolved = resolveOutcome([adds, removes], subject(), 'import')
    expect(resolved.outcome.addTagIds).toEqual([])
    expect(resolved.outcome.removeTagIds).toEqual(['tag-1'])
  })

  it('there is no re-run loop: a rule sees the transaction, never an earlier rule’s output', () => {
    const categorises = rule({
      id: 'rule-1',
      conditions: EXPENSE,
      actions: [{ kind: 'set_category', categoryId: 'cat-groceries' }],
    })
    // Matches only a transaction that is *already* in Groceries. The rule above just put it there
    // in the outcome — and this rule still must not fire, or the pass count decides the result.
    const reacts = rule({
      id: 'rule-2',
      conditions: [
        { field: 'category', operator: 'is_any_of', ids: ['cat-groceries'] },
      ],
      actions: [{ kind: 'add_tag', tagId: 'tag-1' }],
    })

    const resolved = resolveOutcome([categorises, reacts], subject(), 'import')
    expect(resolved.matchedRuleIds).toEqual(['rule-1'])
    expect(resolved.outcome.addTagIds).toEqual([])
  })

  it('a locked payee is not overwritten by set_payee', () => {
    const renames = rule({
      id: 'rule-1',
      conditions: EXPENSE,
      actions: [
        { kind: 'set_payee', payeeId: 'payee-1' },
        { kind: 'add_tag', tagId: 'tag-1' },
      ],
    })

    expect(resolveOutcome([renames], subject(), 'import').outcome.payeeId).toBe(
      'payee-1',
    )

    const locked = resolveOutcome(
      [renames],
      subject({ payeeLocked: true }),
      'import',
    )
    expect(locked.outcome.payeeId).toBeUndefined()
    // The rule still matched and its other actions still applied: only the payee is protected.
    expect(locked.matchedRuleIds).toEqual(['rule-1'])
    expect(locked.outcome.addTagIds).toEqual(['tag-1'])
  })
})

/* -------------------------------------------------------------------------- */
/* run_on                                                                      */
/* -------------------------------------------------------------------------- */

describe('run_on gates the whole rule', () => {
  const importOnly = () =>
    rule({
      id: 'rule-1',
      conditions: EXPENSE,
      actions: [{ kind: 'add_tag', tagId: 'tag-1' }],
      runOn: ['import'],
    })

  it('runs on a listed trigger and not on an unlisted one', () => {
    expect(
      resolveOutcome([importOnly()], subject(), 'import').matchedRuleIds,
    ).toEqual(['rule-1'])
    expect(
      resolveOutcome([importOnly()], subject(), 'manual_create').matchedRuleIds,
    ).toEqual([])
    expect(
      resolveOutcome([importOnly()], subject(), 'edit').matchedRuleIds,
    ).toEqual([])
  })

  it('a rule with an empty run_on is inert on every trigger', () => {
    const inert = rule({
      id: 'rule-1',
      conditions: EXPENSE,
      actions: [{ kind: 'add_tag', tagId: 'tag-1' }],
      runOn: [],
    })
    for (const trigger of ['manual_create', 'import', 'edit'] as const) {
      expect(
        resolveOutcome([inert], subject(), trigger).matchedRuleIds,
      ).toEqual([])
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The money invariant                                                         */
/* -------------------------------------------------------------------------- */

describe('a rule never changes an amount, a currency, a rate or a date', () => {
  /** Every column a rule must not move, read straight off the row. */
  async function moneyColumns(transactionId: string) {
    const rows = await db
      .select({
        amountMinor: transactions.amountMinor,
        currencyCode: transactions.currencyCode,
        refAmountMinor: transactions.refAmountMinor,
        refCurrencyCode: transactions.refCurrencyCode,
        rateE10: transactions.rateE10,
        bookedOn: transactions.bookedOn,
        bookedAt: transactions.bookedAt,
      })
      .from(transactions)
      .where(eq(transactions.id, transactionId))
    return rows[0]
  }

  it('applying all eight action kinds leaves every money column byte-identical', async () => {
    await seedTag('tag-add')
    await seedTag('tag-remove')
    await seedPayee('payee-1')
    await seedTransaction({ id: 'tx-1' })
    await db.insert(transactionTags).values({
      organizationId: 'org-a',
      transactionId: 'tx-1',
      tagId: 'tag-remove',
    })

    const before = await moneyColumns('tx-1')

    // Four actions per rule is the ceiling, so the eight kinds are two rules — which also puts a
    // second rule in the run, and the money claim then covers a cumulative outcome rather than one.
    await seedRule({
      id: 'rule-1',
      position: 0,
      conditions: EXPENSE,
      actions: [
        { kind: 'set_category', categoryId: 'cat-groceries' },
        { kind: 'set_payee', payeeId: 'payee-1' },
        { kind: 'add_tag', tagId: 'tag-add' },
        { kind: 'remove_tag', tagId: 'tag-remove' },
      ],
    })
    await seedRule({
      id: 'rule-2',
      position: 1,
      conditions: EXPENSE,
      actions: [
        { kind: 'set_note', note: 'Groceries, weekly' },
        { kind: 'set_payment_method', paymentMethod: 'card' },
        { kind: 'mark_planned', isPlanned: true },
        { kind: 'set_excluded', excludeFromStats: true },
      ],
    })

    const result = await applyRules(scope, {
      transactionIds: ['tx-1'],
      trigger: 'import',
    })
    expect(result).toMatchObject({ scannedCount: 1, changedCount: 1 })

    // Every action landed…
    const [row] = await db
      .select({
        categoryId: transactions.categoryId,
        payeeId: transactions.payeeId,
        note: transactions.note,
        paymentMethod: transactions.paymentMethod,
        isPlanned: transactions.isPlanned,
        excludeFromStats: transactions.excludeFromStats,
      })
      .from(transactions)
      .where(eq(transactions.id, 'tx-1'))
    expect(row).toEqual({
      categoryId: 'cat-groceries',
      payeeId: 'payee-1',
      note: 'Groceries, weekly',
      paymentMethod: 'card',
      isPlanned: true,
      excludeFromStats: true,
    })

    const tagRows = await db
      .select({ tagId: transactionTags.tagId })
      .from(transactionTags)
      .where(eq(transactionTags.transactionId, 'tx-1'))
    expect(tagRows).toEqual([{ tagId: 'tag-add' }])

    // …and not one money column moved.
    expect(await moneyColumns('tx-1')).toEqual(before)
  })

  it('enqueues no ledger rebuild, because nothing it wrote can move a balance', async () => {
    const touched = new Set<string>()
    await runWithLedgerCollector(touched, async () => {
      await seedTransaction({ id: 'tx-1' })
      await seedRule({
        id: 'rule-1',
        position: 0,
        conditions: EXPENSE,
        actions: [{ kind: 'set_category', categoryId: 'cat-groceries' }],
      })

      await applyRules(scope, { transactionIds: ['tx-1'], trigger: 'import' })
    })

    expect([...touched]).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* The accounting                                                              */
/* -------------------------------------------------------------------------- */

describe('match accounting is one statement per run', () => {
  it('counts every matched transaction but updates the counter once', async () => {
    await seedTag('tag-1')
    await seedTransaction({ id: 'tx-1' })
    await seedTransaction({ id: 'tx-2' })
    await seedTransaction({ id: 'tx-3', note: 'LIDL 88' })
    await seedRule({
      id: 'rule-1',
      position: 0,
      conditions: [
        { field: 'note', operator: 'contains', keywords: ['zabka'] },
      ],
      actions: [{ kind: 'add_tag', tagId: 'tag-1' }],
    })

    executed.length = 0
    const result = await applyRules(scope, {
      transactionIds: ['tx-1', 'tx-2', 'tx-3'],
      trigger: 'import',
    })

    expect(result).toMatchObject({ scannedCount: 3, changedCount: 2 })
    expect(result.matchesByRule.get('rule-1')).toBe(2)

    const [counted] = await db
      .select({
        matchCount: rules.matchCount,
        lastMatchedAt: rules.lastMatchedAt,
      })
      .from(rules)
      .where(eq(rules.id, 'rule-1'))
    expect(counted.matchCount).toBe(2)
    expect(counted.lastMatchedAt).not.toBeNull()

    // Two matched rows, one counter statement. An import of 5 000 rows must not write 5 000.
    const counterUpdates = executed.filter(
      (statement) =>
        statement.includes('update "rules"') &&
        statement.includes('match_count'),
    )
    expect(counterUpdates).toHaveLength(1)
  })

  it('does not touch the counter when nothing matched', async () => {
    await seedTag('tag-1')
    await seedTransaction({ id: 'tx-1', note: 'LIDL 88' })
    await seedRule({
      id: 'rule-1',
      position: 0,
      conditions: [
        { field: 'note', operator: 'contains', keywords: ['zabka'] },
      ],
      actions: [{ kind: 'add_tag', tagId: 'tag-1' }],
    })

    executed.length = 0
    const result = await applyRules(scope, {
      transactionIds: ['tx-1'],
      trigger: 'import',
    })

    expect(result).toMatchObject({ scannedCount: 1, changedCount: 0 })
    expect(
      executed.filter((statement) => statement.includes('update "rules"')),
    ).toHaveLength(0)
  })

  it('an inactive or paused rule is never applied', async () => {
    await seedTag('tag-1')
    await seedTag('tag-2')
    await seedTransaction({ id: 'tx-1' })
    await seedRule({
      id: 'rule-inactive',
      position: 0,
      conditions: EXPENSE,
      actions: [{ kind: 'add_tag', tagId: 'tag-1' }],
      isActive: false,
    })
    await seedRule({
      id: 'rule-paused',
      position: 1,
      conditions: EXPENSE,
      actions: [{ kind: 'add_tag', tagId: 'tag-2' }],
      pausedReason: JSON.stringify({
        kind: 'missing_reference',
        ref_type: 'category',
        ref_id: 'cat-gone',
        label: 'Groceries',
        at: NOW.toISOString(),
      }),
    })

    const result = await applyRules(scope, {
      transactionIds: ['tx-1'],
      trigger: 'import',
    })
    expect(result).toMatchObject({ scannedCount: 1, changedCount: 0 })
    expect(
      await db
        .select({ tagId: transactionTags.tagId })
        .from(transactionTags)
        .where(eq(transactionTags.transactionId, 'tx-1')),
    ).toEqual([])
  })

  it('re-running the same rule over the same transaction changes nothing further', async () => {
    await seedTag('tag-1')
    await seedTransaction({ id: 'tx-1' })
    await seedRule({
      id: 'rule-1',
      position: 0,
      conditions: EXPENSE,
      actions: [{ kind: 'add_tag', tagId: 'tag-1' }],
    })

    const first = await applyRules(scope, {
      transactionIds: ['tx-1'],
      trigger: 'edit',
    })
    const second = await applyRules(scope, {
      transactionIds: ['tx-1'],
      trigger: 'edit',
    })

    expect(first.changedCount).toBe(1)
    // The rule matches again — the counter says so — but the tag is already there, so there is
    // nothing left to write and no duplicate row to collide with.
    expect(second.changedCount).toBe(0)
    expect(
      await db
        .select({ tagId: transactionTags.tagId })
        .from(transactionTags)
        .where(eq(transactionTags.transactionId, 'tx-1')),
    ).toEqual([{ tagId: 'tag-1' }])
  })
})

/* -------------------------------------------------------------------------- */
/* A rule never settles a row dated after the cutoff                           */
/* -------------------------------------------------------------------------- */

/**
 * `mark_planned: false` settles a row, and a settled row may not be dated after the latest calendar
 * day on Earth (`#/server/booking-rule`). A run is not transactional, so the action is dropped
 * rather than thrown: the rest of the rule still applies. `NOW` makes the cutoff day the 16th.
 */
describe('mark_planned: false on a row dated after the cutoff', () => {
  const SETTLE_AND_NOTE = [
    { kind: 'mark_planned', isPlanned: false },
    { kind: 'set_note', note: 'tidied' },
  ]

  it('drops the settle and keeps the other actions of the same rule', () => {
    const settling = rule({
      id: 'rule-1',
      conditions: EXPENSE,
      actions: SETTLE_AND_NOTE,
    })

    const { outcome } = resolveOutcome(
      [settling],
      subject({ bookedOn: '2026-03-17' }),
      'edit',
      NOW,
    )

    expect(outcome.isPlanned).toBeUndefined()
    expect(outcome.note).toBe('tidied')
  })

  it('settles a row dated up to the cutoff day', () => {
    const settling = rule({
      id: 'rule-1',
      conditions: EXPENSE,
      actions: SETTLE_AND_NOTE,
    })

    for (const bookedOn of ['2026-03-10', '2026-03-16']) {
      expect(
        resolveOutcome([settling], subject({ bookedOn }), 'edit', NOW).outcome,
      ).toMatchObject({ isPlanned: false })
    }
  })

  it('still lets a rule keep a future row planned', () => {
    const planning = rule({
      id: 'rule-1',
      conditions: EXPENSE,
      actions: [{ kind: 'mark_planned', isPlanned: true }],
    })

    expect(
      resolveOutcome(
        [planning],
        subject({ bookedOn: '2999-01-01' }),
        'edit',
        NOW,
      ).outcome,
    ).toMatchObject({ isPlanned: true })
  })

  it('leaves a future planned row planned and flips a past one, when run for real', async () => {
    await seedRule({
      id: 'rule-1',
      position: 0,
      conditions: EXPENSE,
      actions: SETTLE_AND_NOTE,
    })
    await seedTransaction({
      id: 'tx-future',
      isPlanned: true,
      bookedOn: '2999-01-01',
    })
    await seedTransaction({
      id: 'tx-past',
      isPlanned: true,
      bookedOn: '2026-03-10',
    })

    await applyRules(scope, {
      transactionIds: ['tx-future', 'tx-past'],
      trigger: 'edit',
    })

    const rows = await db
      .select({
        id: transactions.id,
        isPlanned: transactions.isPlanned,
        note: transactions.note,
      })
      .from(transactions)
    expect(rows.find((row) => row.id === 'tx-future')).toMatchObject({
      isPlanned: true,
      note: 'tidied',
    })
    expect(rows.find((row) => row.id === 'tx-past')).toMatchObject({
      isPlanned: false,
      note: 'tidied',
    })
  })
})
