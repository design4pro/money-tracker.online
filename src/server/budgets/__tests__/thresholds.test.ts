/**
 * The alert sweep: what crossed, once, in which workspace — and the seam plan 21 will fill.
 *
 * Two claims are worth a real database rather than a stub. The first is that the sweep reads the
 * **stored** `spent_minor` of the current period, so an alert can never disagree with the meter on
 * the screen. The second is tenant isolation: B's identical budget must produce B's own crossing
 * and must never be suppressed by A's marker.
 *
 * The dispatcher assertions cover both sides of the seam on purpose. A permanent no-op nobody
 * notices is a silent feature failure; a seam with a test on each side of it is not.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  addSecondMember,
  createBudgetWorld,
  seedBudget,
  seedPeriod,
} from '#/server/repos/__tests__/budget-harness'

import {
  BUDGET_EXCEEDED_EVENT,
  BUDGET_THRESHOLD_EVENT,
  NOOP_ALERT_DISPATCHER,
  createMemoryMarkerStore,
  crossingMarkerKey,
  findCrossings,
  isBudgetAlertDispatcherInstalled,
  setBudgetAlertDispatcher,
  sweepBudgetThresholds,
} from '../thresholds'

import type {
  BudgetWorld,
  TestDb,
} from '#/server/repos/__tests__/budget-harness'
import type { ThresholdCrossing } from '../thresholds'

const TODAY = '2026-03-15'

let world: BudgetWorld
let db: TestDb

/** March 2026, spent to order. The budget the whole file measures against. */
async function seedMarch(over: {
  readonly spentMinor: number
  readonly budgetId?: string
  readonly organizationId?: string
  readonly limitMinor?: number
  readonly carriedInMinor?: number
  readonly alertThresholds?: ReadonlyArray<number>
  readonly status?: 'active' | 'archived'
}): Promise<string> {
  const budgetId = over.budgetId ?? 'bud-a'
  await seedBudget(db, {
    id: budgetId,
    organizationId: over.organizationId,
    limitMinor: over.limitMinor ?? 2_000_00,
    alertThresholds: over.alertThresholds,
    status: over.status,
  })
  await seedPeriod(db, {
    budgetId,
    organizationId: over.organizationId,
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    limitMinor: over.limitMinor ?? 2_000_00,
    carriedInMinor: over.carriedInMinor ?? 0,
    spentMinor: over.spentMinor,
  })
  return budgetId
}

beforeEach(async () => {
  world = await createBudgetWorld()
  db = world.db
})

afterEach(() => {
  setBudgetAlertDispatcher(null)
})

describe('crossingMarkerKey', () => {
  it('is versioned, and keyed by budget, period and threshold', () => {
    expect(
      crossingMarkerKey({
        budgetId: 'bud-a',
        periodStart: '2026-03-01',
        threshold: 80,
      }),
    ).toBe('budget:threshold:v1:bud-a:2026-03-01:80')
  })
})

describe('findCrossings', () => {
  it('finds nothing while the envelope is under every line', () => {
    return (async () => {
      await seedMarch({ spentMinor: 900_00 })
      const crossings = await findCrossings({
        scope: world.scope,
        today: TODAY,
        markers: createMemoryMarkerStore(),
      })
      expect(crossings).toEqual([])
    })()
  })

  it('reports every line reached, not only the highest', async () => {
    await seedMarch({ spentMinor: 1_700_00 })
    const crossings = await findCrossings({
      scope: world.scope,
      today: TODAY,
      markers: createMemoryMarkerStore(),
    })
    expect(crossings.map((crossing) => crossing.threshold)).toEqual([50, 80])
    expect(crossings.map((crossing) => crossing.event)).toEqual([
      BUDGET_THRESHOLD_EVENT,
      BUDGET_THRESHOLD_EVENT,
    ])
  })

  it('names the exceeded event from 100 up', async () => {
    await seedMarch({ spentMinor: 2_000_00 })
    const crossings = await findCrossings({
      scope: world.scope,
      today: TODAY,
      markers: createMemoryMarkerStore(),
    })
    const hundred = crossings.find((crossing) => crossing.threshold === 100)
    expect(hundred?.event).toBe(BUDGET_EXCEEDED_EVENT)
    expect(hundred?.spentMinor).toBe(2_000_00)
    expect(hundred?.availableMinor).toBe(2_000_00)
    expect(hundred?.currencyCode).toBe('PLN')
  })

  it('measures against limit plus carry, so a rollover does not fire a false alert', async () => {
    // 1 700,00 spent, 2 000,00 limit, 300,00 carried in: 73,9% of what is available. Measured
    // against the limit alone it would read 85% and wake somebody up for nothing.
    await seedMarch({ spentMinor: 1_700_00, carriedInMinor: 300_00 })
    const crossings = await findCrossings({
      scope: world.scope,
      today: TODAY,
      markers: createMemoryMarkerStore(),
    })
    expect(crossings.map((crossing) => crossing.threshold)).toEqual([50])
  })

  it('does not fire at 79,999%', async () => {
    // 1 599,99 of 2 000,00. A float division rounds this to 0.8.
    await seedMarch({ spentMinor: 1_599_99 })
    const crossings = await findCrossings({
      scope: world.scope,
      today: TODAY,
      markers: createMemoryMarkerStore(),
    })
    expect(crossings.map((crossing) => crossing.threshold)).toEqual([50])
  })

  it('honours a ladder the workspace configured itself', async () => {
    await seedMarch({ spentMinor: 1_900_00, alertThresholds: [95] })
    const crossings = await findCrossings({
      scope: world.scope,
      today: TODAY,
      markers: createMemoryMarkerStore(),
    })
    expect(crossings.map((crossing) => crossing.threshold)).toEqual([95])
  })

  it('skips an archived budget, which stopped accruing when it was archived', async () => {
    await seedMarch({ spentMinor: 2_400_00, status: 'archived' })
    const crossings = await findCrossings({
      scope: world.scope,
      today: TODAY,
      markers: createMemoryMarkerStore(),
    })
    expect(crossings).toEqual([])
  })

  it('skips a budget whose period has not been materialised yet', async () => {
    // No period row: inventing a figure here would be the live recomputation the module forbids.
    await seedBudget(db, { id: 'bud-a' })
    const crossings = await findCrossings({
      scope: world.scope,
      today: TODAY,
      markers: createMemoryMarkerStore(),
    })
    expect(crossings).toEqual([])
  })

  it('skips a period that does not contain today', async () => {
    await seedMarch({ spentMinor: 2_400_00 })
    const crossings = await findCrossings({
      scope: world.scope,
      today: '2026-05-04',
      markers: createMemoryMarkerStore(),
    })
    expect(crossings).toEqual([])
  })

  it('reads the stored figure, so the alert and the screen cannot disagree', async () => {
    await seedMarch({ spentMinor: 1_700_00 })
    const [first] = await findCrossings({
      scope: world.scope,
      today: TODAY,
      markers: createMemoryMarkerStore(),
    })
    expect(first.spentMinor).toBe(1_700_00)
    expect(Number.isInteger(first.spentMinor)).toBe(true)
  })
})

describe('the marker', () => {
  it('suppresses a line already notified, and only that line', async () => {
    await seedMarch({ spentMinor: 1_700_00 })
    const markers = createMemoryMarkerStore([
      'budget:threshold:v1:bud-a:2026-03-01:50',
    ])
    const crossings = await findCrossings({
      scope: world.scope,
      today: TODAY,
      markers,
    })
    expect(crossings.map((crossing) => crossing.threshold)).toEqual([80])
  })

  it('is written after dispatch, so a failed dispatch retries', async () => {
    await seedMarch({ spentMinor: 2_400_00 })
    const markers = createMemoryMarkerStore()
    setBudgetAlertDispatcher(async () => {
      throw new Error('the queue was down')
    })

    await expect(
      sweepBudgetThresholds({ scope: world.scope, today: TODAY, markers }),
    ).rejects.toThrow('the queue was down')
    expect(markers.keys.size).toBe(0)

    // The next sweep, with a working dispatcher, still owes all three notifications.
    setBudgetAlertDispatcher(async () => {})
    const crossings = await sweepBudgetThresholds({
      scope: world.scope,
      today: TODAY,
      markers,
    })
    expect(crossings.map((crossing) => crossing.threshold)).toEqual([
      50, 80, 100,
    ])
    expect(markers.keys.size).toBe(3)
  })

  it('notifies once per threshold per period', async () => {
    await seedMarch({ spentMinor: 2_400_00 })
    const markers = createMemoryMarkerStore()
    const first = await sweepBudgetThresholds({
      scope: world.scope,
      today: TODAY,
      markers,
    })
    const second = await sweepBudgetThresholds({
      scope: world.scope,
      today: TODAY,
      markers,
    })
    expect(first.length).toBe(3)
    expect(second).toEqual([])
  })

  it('does not re-arm a threshold when a refund brings spend back under it', async () => {
    // 99% -> 101% fires 100 exactly once; a refund back to 99% and a fresh overspend must not
    // notify a second time about the same overspend in the same period.
    await seedMarch({ spentMinor: 1_980_00 })
    const markers = createMemoryMarkerStore()

    const under = await sweepBudgetThresholds({
      scope: world.scope,
      today: TODAY,
      markers,
    })
    expect(under.map((crossing) => crossing.threshold)).toEqual([50, 80])

    await setSpent(2_020_00)
    const over = await sweepBudgetThresholds({
      scope: world.scope,
      today: TODAY,
      markers,
    })
    expect(over.map((crossing) => crossing.threshold)).toEqual([100])

    await setSpent(1_980_00)
    expect(
      await sweepBudgetThresholds({
        scope: world.scope,
        today: TODAY,
        markers,
      }),
    ).toEqual([])

    await setSpent(2_050_00)
    expect(
      await sweepBudgetThresholds({
        scope: world.scope,
        today: TODAY,
        markers,
      }),
    ).toEqual([])
  })
})

describe('the dispatcher seam', () => {
  it('defaults to the no-op, and says so', () => {
    expect(isBudgetAlertDispatcherInstalled()).toBe(false)
    expect(NOOP_ALERT_DISPATCHER).toBeTypeOf('function')
  })

  it('hands an installed dispatcher every crossing the sweep found, scoped', async () => {
    await seedMarch({ spentMinor: 2_400_00 })
    const received: Array<{
      readonly organizationId: string
      readonly crossings: ReadonlyArray<ThresholdCrossing>
    }> = []
    setBudgetAlertDispatcher(async (scope, crossings) => {
      received.push({ organizationId: scope.ctx.organizationId, crossings })
    })
    expect(isBudgetAlertDispatcherInstalled()).toBe(true)

    await sweepBudgetThresholds({
      scope: world.scope,
      today: TODAY,
      markers: createMemoryMarkerStore(),
    })

    expect(received.length).toBe(1)
    expect(received[0]?.organizationId).toBe('org-a')
    expect(
      received[0]?.crossings.map((crossing) => crossing.threshold),
    ).toEqual([50, 80, 100])
  })

  it('is not called at all when nothing crossed', async () => {
    await seedMarch({ spentMinor: 100_00 })
    let calls = 0
    setBudgetAlertDispatcher(async () => {
      calls += 1
    })
    await sweepBudgetThresholds({
      scope: world.scope,
      today: TODAY,
      markers: createMemoryMarkerStore(),
    })
    expect(calls).toBe(0)
  })

  it('restores the no-op when uninstalled', () => {
    setBudgetAlertDispatcher(async () => {})
    setBudgetAlertDispatcher(null)
    expect(isBudgetAlertDispatcherInstalled()).toBe(false)
  })
})

describe('isolation', () => {
  it('never reads another workspace budget, even one with the same shape', async () => {
    await seedMarch({ spentMinor: 2_400_00 })
    await seedMarch({
      spentMinor: 2_400_00,
      budgetId: 'bud-b',
      organizationId: 'org-b',
    })

    const mine = await findCrossings({
      scope: world.scope,
      today: TODAY,
      markers: createMemoryMarkerStore(),
    })
    expect(new Set(mine.map((crossing) => crossing.budgetId))).toEqual(
      new Set(['bud-a']),
    )
  })

  it("does not let one workspace's marker suppress another's crossing", async () => {
    await seedMarch({ spentMinor: 2_400_00 })
    await seedMarch({
      spentMinor: 2_400_00,
      budgetId: 'bud-b',
      organizationId: 'org-b',
    })
    const markers = createMemoryMarkerStore()

    await sweepBudgetThresholds({
      scope: world.scope,
      today: TODAY,
      markers,
    })
    const theirs = await findCrossings({
      scope: world.otherScope,
      today: TODAY,
      markers,
    })
    expect(theirs.map((crossing) => crossing.threshold)).toEqual([50, 80, 100])
    expect(theirs.every((crossing) => crossing.budgetId === 'bud-b')).toBe(true)
  })

  it('sweeps for a member as well as for an owner: reading is not administration', async () => {
    await addSecondMember(db)
    await seedMarch({ spentMinor: 2_400_00 })
    const crossings = await findCrossings({
      scope: world.scope,
      today: TODAY,
      markers: createMemoryMarkerStore(),
    })
    expect(crossings.length).toBe(3)
  })
})

/** Rewrites the stored figure the way a recompute would, without going through the repository. */
async function setSpent(spentMinor: number): Promise<void> {
  const { budgetPeriods } = await import('#/server/db/schema')
  const { and, eq } = await import('drizzle-orm')
  await db
    .update(budgetPeriods)
    .set({ spentMinor })
    .where(
      and(
        eq(budgetPeriods.budgetId, 'bud-a'),
        eq(budgetPeriods.periodStart, '2026-03-01'),
      ),
    )
}
