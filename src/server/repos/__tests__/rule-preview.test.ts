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

import { tags, transactionTags, transactions } from '#/server/db/schema'
import { applyRules } from '#/server/rules/apply'
import { evaluateRule } from '#/server/rules/evaluate'

import {
  NOW,
  createBudgetWorld,
  executed,
  seedCategory,
  seedTransaction,
} from './budget-harness'
import { setLimitResolver } from '../base'
import { createRule } from '../rules'
import {
  IDS_PER_STATEMENT,
  RULE_PREVIEW_SCAN_LIMIT,
  idChunks,
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

/* -------------------------------------------------------------------------- */
/* D1's bound-parameter ceiling                                               */
/* -------------------------------------------------------------------------- */

/**
 * **What this suite cannot do, stated before what it can.**
 *
 * The defect these tests were written for is D1 refusing a statement with more than 100 bound
 * parameters. It cannot be reproduced here and it never will be: this suite runs against a real
 * SQLite, whose own ceiling is `SQLITE_MAX_VARIABLE_NUMBER` — 999 by default, ten times the budget
 * the production engine allows. Remove the chunking from `loadRulePreviewTargets`, run the whole
 * file, and every test below still passes. The green is a fact about the substitute engine, not
 * about the code.
 *
 * That is worth naming rather than working around, because the usual repair for a test that passes
 * either way — pick better data — does not apply. No ledger size makes SQLite refuse what D1
 * refuses. Mutation testing, which is how a decorative assertion is normally caught, is silent
 * here.
 *
 * So the boundary is asserted where it *is* reachable, on the derivation itself, and the ledger
 * test below guards the other half: that chunking a list does not lose or duplicate a row. Between
 * them they catch a wrong chunk size and a wrong fold. Neither catches a chunk size that is right
 * arithmetically and wrong about D1 — only `docs/ARCHITECTURE.md` §4.3 and a real deployment do.
 */
describe('the chunk size is derived, and the fold survives it', () => {
  it('leaves a statement inside D1’s ceiling, with room for the tenant predicate', () => {
    // 100 is written as a literal on purpose. Asserting the chunk size against the constant that
    // produced it is self-referential — it passes for every value of that constant, including a
    // wrong one, which is how the first draft of this test managed to survive its own mutation.
    // The number that has to be pinned is the external one, so the external one is what is here.
    expect(IDS_PER_STATEMENT).toBeLessThanOrEqual(100 - 1)
    expect(IDS_PER_STATEMENT).toBeGreaterThan(0)
  })

  it('never yields a run larger than that', () => {
    const ids = Array.from({ length: 250 }, (_, index) => `tx-${index}`)

    for (const chunk of idChunks(ids)) {
      expect(chunk.length).toBeLessThanOrEqual(IDS_PER_STATEMENT)
      expect(chunk.length).toBeGreaterThan(0)
    }
  })

  it('is a partition: every id once, in order, nothing invented', () => {
    const ids = Array.from({ length: 250 }, (_, index) => `tx-${index}`)

    expect(idChunks(ids).flat()).toEqual(ids)
  })

  it('asks for nothing at all when there is nothing to ask about', () => {
    expect(idChunks([])).toEqual([])
  })

  it('reads every row’s tags when the window spans several statements', async () => {
    const count = IDS_PER_STATEMENT * 2 + 5
    await seedLedger(count)
    await db.insert(tags).values({
      id: 'tag-a',
      organizationId: 'org-a',
      name: 'Holiday',
      createdAt: NOW,
      updatedAt: NOW,
    })

    // One tagged row inside each chunk, including the short last one. The ledger reads newest
    // first, so these indices are positions in the *seeded* order and land in different statements
    // by construction rather than by luck.
    const tagged = [0, IDS_PER_STATEMENT, count - 1].map(
      (index) => `org-a-tx-${String(index).padStart(3, '0')}`,
    )
    await db.insert(transactionTags).values(
      tagged.map((transactionId) => ({
        organizationId: 'org-a',
        transactionId,
        tagId: 'tag-a',
      })),
    )

    const targets = await loadRulePreviewTargets(scope, RULE_PREVIEW_SCAN_LIMIT)

    expect(targets).toHaveLength(count)
    const carrying = targets
      .filter((target) => target.tagIds.includes('tag-a'))
      .map((target) => target.transactionId)
    expect(carrying.sort()).toEqual([...tagged].sort())
  })
})

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
