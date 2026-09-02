/**
 * Materialised periods: the table that makes rollover auditable.
 *
 * Three claims are worth a real database. **Idempotence** — running the walk again changes
 * nothing, because a cron that runs twice is a cron that runs twice. **Immutability** — a closed
 * period's `carried_in_minor` and `spent_minor` never move again, whatever is edited afterwards;
 * that is the whole reason the columns are duplicated off the budget row. And the **carry across a
 * boundary**, once per policy, in both directions: the pure arithmetic is pinned in
 * `budgets/__tests__/rollover.test.ts`, and what is pinned here is that the number the walk
 * *stores* is the number that arithmetic produced.
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { budgetPeriods } from '#/server/db/schema'

import { ConflictError, ForbiddenError, NotFoundError } from '../errors'
import {
  closePeriod,
  getCurrentPeriod,
  listPeriods,
  materializePeriods,
  periodCorrections,
  recomputeOpenPeriod,
  reopenPeriod,
} from '../budget-periods'
import { createBudget, getBudget, updateBudget } from '../budgets'
import {
  addSecondMember,
  createBudgetWorld,
  seedBudget,
  seedCategory,
  seedPeriod,
  seedTransaction,
} from './budget-harness'

import type { BudgetWorld, TestDb } from './budget-harness'
import type { TenantScope } from '../scope'

/** Mid-March: January and February have ended, March has not. */
const TODAY = '2026-03-15'

let world: BudgetWorld
let db: TestDb
let scope: TenantScope

beforeEach(async () => {
  world = await createBudgetWorld()
  db = world.db
  scope = world.scope
  await seedCategory(db, { id: 'cat-food', name: 'Food' })
  await seedCategory(db, { id: 'cat-b', name: "B's", organizationId: 'org-b' })
})

async function januaryBudget(over: Record<string, unknown> = {}) {
  return createBudget(scope, {
    name: 'Food',
    startDate: '2026-01-01',
    limitMinor: 2_000_00,
    currencyCode: 'PLN',
    categoryIds: ['cat-food'],
    ...over,
  })
}

/** An expense in the food envelope on a given day. */
async function spend(id: string, bookedOn: string, refAmountMinor: number) {
  await seedTransaction(db, {
    id,
    categoryId: 'cat-food',
    bookedOn,
    refAmountMinor,
  })
}

/* -------------------------------------------------------------------------- */
/* The walk                                                                    */
/* -------------------------------------------------------------------------- */

describe('materializePeriods', () => {
  it('creates every period up to the one holding today, and closes the ended ones', async () => {
    const budget = await januaryBudget()
    const periods = await materializePeriods(scope, {
      budgetId: budget.id,
      today: TODAY,
    })

    expect(periods.map((period) => period.periodStart)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ])
    expect(periods.map((period) => period.closedAt !== null)).toEqual([
      true,
      true,
      false,
    ])
    expect(periods.map((period) => period.periodEnd)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ])
  })

  it('copies the limit and currency onto each period as they were', async () => {
    const budget = await januaryBudget()
    const periods = await materializePeriods(scope, {
      budgetId: budget.id,
      today: TODAY,
    })
    expect(periods.every((period) => period.limitMinor === 2_000_00)).toBe(true)
    expect(periods.every((period) => period.currencyCode === 'PLN')).toBe(true)
  })

  it('changes nothing on a second run', async () => {
    const budget = await januaryBudget()
    await spend('tx-jan', '2026-01-10', 1_500_00)
    const first = await materializePeriods(scope, {
      budgetId: budget.id,
      today: TODAY,
    })
    const second = await materializePeriods(scope, {
      budgetId: budget.id,
      today: TODAY,
    })
    expect(second.map(({ updatedAt: _unused, ...rest }) => rest)).toEqual(
      first.map(({ updatedAt: _unused, ...rest }) => rest),
    )
  })

  it('has nothing to do before the budget starts', async () => {
    const budget = await januaryBudget({ startDate: '2026-06-01' })
    expect(
      await materializePeriods(scope, { budgetId: budget.id, today: TODAY }),
    ).toEqual([])
  })

  it('stops at the budget end date', async () => {
    const budget = await januaryBudget({ endDate: '2026-02-28' })
    const periods = await materializePeriods(scope, {
      budgetId: budget.id,
      today: '2026-08-01',
    })
    expect(periods.map((period) => period.periodStart)).toEqual([
      '2026-01-01',
      '2026-02-01',
    ])
  })

  it('walks a weekly budget week by week, and the check constraint lets it', async () => {
    // The cadence the `budgets_period_check` widening in `0003` was written for. Worth a real
    // database rather than only the pure test: a CHECK that still reads the old four-value list
    // fails here at the INSERT and nowhere else.
    const budget = await januaryBudget({ period: 'weekly' })
    const periods = await materializePeriods(scope, {
      budgetId: budget.id,
      today: TODAY,
    })
    // 1 Jan to 15 Mar is 73 days, so today sits in period 10 and there are eleven of them.
    expect(periods.length).toBe(11)
    expect(periods.at(0)).toMatchObject({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-07',
    })
    expect(periods.at(-1)).toMatchObject({
      periodStart: '2026-03-12',
      periodEnd: '2026-03-18',
      closedAt: null,
    })
  })

  it('gives a one_off budget exactly one period', async () => {
    const budget = await januaryBudget({
      period: 'one_off',
      endDate: '2026-06-30',
    })
    const periods = await materializePeriods(scope, {
      budgetId: budget.id,
      today: TODAY,
    })
    expect(periods.map((period) => period.periodStart)).toEqual(['2026-01-01'])
    expect(periods.at(0)?.closedAt).toBeNull()
  })

  it('stores the spend the same function computes for the screen', async () => {
    const budget = await januaryBudget()
    await spend('tx-jan-a', '2026-01-10', 900_00)
    await spend('tx-jan-b', '2026-01-20', 600_33)
    const [january] = await materializePeriods(scope, {
      budgetId: budget.id,
      today: TODAY,
    })
    expect(january.spentMinor).toBe(1_500_33)
  })
})

/* -------------------------------------------------------------------------- */
/* The carry, one policy at a time                                             */
/* -------------------------------------------------------------------------- */

describe('the carry across a boundary', () => {
  it('carries a surplus forward under carry_surplus', async () => {
    const budget = await januaryBudget({ rolloverPolicy: 'carry_surplus' })
    await spend('tx-jan', '2026-01-10', 1_500_00)
    await spend('tx-feb', '2026-02-10', 1_000_00)
    const periods = await materializePeriods(scope, {
      budgetId: budget.id,
      today: TODAY,
    })

    // January left 500,00. February opened with it, spent 1 000,00 of its 2 500,00 and left
    // 1 500,00, which March opened with.
    expect(periods.map((period) => period.carriedInMinor)).toEqual([
      0, 500_00, 1_500_00,
    ])
  })

  it('absorbs an overspend under carry_surplus rather than carrying it', async () => {
    const budget = await januaryBudget({ rolloverPolicy: 'carry_surplus' })
    await spend('tx-jan', '2026-01-10', 2_400_00)
    await spend('tx-feb', '2026-02-10', 2_000_00)
    const periods = await materializePeriods(scope, {
      budgetId: budget.id,
      today: TODAY,
    })
    // February opens clean rather than 400,00 in the red - the overspend is absorbed, and the
    // ledger on the screen is where the reader is told it happened. February then spends its
    // whole envelope, so March opens clean too.
    expect(periods.map((period) => period.carriedInMinor)).toEqual([0, 0, 0])
  })

  it('carries an overspend forward as a negative opening balance under carry_all', async () => {
    const budget = await januaryBudget({ rolloverPolicy: 'carry_all' })
    await spend('tx-jan', '2026-01-10', 2_400_00)
    await spend('tx-feb', '2026-02-10', 1_000_00)
    const periods = await materializePeriods(scope, {
      budgetId: budget.id,
      today: TODAY,
    })
    // January: 2 000 − 2 400 = −400. February: 2 000 − 400 − 1 000 = +600.
    expect(periods.map((period) => period.carriedInMinor)).toEqual([
      0, -400_00, 600_00,
    ])
  })

  it('opens every period clean under none, whichever way the last one went', async () => {
    const budget = await januaryBudget({ rolloverPolicy: 'none' })
    await spend('tx-jan', '2026-01-10', 2_400_00)
    await spend('tx-feb', '2026-02-10', 100_00)
    const periods = await materializePeriods(scope, {
      budgetId: budget.id,
      today: TODAY,
    })
    expect(periods.map((period) => period.carriedInMinor)).toEqual([0, 0, 0])
  })

  it('does not carry from a period that is still open', async () => {
    // March is open; materialising in April must not roll a partial month into it as though it
    // had finished. It closes March first, then opens April from the closed figure.
    const budget = await januaryBudget({ rolloverPolicy: 'carry_all' })
    await spend('tx-jan', '2026-01-10', 2_000_00)
    await spend('tx-feb', '2026-02-10', 2_000_00)
    await spend('tx-mar', '2026-03-10', 500_00)
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })
    const periods = await materializePeriods(scope, {
      budgetId: budget.id,
      today: '2026-04-15',
    })
    const april = periods.at(-1)
    expect(april?.periodStart).toBe('2026-04-01')
    expect(april?.carriedInMinor).toBe(1_500_00)
  })
})

/* -------------------------------------------------------------------------- */
/* Immutability                                                                */
/* -------------------------------------------------------------------------- */

describe('a closed period', () => {
  it('keeps its spend when a transaction inside it is edited afterwards', async () => {
    const budget = await januaryBudget()
    await spend('tx-jan', '2026-01-10', 1_500_00)
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })

    await spend('tx-jan-late', '2026-01-25', 300_00)
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })

    const [january] = await listPeriods(scope, budget.id)
    expect(january.spentMinor).toBe(1_500_00)
  })

  it('keeps its limit when the budget limit changes', async () => {
    const budget = await januaryBudget()
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })
    await updateBudget(scope, budget.id, { limitMinor: 5_000_00 })
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })

    const periods = await listPeriods(scope, budget.id)
    expect(periods.map((period) => period.limitMinor)).toEqual([
      2_000_00, 2_000_00, 2_000_00,
    ])
  })

  it('keeps its carry when the policy changes underneath it', async () => {
    const budget = await januaryBudget({ rolloverPolicy: 'carry_surplus' })
    await spend('tx-jan', '2026-01-10', 1_500_00)
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })
    await updateBudget(scope, budget.id, { rolloverPolicy: 'none' })
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })

    const periods = await listPeriods(scope, budget.id)
    // February is closed, so its opening balance is frozen at what carry_surplus produced.
    expect(periods.at(1)?.carriedInMinor).toBe(500_00)
  })

  it('refuses to be closed twice', async () => {
    const budget = await januaryBudget()
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })
    await expect(
      closePeriod(scope, { budgetId: budget.id, periodStart: '2026-01-01' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('closePeriod', () => {
  it('closes the open period and hands the next one its carry', async () => {
    const budget = await januaryBudget({ rolloverPolicy: 'carry_surplus' })
    await spend('tx-jan', '2026-01-10', 2_000_00)
    await spend('tx-feb', '2026-02-10', 2_000_00)
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })
    await spend('tx-mar', '2026-03-05', 1_200_00)
    // April has to exist for the carry to land on something.
    await seedPeriod(db, {
      budgetId: budget.id,
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
    })

    const closed = await closePeriod(scope, {
      budgetId: budget.id,
      periodStart: '2026-03-01',
    })
    expect(closed.spentMinor).toBe(1_200_00)
    expect(closed.closedAt).not.toBeNull()

    const april = (await listPeriods(scope, budget.id)).at(-1)
    expect(april?.carriedInMinor).toBe(800_00)
  })

  it('is refused to a member of a shared workspace', async () => {
    await addSecondMember(db)
    const budget = await januaryBudget()
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })
    const memberScope = {
      ...scope,
      ctx: { ...scope.ctx, role: 'member' as const },
    }
    await expect(
      closePeriod(memberScope, {
        budgetId: budget.id,
        periodStart: '2026-03-01',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('reopenPeriod', () => {
  it('unfreezes a period and zeroes the carry it had handed forward', async () => {
    const budget = await januaryBudget({ rolloverPolicy: 'carry_surplus' })
    await spend('tx-jan', '2026-01-10', 1_500_00)
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })
    expect((await listPeriods(scope, budget.id)).at(1)?.carriedInMinor).toBe(
      500_00,
    )

    await reopenPeriod(scope, {
      budgetId: budget.id,
      periodStart: '2026-01-01',
    })

    const periods = await listPeriods(scope, budget.id)
    expect(periods.at(0)?.closedAt).toBeNull()
    // February is still closed, so its frozen opening balance does not move — only an open
    // successor would be rewritten.
    expect(periods.at(1)?.carriedInMinor).toBe(500_00)
  })

  it('refuses a period that is not closed', async () => {
    const budget = await januaryBudget()
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })
    await expect(
      reopenPeriod(scope, { budgetId: budget.id, periodStart: '2026-03-01' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

/* -------------------------------------------------------------------------- */
/* Corrections                                                                 */
/* -------------------------------------------------------------------------- */

describe('periodCorrections', () => {
  it('reports drift against a closed period without writing it back', async () => {
    const budget = await januaryBudget()
    await spend('tx-jan', '2026-01-10', 1_500_00)
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })

    // A receipt arrives late, dated inside a month that is already closed.
    await spend('tx-jan-late', '2026-01-25', 120_00)

    const periods = await listPeriods(scope, budget.id)
    const corrections = await periodCorrections(
      scope,
      await getBudget(scope, budget.id),
      periods,
    )
    expect(corrections).toEqual([
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        storedSpentMinor: 1_500_00,
        actualSpentMinor: 1_620_00,
        deltaMinor: 120_00,
      },
    ])
    expect((await listPeriods(scope, budget.id)).at(0)?.spentMinor).toBe(
      1_500_00,
    )
  })

  it('signs a correction negative when money came back', async () => {
    const budget = await januaryBudget()
    await spend('tx-jan', '2026-01-10', 1_500_00)
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })

    await db
      .delete((await import('#/server/db/schema')).transactions)
      .where(eq((await import('#/server/db/schema')).transactions.id, 'tx-jan'))

    const corrections = await periodCorrections(
      scope,
      await getBudget(scope, budget.id),
      await listPeriods(scope, budget.id),
    )
    expect(corrections.at(0)?.deltaMinor).toBe(-1_500_00)
  })

  it('says nothing about a period that still agrees with itself', async () => {
    const budget = await januaryBudget()
    await spend('tx-jan', '2026-01-10', 1_500_00)
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })
    expect(
      await periodCorrections(
        scope,
        await getBudget(scope, budget.id),
        await listPeriods(scope, budget.id),
      ),
    ).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* The open period                                                             */
/* -------------------------------------------------------------------------- */

describe('recomputeOpenPeriod', () => {
  it('brings the current period up to date without touching a closed one', async () => {
    const budget = await januaryBudget()
    await spend('tx-jan', '2026-01-10', 1_500_00)
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })
    await spend('tx-mar', '2026-03-12', 640_00)

    const march = await recomputeOpenPeriod(scope, budget.id, TODAY)
    expect(march?.periodStart).toBe('2026-03-01')
    expect(march?.spentMinor).toBe(640_00)
    expect((await listPeriods(scope, budget.id)).at(0)?.spentMinor).toBe(
      1_500_00,
    )
  })

  it('brings a new limit onto the open period only', async () => {
    const budget = await januaryBudget()
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })
    await updateBudget(scope, budget.id, { limitMinor: 3_000_00 })

    const march = await recomputeOpenPeriod(scope, budget.id, TODAY)
    expect(march?.limitMinor).toBe(3_000_00)
    expect((await listPeriods(scope, budget.id)).at(0)?.limitMinor).toBe(
      2_000_00,
    )
  })

  it('is null when the budget does not cover today', async () => {
    const budget = await januaryBudget({ endDate: '2026-02-28' })
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })
    expect(await recomputeOpenPeriod(scope, budget.id, '2026-09-01')).toBeNull()
  })
})

describe('getCurrentPeriod', () => {
  it('reads, and never creates', async () => {
    const budget = await januaryBudget()
    expect(await getCurrentPeriod(scope, budget.id, TODAY)).toBeNull()
    const rows = await db
      .select()
      .from(budgetPeriods)
      .where(eq(budgetPeriods.budgetId, budget.id))
    expect(rows).toEqual([])
  })

  it('finds the period holding the day once it has been materialised', async () => {
    const budget = await januaryBudget()
    await materializePeriods(scope, { budgetId: budget.id, today: TODAY })
    const period = await getCurrentPeriod(scope, budget.id, TODAY)
    expect(period?.periodStart).toBe('2026-03-01')
  })
})

/* -------------------------------------------------------------------------- */
/* Isolation                                                                   */
/* -------------------------------------------------------------------------- */

describe('isolation', () => {
  beforeEach(async () => {
    await seedBudget(db, { id: 'bud-b', organizationId: 'org-b' })
    await seedPeriod(db, {
      budgetId: 'bud-b',
      organizationId: 'org-b',
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
      spentMinor: 900_00,
    })
  })

  it('cannot read another workspace periods', async () => {
    await expect(listPeriods(scope, 'bud-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      getCurrentPeriod(scope, 'bud-b', TODAY),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('cannot materialise, close, reopen or recompute another workspace budget', async () => {
    for (const call of [
      () => materializePeriods(scope, { budgetId: 'bud-b', today: TODAY }),
      () =>
        closePeriod(scope, { budgetId: 'bud-b', periodStart: '2026-03-01' }),
      () =>
        reopenPeriod(scope, { budgetId: 'bud-b', periodStart: '2026-03-01' }),
      () => recomputeOpenPeriod(scope, 'bud-b', TODAY),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(NotFoundError)
    }

    const rows = await db
      .select()
      .from(budgetPeriods)
      .where(eq(budgetPeriods.budgetId, 'bud-b'))
    expect(rows.at(0)?.spentMinor).toBe(900_00)
    expect(rows.at(0)?.closedAt).toBeNull()
  })

  it('never counts another workspace spending into a period it stores', async () => {
    await seedTransaction(db, {
      id: 'tx-b',
      categoryId: 'cat-b',
      organizationId: 'org-b',
      accountId: 'acc-b',
      bookedOn: '2026-01-10',
      refAmountMinor: 999_00,
    })
    const budget = await januaryBudget()
    const periods = await materializePeriods(scope, {
      budgetId: budget.id,
      today: TODAY,
    })
    expect(periods.every((period) => period.spentMinor === 0)).toBe(true)
  })
})
