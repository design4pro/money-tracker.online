/**
 * The preview's window, its tenant boundary, and the one property the whole feature rests on:
 * **a preview and a run agree**.
 *
 * A real SQLite built from `drizzle/*.sql`, two workspaces — **A**, who acts, and **B**, whose rows
 * must be unreachable — exactly as `rules.test.ts` sets them up.
 *
 * The isolation block lives here rather than in `tenant-isolation.test.ts` for the reason `14-S1`
 * recorded in that file: the shared suite is being written by several agents in one tree this week,
 * and this covers the same ground function by function, ready to be folded in unchanged. The
 * function the plan names is `previewRule`; a `createServerFn` handler cannot be called without a
 * request, so what is exercised is exactly what that handler composes and nothing else —
 * `loadRulePreviewTargets` under a scope, then `evaluateRule` over what it returned.
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { transactions } from '#/server/db/schema'
import { applyRules } from '#/server/rules/apply'
import { evaluateRule } from '#/server/rules/evaluate'

import {
  createBudgetWorld,
  executed,
  seedCategory,
  seedTransaction,
} from './budget-harness'
import { setLedgerTouchSink, setLimitResolver } from '../base'
import { createRule } from '../rules'
import {
  RULE_PREVIEW_SCAN_LIMIT,
  loadRulePreviewTargets,
} from '../rule-preview'

import type { BudgetWorld, TestDb } from './budget-harness'
import type { TenantScope } from '../base'
import type { EvaluableRule } from '#/server/rules/evaluate'

let world: BudgetWorld
let db: TestDb
let scope: TenantScope
let otherScope: TenantScope

beforeEach(async () => {
  world = await createBudgetWorld()
  db = world.db
  scope = world.scope
  otherScope = world.otherScope
  setLimitResolver(null)
  setLedgerTouchSink(null)
  await seedCategory(db, { id: 'cat-groceries', name: 'Groceries' })
})

/** `n` transactions, alternating amounts around the 50,00 zł the rule cares about. */
async function seedLedger(count: number, organizationId = 'org-a') {
  for (let index = 0; index < count; index += 1) {
    await seedTransaction(db, {
      id: `${organizationId}-tx-${String(index).padStart(3, '0')}`,
      organizationId,
      accountId: organizationId === 'org-a' ? 'acc-a' : 'acc-b',
      refAmountMinor: 1_000 + index * 100,
      bookedOn: `2026-03-${String((index % 28) + 1).padStart(2, '0')}`,
    })
  }
}

const AMOUNT_RULE: EvaluableRule = {
  matchMode: 'all',
  conditions: [
    {
      field: 'amount',
      operator: 'gte',
      amountMinor: 5_000,
      currencyCode: 'PLN',
    },
  ],
}

describe('the window the preview reads', () => {
  it('reads at most the cap, newest first', async () => {
    await seedLedger(30)
    const targets = await loadRulePreviewTargets(scope, 10)

    expect(targets).toHaveLength(10)
    // Newest first, and total: `booked_on` descending with `id` descending behind it, so an
    // unchanged ledger previews the same rows twice running.
    const ordered = [...targets].sort((a, b) =>
      a.bookedOn === b.bookedOn
        ? b.transactionId.localeCompare(a.transactionId)
        : b.bookedOn.localeCompare(a.bookedOn),
    )
    expect(targets.map((row) => row.transactionId)).toEqual(
      ordered.map((row) => row.transactionId),
    )
  })

  it('reports the rows it actually read, not the cap', async () => {
    await seedLedger(7)
    const targets = await loadRulePreviewTargets(scope)
    expect(targets).toHaveLength(7)
    expect(RULE_PREVIEW_SCAN_LIMIT).toBe(2_000)
  })

  it('refuses a limit above the cap rather than silently clamping it', async () => {
    await expect(
      loadRulePreviewTargets(scope, RULE_PREVIEW_SCAN_LIMIT + 1),
    ).rejects.toThrow()
  })
})

describe('a preview and a run agree', () => {
  /**
   * The property the feature rests on, over 200 rows.
   *
   * The ids the preview reports matching are compared with the ids the engine actually wrote to —
   * read back out of `transactions`, not out of a count — because a preview that used different
   * arithmetic from the engine would be worse than no preview: the person trusts it.
   *
   * The run is chunked at `MAX_SUBJECTS_PER_RUN` because an apply addresses rows by id and D1
   * bounds the parameter list. The preview has no such ceiling, which is the whole reason it reads
   * through a different query.
   */
  it('matches exactly the transactions the engine writes to', async () => {
    await seedLedger(200)
    await createRule(scope, {
      name: 'Big spends',
      matchMode: 'all',
      conditions: [
        {
          field: 'amount',
          operator: 'gte',
          amountMinor: 5_000,
          currencyCode: 'PLN',
        },
      ],
      actions: [{ kind: 'set_category', categoryId: 'cat-groceries' }],
      runOn: ['import'],
    })

    const targets = await loadRulePreviewTargets(scope)
    const previewed = new Set(
      targets
        .filter((target) => evaluateRule(AMOUNT_RULE, target))
        .map((target) => target.transactionId),
    )

    const allIds = targets.map((target) => target.transactionId)
    for (let at = 0; at < allIds.length; at += 96) {
      await applyRules(scope, {
        transactionIds: allIds.slice(at, at + 96),
        trigger: 'import',
      })
    }

    const written = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.categoryId, 'cat-groceries'))

    expect(previewed.size).toBeGreaterThan(0)
    expect([...previewed].toSorted()).toEqual(
      written.map((row) => row.id).toSorted(),
    )
  })
})

describe('tenant isolation', () => {
  beforeEach(async () => {
    await seedLedger(5, 'org-a')
    await seedLedger(5, 'org-b')
  })

  it('A’s preview reads none of B’s transactions', async () => {
    const targets = await loadRulePreviewTargets(scope)
    expect(targets).toHaveLength(5)
    expect(
      targets.every((target) => target.transactionId.startsWith('org-a-')),
    ).toBe(true)
  })

  it('a rule naming B’s account matches nothing in A’s scope', async () => {
    const foreign: EvaluableRule = {
      matchMode: 'all',
      conditions: [{ field: 'account', operator: 'is_any_of', ids: ['acc-b'] }],
    }
    const targets = await loadRulePreviewTargets(scope)
    const matched = targets.filter((target) => evaluateRule(foreign, target))

    expect(targets).toHaveLength(5)
    expect(matched).toHaveLength(0)
  })

  it('every statement the preview issues carries the tenant predicate', async () => {
    executed.length = 0
    await loadRulePreviewTargets(scope)

    // Three queries for any number of rows — the transactions, the accounts' groups, the rows'
    // tags — and each one filtered. A count rather than a wall-clock bound: the property is
    // "constant in the number of rows", and only a count can state that.
    expect(executed).toHaveLength(3)
    expect(
      executed.every((statement) => statement.includes('organization_id')),
    ).toBe(true)
  })

  it('B sees only B’s rows through the same function', async () => {
    const targets = await loadRulePreviewTargets(otherScope)
    expect(
      targets.every((target) => target.transactionId.startsWith('org-b-')),
    ).toBe(true)
  })
})
