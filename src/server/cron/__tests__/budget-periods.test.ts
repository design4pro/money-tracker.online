/**
 * The budget half of the hourly branch, driven across a period boundary at a pinned date.
 *
 * `repos/__tests__/budget-periods` owns the walk itself — what opens, what closes, what carries.
 * What only exists once the branch is assembled is tested here:
 *
 * - **A budget nobody touched still gets its next period.** This is the defect the module exists
 *   for: before it, `materializePeriods` ran only on a write path, so an untouched budget had no
 *   period covering today the moment its current one ended.
 * - **Every workspace is visited, through its own scope.** There is no cron super-user.
 * - **A failing workspace does not stop the sweep**, and neither does a single failing budget.
 * - **A second tick is silent.** The branch fires hourly forever.
 *
 * The clock is a parameter throughout, so nothing here mocks `Date`.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { drizzle } from 'drizzle-orm/sqlite-proxy'

import { createLogger } from '#/server/observability/logger'
import { listPeriods } from '#/server/repos/budget-periods'
import { listCronScopes } from '#/server/repos/recurring'
import { createScope } from '#/server/repos/scope'
import {
  createBudgetWorld,
  seedBudget,
  seedPeriod,
} from '#/server/repos/__tests__/budget-harness'

import { runBudgetPeriodSweep } from '../budget-periods'

import type { LogRecord } from '#/server/observability/logger'
import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'
import type { TenantScope } from '#/server/repos/base'

/** March, so a budget whose only period ended on the last day of February is a month behind. */
const TODAY = '2026-03-15'

let world: BudgetWorld
let records: Array<LogRecord>

function logger() {
  return createLogger({
    level: 'debug',
    sink: {
      write: (record) => {
        records.push(record)
      },
    },
  })
}

async function args() {
  return {
    scopes: await listCronScopes(world.db),
    today: TODAY,
    logger: logger(),
  }
}

/** A monthly budget whose materialisation stopped at February — the untouched-budget case. */
async function seedBudgetStuckInFebruary(over: {
  readonly budgetId: string
  readonly organizationId?: string
}): Promise<void> {
  await seedBudget(world.db, {
    id: over.budgetId,
    organizationId: over.organizationId,
    startDate: '2026-02-01',
    rolloverPolicy: 'carry_surplus',
  })
  await seedPeriod(world.db, {
    budgetId: over.budgetId,
    organizationId: over.organizationId,
    periodStart: '2026-02-01',
    periodEnd: '2026-02-28',
    spentMinor: 0,
  })
}

beforeEach(async () => {
  world = await createBudgetWorld()
  records = []
})

describe('the budget period branch', () => {
  it('opens the period a budget nobody touched is missing, and closes the one that ended', async () => {
    await seedBudgetStuckInFebruary({ budgetId: 'bud-a' })

    const report = await runBudgetPeriodSweep(await args())

    expect(report.workspaces).toBe(2)
    expect(report.budgets).toBe(1)
    expect(report.failures).toBe(0)
    expect(report.periodsCreated).toBe(1)
    expect(report.periodsClosed).toBe(1)

    const periods = await listPeriods(world.scope, 'bud-a')
    expect(periods.map((period) => period.periodStart)).toEqual([
      '2026-02-01',
      '2026-03-01',
    ])
    // February has ended, so it is closed; March covers today and stays open.
    expect(periods.at(0)?.closedAt).not.toBeNull()
    expect(periods.at(1)?.closedAt).toBeNull()
  })

  it('sweeps every workspace through its own scope', async () => {
    await seedBudgetStuckInFebruary({ budgetId: 'bud-a' })
    await seedBudgetStuckInFebruary({
      budgetId: 'bud-b',
      organizationId: 'org-b',
    })

    const report = await runBudgetPeriodSweep(await args())

    expect(report.budgets).toBe(2)
    expect(report.periodsCreated).toBe(2)
    expect(
      (await listPeriods(world.otherScope, 'bud-b')).map(
        (period) => period.periodStart,
      ),
    ).toEqual(['2026-02-01', '2026-03-01'])
  })

  it('leaves an archived budget alone', async () => {
    await seedBudgetStuckInFebruary({ budgetId: 'bud-a' })
    await seedBudget(world.db, { id: 'bud-old', status: 'archived' })

    const report = await runBudgetPeriodSweep(await args())

    expect(report.budgets).toBe(1)
    expect(await listPeriods(world.scope, 'bud-old')).toEqual([])
  })

  it('writes nothing on a second tick over the same day', async () => {
    await seedBudgetStuckInFebruary({ budgetId: 'bud-a' })
    await runBudgetPeriodSweep(await args())

    const second = await runBudgetPeriodSweep(await args())

    expect(second.periodsCreated).toBe(0)
    expect(second.periodsClosed).toBe(0)
    expect(second.failures).toBe(0)
  })

  it('counts a broken workspace as a failure and sweeps the rest anyway', async () => {
    await seedBudgetStuckInFebruary({ budgetId: 'bud-a' })
    const broken: TenantScope = createScope(
      drizzle(async () => {
        throw new Error('D1 is down')
      }),
      { userId: 'user-broken', organizationId: 'org-broken', role: 'owner' },
    )

    const report = await runBudgetPeriodSweep({
      ...(await args()),
      // Broken first: a sweep that stopped on the first failure would materialise nothing at all.
      scopes: [broken, ...(await listCronScopes(world.db))],
    })

    expect(report.failures).toBe(1)
    expect(report.periodsCreated).toBe(1)
    expect(
      records.filter(
        (record) =>
          record.level === 'error' && record.organizationId === 'org-broken',
      ),
    ).toHaveLength(1)
  })
})
