/**
 * The budget half of the quarter-hourly branch, driven at a pinned date.
 *
 * `budgets/__tests__/thresholds` owns which threshold counts as crossed and what a marker means.
 * What only exists once the branch is assembled is tested here:
 *
 * - **Every workspace is visited, through its own scope.** There is no cron super-user, so a sweep
 *   that reached across workspaces would be a tenant leak on the one path nobody is watching.
 * - **A failing workspace does not stop the sweep.** One workspace's broken database must not mean
 *   nobody else is told they are over budget.
 * - **A second tick is silent.** The branch fires every fifteen minutes forever.
 * - **The dispatcher gap is reported.** A permanent no-op nobody notices is a silent feature
 *   failure, so the report says whether one is installed and the Worker logs it.
 *
 * The clock is a parameter throughout, so nothing here mocks `Date`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { drizzle } from 'drizzle-orm/sqlite-proxy'

import {
  NOOP_ALERT_DISPATCHER,
  createMemoryMarkerStore,
  setBudgetAlertDispatcher,
} from '#/server/budgets/thresholds'
import { createLogger } from '#/server/observability/logger'
import { listCronScopes } from '#/server/repos/recurring'
import { createScope } from '#/server/repos/scope'
import {
  createBudgetWorld,
  seedBudget,
  seedPeriod,
} from '#/server/repos/__tests__/budget-harness'

import { runBudgetThresholdSweep } from '../budget-thresholds'

import type { ThresholdMarkerStore } from '#/server/budgets/thresholds'
import type { LogRecord } from '#/server/observability/logger'
import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'
import type { TenantScope } from '#/server/repos/base'

const TODAY = '2026-03-15'

let world: BudgetWorld
let records: Array<LogRecord>
let markers: ThresholdMarkerStore

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
    markers,
    today: TODAY,
    logger: logger(),
  }
}

/** March 2026 in one workspace, spent past the 80% notch of a 2 000,00 limit. */
async function seedMarchOverEighty(over: {
  readonly budgetId: string
  readonly organizationId?: string
  readonly spentMinor: number
}): Promise<void> {
  await seedBudget(world.db, {
    id: over.budgetId,
    organizationId: over.organizationId,
    alertThresholds: [80, 100],
  })
  await seedPeriod(world.db, {
    budgetId: over.budgetId,
    organizationId: over.organizationId,
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    spentMinor: over.spentMinor,
  })
}

beforeEach(async () => {
  world = await createBudgetWorld()
  records = []
  markers = createMemoryMarkerStore()
})

afterEach(() => {
  setBudgetAlertDispatcher(null)
})

describe('the budget threshold branch', () => {
  it('sweeps every workspace through its own scope', async () => {
    await seedMarchOverEighty({ budgetId: 'bud-a', spentMinor: 1_700_00 })
    await seedMarchOverEighty({
      budgetId: 'bud-b',
      organizationId: 'org-b',
      spentMinor: 2_100_00,
    })

    const report = await runBudgetThresholdSweep(await args())

    expect(report.workspaces).toBe(2)
    expect(report.failures).toBe(0)
    // A's 80 notch, and B's 80 and 100 both: B is over the limit, so it crossed two.
    expect(report.crossings).toBe(3)
  })

  it('reports nothing on a second tick over the same day', async () => {
    await seedMarchOverEighty({ budgetId: 'bud-a', spentMinor: 1_700_00 })
    await runBudgetThresholdSweep(await args())

    const second = await runBudgetThresholdSweep(await args())

    expect(second.crossings).toBe(0)
    expect(second.failures).toBe(0)
  })

  it('counts a broken workspace as a failure and sweeps the rest anyway', async () => {
    await seedMarchOverEighty({ budgetId: 'bud-a', spentMinor: 1_700_00 })
    const broken: TenantScope = createScope(
      drizzle(async () => {
        throw new Error('D1 is down')
      }),
      { userId: 'user-broken', organizationId: 'org-broken', role: 'owner' },
    )

    const report = await runBudgetThresholdSweep({
      ...(await args()),
      // Broken first: a sweep that stopped on the first failure would report nothing at all.
      scopes: [broken, ...(await listCronScopes(world.db))],
    })

    expect(report.failures).toBe(1)
    expect(report.crossings).toBe(1)
    expect(
      records.filter(
        (record) =>
          record.level === 'error' && record.organizationId === 'org-broken',
      ),
    ).toHaveLength(1)
  })

  it('reports the dispatcher gap, and reports it closed once one is installed', async () => {
    await seedMarchOverEighty({ budgetId: 'bud-a', spentMinor: 1_700_00 })

    expect(
      (await runBudgetThresholdSweep(await args())).dispatcherInstalled,
    ).toBe(false)

    const sent: Array<string> = []
    setBudgetAlertDispatcher(async (scope, crossings) => {
      for (const crossing of crossings) {
        sent.push(`${scope.ctx.organizationId}:${crossing.threshold}`)
      }
    })
    // A fresh marker store: the first sweep already remembered A's 80 notch.
    markers = createMemoryMarkerStore()

    const report = await runBudgetThresholdSweep(await args())

    expect(report.dispatcherInstalled).toBe(true)
    expect(sent).toEqual(['org-a:80'])

    setBudgetAlertDispatcher(NOOP_ALERT_DISPATCHER)
    expect(
      (await runBudgetThresholdSweep(await args())).dispatcherInstalled,
    ).toBe(false)
  })
})
