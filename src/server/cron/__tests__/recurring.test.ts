/**
 * The two cron branches, driven at a pinned date.
 *
 * What is worth testing here is not the scheduling arithmetic - `recurring/__tests__/schedule` and
 * `recurring/__tests__/reminders` own that - but the three properties that only exist once the
 * branches are assembled:
 *
 * - **Every workspace is visited, through its own scope.** There is no cron super-user, so a sweep
 *   that reached across workspaces would be a tenant leak on the one path nobody is watching.
 * - **A failing workspace does not stop the sweep.** One workspace's broken database must not mean
 *   nobody else's bills are posted.
 * - **Both branches are idempotent.** They run every hour and every quarter of an hour forever; a
 *   second tick over the same day must write nothing and send nothing.
 *
 * The clock is a parameter throughout, so nothing here mocks `Date`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { drizzle } from 'drizzle-orm/sqlite-proxy'

import { transactions } from '#/server/db/schema'
import { setLedgerBatchPorts } from '#/server/ledger/batch'
import { createLogger } from '#/server/observability/logger'
import { rebuildAccountBalance } from '#/server/repos/account-balances'
import { createSeries, listCronScopes } from '#/server/repos/recurring'
import { createScope } from '#/server/repos/scope'
import { setWorkspaceTimezone } from '#/server/repos/workspace-settings'
import { NOW, createBudgetWorld } from '#/server/repos/__tests__/budget-harness'

import {
  cronToday,
  runRecurringHourly,
  runRecurringReminderSweep,
} from '../recurring'
import { createMemoryMarkerStore } from '#/server/recurring/markers'
import { materializeSeries } from '#/server/recurring/materialize'

import type { LogRecord } from '#/server/observability/logger'
import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'
import type { CreateSeriesInput } from '#/server/repos/recurring'
import type { MarkerStore } from '#/server/recurring/markers'

const TODAY = '2026-03-15'

let world: BudgetWorld
let records: Array<LogRecord>
let markers: MarkerStore

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

function rentInput(patch: Partial<CreateSeriesInput> = {}): CreateSeriesInput {
  return {
    name: 'Rent',
    expectedAmountMinor: 250_000,
    expectedCurrencyCode: 'PLN',
    frequency: 'monthly',
    startDate: '2026-03-01',
    accountId: 'acc-a',
    autoRecord: true,
    ...patch,
  }
}

beforeEach(async () => {
  world = await createBudgetWorld()
  records = []
  markers = createMemoryMarkerStore()
  setLedgerBatchPorts({
    namespace: () => ({
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => ({
        fetch: async (request: Request) => {
          const accountId = new URL(request.url).searchParams.get('accountId')
          if (accountId !== null) {
            await rebuildAccountBalance(world.db, accountId, { now: () => NOW })
          }
          return new Response(null, { status: 204 })
        },
      }),
    }),
  })
})

afterEach(() => {
  setLedgerBatchPorts(null)
})

describe('cronToday', () => {
  it('is the Warsaw civil day, not the UTC date, around midnight in summer', () => {
    expect(cronToday(new Date('2026-07-15T22:30:00.000Z'))).toBe('2026-07-16')
    expect(cronToday(new Date('2026-07-15T21:30:00.000Z'))).toBe('2026-07-15')
  })
})

describe('the hourly branch', () => {
  it('posts only the workspace whose civil day has reached the due date', async () => {
    await setWorkspaceTimezone(world.scope, { timezone: 'Europe/Warsaw' })
    await setWorkspaceTimezone(world.otherScope, {
      timezone: 'America/New_York',
    })
    await createSeries(world.scope, rentInput({ startDate: TODAY }))
    await createSeries(
      world.otherScope,
      rentInput({ startDate: TODAY, accountId: 'acc-b' }),
    )

    const report = await runRecurringHourly({
      scopes: await listCronScopes(world.db),
      markers,
      logger: logger(),
      now: new Date('2026-03-14T23:30:00.000Z'),
    })

    expect(report.failures).toBe(0)
    expect(report.transactionsPosted).toBe(1)
    const rows = await world.db.select().from(transactions)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.organizationId).toBe('org-a')
    expect(rows[0]?.bookedOn).toBe(TODAY)
  })

  it('materialises every workspace’s series and posts only the auto-recorded ones', async () => {
    await createSeries(world.scope, rentInput())
    // B's series is active and due, and is not `auto_record`. It must be materialised and left
    // alone: "posted" is a decision about the series, not about the workspace.
    await createSeries(
      world.otherScope,
      rentInput({ name: 'B rent', accountId: 'acc-b', autoRecord: false }),
    )

    const report = await runRecurringHourly(await args())

    expect(report.workspaces).toBe(2)
    expect(report.failures).toBe(0)
    // One occurrence up to today plus the three-deep widget horizon, for each of the two series.
    expect(report.periodsCreated).toBe(8)
    expect(report.transactionsPosted).toBe(1)

    const rows = await world.db.select().from(transactions)
    expect(rows).toHaveLength(1)
    expect(rows.at(0)?.organizationId).toBe('org-a')
    expect(rows.at(0)?.amountMinor).toBe(250_000)
  })

  it('writes nothing on a second tick over the same day', async () => {
    await createSeries(world.scope, rentInput())
    await runRecurringHourly(await args())

    const second = await runRecurringHourly(await args())

    expect(second.periodsCreated).toBe(0)
    expect(second.transactionsPosted).toBe(0)
    expect(await world.db.select().from(transactions)).toHaveLength(1)
  })

  it('counts a broken workspace as a failure and sweeps the rest anyway', async () => {
    await createSeries(world.scope, rentInput())
    const broken = createScope(
      drizzle(async () => {
        throw new Error('D1 is down')
      }),
      { userId: 'user-broken', organizationId: 'org-broken', role: 'owner' },
    )

    const report = await runRecurringHourly({
      ...(await args()),
      // Broken first: a sweep that stopped on the first failure would post nothing at all.
      scopes: [broken, ...(await listCronScopes(world.db))],
    })

    expect(report.failures).toBe(1)
    expect(report.transactionsPosted).toBe(1)
    expect(
      records.filter(
        (record) =>
          record.level === 'error' && record.organizationId === 'org-broken',
      ),
    ).toHaveLength(1)
  })

  it('logs the workspace and the reason when it declines to post', async () => {
    await createSeries(world.scope, rentInput({ accountId: null }))

    const report = await runRecurringHourly(await args())

    expect(report.transactionsPosted).toBe(0)
    // A refusal is not a failure: the sweep worked, the series is not postable.
    expect(report.failures).toBe(0)
    const warning = records.find((record) => record.level === 'warn')
    expect(warning?.organizationId).toBe('org-a')
    expect(warning?.reason).toBe('no-account')
  })
})

describe('the reminder branch', () => {
  /** A series whose only period is due in three days, with a `3d` reminder set. */
  async function seriesDueInThreeDays() {
    const series = await createSeries(
      world.scope,
      rentInput({
        startDate: '2026-03-18',
        autoRecord: false,
        remindBefore: ['3d'],
        notifyEmail: true,
      }),
    )
    // One occurrence ahead: the period this reminder is about has not happened yet, and a
    // horizon of zero writes nothing but history.
    await materializeSeries(world.scope, {
      seriesId: series.id,
      today: TODAY,
      ahead: 1,
    })
    return series
  }

  it('hands today’s reminders onward, once', async () => {
    await seriesDueInThreeDays()

    const report = await runRecurringReminderSweep(await args())

    expect(report.dispatched).toBe(1)
    expect(report.failures).toBe(0)
    // `false` because this suite's module graph never imports `#/server/notify/install` — the
    // Worker entry does, and `#/server/notify/__tests__/install.test.ts` is what asserts the flag
    // flips. What this case checks is that the gap is *reported* rather than hidden, so a
    // production log says plainly when reminders are computed and not delivered.
    expect(report.dispatcherInstalled).toBe(false)
  })

  it('uses the workspace timezone when the reminder sweep has no pinned day', async () => {
    await seriesDueInThreeDays()
    await setWorkspaceTimezone(world.scope, { timezone: 'America/New_York' })
    const input = {
      scopes: [world.scope],
      markers,
      logger: logger(),
      now: new Date('2026-03-14T23:30:00.000Z'),
    }
    expect((await runRecurringReminderSweep(input)).dispatched).toBe(0)
    await setWorkspaceTimezone(world.scope, { timezone: 'Europe/Warsaw' })
    expect((await runRecurringReminderSweep(input)).dispatched).toBe(1)
    expect((await runRecurringReminderSweep(input)).dispatched).toBe(0)
  })

  it('sends nothing on the next tick a quarter of an hour later', async () => {
    await seriesDueInThreeDays()
    await runRecurringReminderSweep(await args())

    const second = await runRecurringReminderSweep(await args())

    expect(second.dispatched).toBe(0)
  })

  it('says nothing about a period whose reminder day is not today', async () => {
    const series = await createSeries(
      world.scope,
      rentInput({
        startDate: '2026-03-25',
        autoRecord: false,
        remindBefore: ['3d'],
      }),
    )
    await materializeSeries(world.scope, {
      seriesId: series.id,
      today: TODAY,
      ahead: 1,
    })

    expect((await runRecurringReminderSweep(await args())).dispatched).toBe(0)
  })
})
