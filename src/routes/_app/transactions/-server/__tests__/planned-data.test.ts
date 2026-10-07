/**
 * The planned screen's composition, against a real SQLite built from `drizzle/*.sql`.
 *
 * What is under test is `plannedScreenFor`, not `loadPlannedScreen`: a `createServerFn` value is
 * only callable inside the Start request context, so a test of the wrapper is a test of TanStack.
 * The ledger half is the real repository calls through `ledgerReaderFor`; the expected half is the
 * real `getUpcoming`. The composition between them is the code the rules below are about.
 *
 * The rules, stated once:
 *
 * 1. **The group is a read, never a write.** No statement the composition runs inserts, updates or
 *    deletes anything, and none of the writers of `recurring_periods` is reachable from it.
 * 2. **The group does not depend on the ledger's order or page.** It is ordered by due date and is
 *    identical under all four sort fields, both directions and every cursor.
 * 3. **Filters either narrow the group or hide it**, never silently ignored: five of them hide it,
 *    and each is asserted here.
 * 4. **A failing expected read does not take the ledger down with it**, and is logged, not
 *    swallowed.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLogger, createMemorySink } from '#/server/observability/logger'
import { LEDGER_SORT_FIELDS } from '#/components/app/transactions/types'
import {
  executed,
  createBudgetWorld,
  seedCategory,
  seedTransaction,
} from '#/server/repos/__tests__/budget-harness'
import {
  ledgerReaderFor,
  seedSeries,
} from '#/server/repos/__tests__/planned-harness'

import { plannedScreenFor } from '../planned-data'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'
import type * as RecurringModule from '#/server/repos/recurring'
import type { TransactionFilters } from '#/server/repos/transaction-queries'
import type { PlannedScreenInput } from '../planned-data'

// `getUpcoming` stays the real one except in the one case that needs it to fail.
const failing = vi.hoisted(() => ({ next: false }))
vi.mock('#/server/repos/recurring', async (importOriginal) => {
  const actual = await importOriginal<typeof RecurringModule>()
  return {
    ...actual,
    getUpcoming: (...args: Parameters<typeof actual.getUpcoming>) => {
      if (failing.next) {
        failing.next = false
        return Promise.reject(new Error('d1 is unavailable'))
      }
      return actual.getUpcoming(...args)
    },
  }
})

const TODAY = '2026-04-15'

const PLANNED_POLICIES: PlannedScreenInput['policies'] = {
  planned: 'only',
  adjustments: 'exclude',
  transfers: 'include',
  completeness: 'any',
}

function input(over: Partial<PlannedScreenInput> = {}): PlannedScreenInput {
  return {
    policies: PLANNED_POLICIES,
    filters: {},
    sort: { field: 'bookedOn', direction: 'desc' },
    cursor: null,
    ...over,
  }
}

let world: BudgetWorld
const sink = createMemorySink()
const logger = createLogger({ sink, level: 'debug' })

function compose(over: Partial<PlannedScreenInput> = {}, today = TODAY) {
  return plannedScreenFor(world.scope, input(over), today, {
    readLedger: ledgerReaderFor(world.scope),
    logger,
  })
}

async function shown(over: Partial<PlannedScreenInput> = {}) {
  const page = await compose(over)
  if (page.expectations.state !== 'shown') {
    throw new Error(`expected a shown group, got ${page.expectations.state}`)
  }
  return page.expectations
}

beforeEach(async () => {
  world = await createBudgetWorld()
  sink.records.length = 0
  failing.next = false
})

describe('what the group holds', () => {
  it('lists an unsettled period due inside the window and returns the day it read', async () => {
    await seedSeries(world.scope, TODAY, { name: 'Rent' })

    const page = await compose()

    expect(page.today).toBe(TODAY)
    expect(page.expectations).toMatchObject({
      state: 'shown',
      withinDays: 30,
      limit: 50,
      isCapped: false,
    })
    const group = await shown()
    expect(group.rows.map((row) => [row.seriesName, row.dueOn])).toEqual([
      ['Rent', '2026-04-10'],
      ['Rent', '2026-05-10'],
    ])
  })

  it('leaves out a period due beyond 30 days and keeps an overdue one however old', async () => {
    await seedSeries(world.scope, TODAY, { startDate: '2025-01-10' })

    const group = await shown()

    const due = group.rows.map((row) => row.dueOn)
    expect(due).toContain('2025-01-10')
    expect(due).toContain('2026-05-10')
    expect(due).not.toContain('2026-06-10')
    expect(group.rows.find((row) => row.dueOn === '2025-01-10')?.status).toBe(
      'overdue',
    )
  })

  it('carries no reference amount, rate or converted figure on any row', async () => {
    await seedSeries(world.scope, TODAY, { expectedCurrencyCode: 'EUR' })

    const group = await shown()

    expect(group.rows.length).toBeGreaterThan(0)
    for (const row of group.rows) {
      expect(row.currencyCode).toBe('EUR')
      expect(Object.keys(row)).not.toContain('refAmountMinor')
      expect(Object.keys(row)).not.toContain('rateE10')
      expect(Number.isInteger(row.expectedAmountMinor)).toBe(true)
    }
  })

  it('is ordered by due date, soonest first, across series', async () => {
    await seedSeries(world.scope, TODAY, { name: 'B', startDate: '2026-04-20' })
    await seedSeries(world.scope, TODAY, { name: 'A', startDate: '2026-04-05' })

    const group = await shown()

    const due = group.rows.map((row) => row.dueOn)
    expect(due).toEqual([...due].sort())
  })

  it('shows the 50 nearest and says it was capped', async () => {
    // Weekly since mid-2025: about 45 overdue periods per series, so two series overflow the cap.
    await seedSeries(world.scope, TODAY, {
      name: 'Weekly one',
      frequency: 'weekly',
      startDate: '2025-06-01',
    })
    await seedSeries(world.scope, TODAY, {
      name: 'Weekly two',
      frequency: 'weekly',
      startDate: '2025-06-02',
    })

    const group = await shown()

    expect(group.rows).toHaveLength(50)
    expect(group.isCapped).toBe(true)
    const due = group.rows.map((row) => row.dueOn)
    expect(due).toEqual([...due].sort())
  })
})

describe('what the group does not depend on', () => {
  it('is identical under all four sort fields, both directions', async () => {
    await seedSeries(world.scope, TODAY, { name: 'Rent' })
    await seedSeries(world.scope, TODAY, {
      name: 'Gym',
      startDate: '2026-04-20',
    })
    const reference = JSON.stringify((await compose()).expectations)

    for (const field of LEDGER_SORT_FIELDS) {
      for (const direction of ['asc', 'desc'] as const) {
        const page = await compose({ sort: { field, direction } })
        expect(JSON.stringify(page.expectations)).toBe(reference)
      }
    }
  })

  it('is the same on page two as on page one', async () => {
    await seedSeries(world.scope, TODAY, { name: 'Rent' })
    await seedTransaction(world.db, {
      id: 'plan-1',
      refAmountMinor: 100_00,
      bookedOn: '2026-04-20',
      isPlanned: true,
    })
    await seedTransaction(world.db, {
      id: 'plan-2',
      refAmountMinor: 200_00,
      bookedOn: '2026-04-21',
      isPlanned: true,
    })

    const first = await compose({ limit: 1 })
    expect(first.nextCursor).not.toBeNull()
    const second = await compose({ limit: 1, cursor: first.nextCursor })

    expect(second.rows.map((row) => row.id)).not.toEqual(
      first.rows.map((row) => row.id),
    )
    expect(second.expectations).toEqual(first.expectations)
  })
})

describe('the ledger half is passed through untouched', () => {
  it('returns the page, the count and the totals the ledger reader returned', async () => {
    await seedTransaction(world.db, {
      id: 'plan-1',
      refAmountMinor: 100_00,
      bookedOn: '2026-04-20',
      isPlanned: true,
    })
    const reader = ledgerReaderFor(world.scope)
    const direct = await reader(input())

    const composed = await compose()

    const { today: _today, expectations: _expectations, ...ledger } = composed
    expect(ledger).toEqual(direct)
  })

  it('rejects when the ledger read rejects, so the ordinary error path applies', async () => {
    await expect(
      plannedScreenFor(world.scope, input(), TODAY, {
        readLedger: () => Promise.reject(new Error('ledger failed')),
        logger,
      }),
    ).rejects.toThrow('ledger failed')
  })
})

describe('the filters', () => {
  beforeEach(async () => {
    await seedCategory(world.db, { id: 'cat-parent', name: 'Home' })
    await seedCategory(world.db, {
      id: 'cat-child',
      name: 'Rent',
      parentId: 'cat-parent',
    })
    await seedSeries(world.scope, TODAY, {
      name: 'Rent',
      categoryId: 'cat-child',
      accountId: 'acc-a',
    })
    await seedSeries(world.scope, TODAY, {
      name: 'Salary',
      direction: 'income',
      startDate: '2026-04-25',
      accountId: 'acc-a-hidden',
    })
  })

  async function names(over: Partial<PlannedScreenInput>) {
    return [...new Set((await shown(over)).rows.map((row) => row.seriesName))]
  }

  it('narrows by text, direction and account', async () => {
    expect(await names({ filters: { text: 'sal' } })).toEqual(['Salary'])
    expect(await names({ filters: { direction: 'expense' } })).toEqual(['Rent'])
    expect(await names({ filters: { accountIds: ['acc-a-hidden'] } })).toEqual([
      'Salary',
    ])
  })

  it('reads from and to against the due date', async () => {
    expect(await names({ filters: { from: '2026-04-20' } })).toEqual([
      'Salary',
      'Rent',
    ])
    expect(await names({ filters: { to: '2026-04-12' } })).toEqual(['Rent'])
  })

  it('matches a series on a child category when the parent is named, through the scoped read', async () => {
    expect(await names({ filters: { categoryIds: ['cat-parent'] } })).toEqual([
      'Rent',
    ])
    expect(await names({ filters: { categoryIds: ['cat-child'] } })).toEqual([
      'Rent',
    ])
  })

  it('never matches a series with no payee against a payee filter', async () => {
    const group = await shown({ filters: { payeeIds: ['payee-x'] } })
    expect(group.rows).toEqual([])
  })

  it('applies the amount window only to a row in the currency the window names', async () => {
    expect(
      await names({
        filters: { amount: { currencyCode: 'PLN', minMinor: 200_000 } },
      }),
    ).toEqual(['Rent', 'Salary'])
    expect(
      await names({
        filters: { amount: { currencyCode: 'EUR', minMinor: 1 } },
      }),
    ).toEqual([])
  })

  it.each([
    ['an account group', { accountGroupIds: ['grp-1'] }],
    ['a tag', { tagIds: ['tag-1'] }],
    ['a payment method', { paymentMethods: ['card'] }],
    ['an attachment', { hasAttachment: true }],
    ['a transfer kind', { transferKinds: ['internal'] }],
  ] satisfies Array<[string, TransactionFilters]>)(
    'suppresses the group under %s',
    async (_label, filters) => {
      const page = await compose({ filters })

      expect(page.expectations).toEqual({ state: 'suppressed' })
    },
  )

  it('keeps the capped flag when a narrowing leaves nothing of a capped group', async () => {
    await seedSeries(world.scope, TODAY, {
      name: 'Weekly',
      frequency: 'weekly',
      startDate: '2025-04-01',
    })
    await seedSeries(world.scope, TODAY, {
      name: 'Weekly two',
      frequency: 'weekly',
      startDate: '2025-04-02',
    })

    const group = await shown({ filters: { text: 'no such series' } })

    expect(group.rows).toEqual([])
    expect(group.isCapped).toBe(true)
  })
})

describe('when the expected read fails', () => {
  it('still returns the ledger, marks the group failed and logs the error', async () => {
    await seedTransaction(world.db, {
      id: 'plan-1',
      refAmountMinor: 100_00,
      bookedOn: '2026-04-20',
      isPlanned: true,
    })
    failing.next = true

    const page = await compose()

    expect(page.expectations).toEqual({ state: 'failed' })
    expect(page.rows.map((row) => row.id)).toEqual(['plan-1'])
    const logged = sink.records.find((record) => record.level === 'error')
    expect(logged).toMatchObject({
      errorMessage: 'd1 is unavailable',
      orgId: 'org-a',
    })
  })
})

describe('what the composition never does', () => {
  it('runs no write statement', async () => {
    await seedSeries(world.scope, TODAY)
    executed.length = 0

    await compose()

    const writes = executed.filter((query) =>
      /^\s*(insert|update|delete|replace)\b/i.test(query),
    )
    expect(writes).toEqual([])
    expect(executed.length).toBeGreaterThan(0)
  })

  it('imports no SQL layer and reaches no writer, by reading its own source', () => {
    const here = fileURLToPath(new URL('..', import.meta.url))
    const sources = ['planned-data.ts', 'planned.ts']
      .map((file) => readFileSync(path.join(here, file), 'utf8'))
      .join('\n')

    expect(sources).not.toMatch(/drizzle-orm/)
    expect(sources).not.toMatch(/#\/server\/db\/schema/)
    for (const writer of [
      'materializeSeries',
      'markPaid',
      'markSkipped',
      'revertPeriod',
      'runWithLedgerBatch',
    ]) {
      expect(sources).not.toContain(writer)
    }
    // Exactly one scope is established per call, in the server function and nowhere else.
    expect(sources.match(/requireOrg\(/g)).toHaveLength(1)
  })
})
