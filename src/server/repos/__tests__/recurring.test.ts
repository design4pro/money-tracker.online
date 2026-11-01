/**
 * The recurring repository, against real SQLite.
 *
 * Five things are checked here and they are the five the plan names.
 *
 * **Materialisation is idempotent.** Running it twice writes one row per period. The primary key
 * `(series_id, period_start)` would refuse the second write anyway; what is checked is that the
 * repository does not *attempt* it, because a cron that throws on its second tick is a cron that
 * stops after its first.
 *
 * **Overdue is derived, never stored.** A row written as `upcoming` reads back as `overdue` once
 * the day passes, without anything having updated it. That is what makes the word on the screen
 * true at read time rather than as-of-last-cron.
 *
 * **The termination is a union.** `endDate` and `maxOccurrences` are two columns and exactly one
 * of them may be set. The schema forbids the pair; the repository makes it unrepresentable.
 *
 * **Money.** Four cases: a fractional amount is refused, a zero one is refused, marking a period
 * paid copies no amount in either direction, and a variance across two currencies is `null` rather
 * than a subtraction with no unit.
 *
 * **Isolation.** Every exported write is called with B's id from A's scope and must be a
 * `NotFoundError` — not an empty result, not a silent no-op. `markPaid` gets its own case with
 * B's *transaction* id, because that is the one argument on this surface that is not a series id
 * and would otherwise be the hole.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'

import {
  recurringLinks,
  recurringPeriods,
  recurringSeries,
  transactions,
} from '#/server/db/schema'
import { occurrences } from '#/server/recurring/schedule'
import { materializeSeries } from '#/server/recurring/materialize'
import { forecastSeries } from '#/server/recurring/forecast'

import { NotFoundError } from '../errors'
import {
  RecurringAutomationConflictError,
  RecurringPeriodPaidError,
  createSeries,
  deleteSeries,
  getSeries,
  getUpcoming,
  listPeriods,
  listSeries,
  listSeriesLinkDetails,
  markPaid,
  markSkipped,
  pauseSeries,
  periodVarianceMinor,
  revertPeriod,
  terminationOf,
  unlinkTransaction,
  updateSeries,
} from '../recurring'
import { NOW, createBudgetWorld, seedTransaction } from './budget-harness'

import type { BudgetWorld } from './budget-harness'
import type { CreateSeriesInput } from '../recurring'

const TODAY = '2026-03-15'

function seriesInput(
  patch: Partial<CreateSeriesInput> = {},
): CreateSeriesInput {
  return {
    name: 'Rent',
    expectedAmountMinor: 250_000,
    expectedCurrencyCode: 'PLN',
    frequency: 'monthly',
    startDate: '2026-01-31',
    accountId: 'acc-a',
    ...patch,
  }
}

let world: BudgetWorld

beforeEach(async () => {
  world = await createBudgetWorld()
})

describe('forecast spending policy', () => {
  it.each([
    { isPlanned: true },
    { isBalanceAdjustment: true },
    { transferKind: 'external_out' },
  ])(
    'excludes a linked payment after its policy changes: %j',
    async (patch) => {
      const series = await createSeries(world.scope, seriesInput())
      await materializeSeries(world.scope, {
        seriesId: series.id,
        today: TODAY,
        ahead: 0,
      })
      const transactionId = await seedTransaction(world.db, {
        id: 'forecast-payment',
        refAmountMinor: 10_000,
        bookedOn: '2026-01-31',
      })
      await markPaid(world.scope, {
        seriesId: series.id,
        periodStart: '2026-01-01',
        transactionId,
      })
      const forecast = async () =>
        forecastSeries({
          schedule: { ...series, frequency: 'monthly' },
          expectedAmountMinor: series.expectedAmountMinor,
          expectedCurrencyCode: series.expectedCurrencyCode,
          direction: 'expense',
          isActive: true,
          today: TODAY,
          links: await listSeriesLinkDetails(world.scope, series.id),
          periods: await listPeriods(world.scope, series.id, TODAY),
        })
      expect((await forecast()).spentThisYearMinor).toBe(10_000)
      await world.db
        .update(transactions)
        .set(patch)
        .where(eq(transactions.id, transactionId))
      expect(await listSeriesLinkDetails(world.scope, series.id)).toHaveLength(
        1,
      )
      expect((await forecast()).spentThisYearMinor).toBe(0)
    },
  )
})

describe('materialisation', () => {
  it('writes one row per period and is idempotent', async () => {
    const series = await createSeries(world.scope, seriesInput())

    const first = await materializeSeries(world.scope, {
      seriesId: series.id,
      today: TODAY,
      ahead: 2,
    })
    const second = await materializeSeries(world.scope, {
      seriesId: series.id,
      today: TODAY,
      ahead: 2,
    })

    expect(first.created).toBeGreaterThan(0)
    expect(second.created).toBe(0)

    const periods = await listPeriods(world.scope, series.id, TODAY)
    expect(new Set(periods.map((period) => period.periodStart)).size).toBe(
      periods.length,
    )
  })

  it('anchors a month-end series without drifting', async () => {
    const series = await createSeries(world.scope, seriesInput())
    await materializeSeries(world.scope, {
      seriesId: series.id,
      today: '2026-07-01',
      ahead: 0,
    })

    const periods = await listPeriods(world.scope, series.id, '2026-07-01')
    expect(periods.map((period) => period.dueOn)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ])
  })

  it('never rewrites a period that has already been written', async () => {
    const series = await createSeries(world.scope, seriesInput())
    await materializeSeries(world.scope, {
      seriesId: series.id,
      today: TODAY,
      ahead: 0,
    })

    await updateSeries(world.scope, series.id, { expectedAmountMinor: 999_999 })
    await materializeSeries(world.scope, {
      seriesId: series.id,
      today: TODAY,
      ahead: 0,
    })

    const periods = await listPeriods(world.scope, series.id, TODAY)
    // What was expected in January is part of January's record. The new figure applies to the
    // periods the edit has not yet produced, and to nothing already written.
    expect(periods.at(0)?.expectedAmountMinor).toBe(250_000)
  })
})

describe('overdue is derived, never stored', () => {
  it('reads an unsettled past period as overdue without anything having updated it', async () => {
    const series = await createSeries(world.scope, seriesInput())
    await materializeSeries(world.scope, {
      seriesId: series.id,
      today: TODAY,
      ahead: 0,
    })

    const stored = await world.db
      .select({
        periodStart: recurringPeriods.periodStart,
        status: recurringPeriods.status,
      })
      .from(recurringPeriods)
      .where(eq(recurringPeriods.seriesId, series.id))
    expect(stored.every((row) => row.status === 'upcoming')).toBe(true)

    const periods = await listPeriods(world.scope, series.id, TODAY)
    const past = periods.filter((period) => period.dueOn < TODAY)
    expect(past.length).toBeGreaterThan(0)
    expect(past.every((period) => period.derivedStatus === 'overdue')).toBe(
      true,
    )
    expect(past.every((period) => period.status === 'upcoming')).toBe(true)
  })

  it('re-derives a stored overdue whose due date has not actually passed', async () => {
    const series = await createSeries(world.scope, seriesInput())
    await materializeSeries(world.scope, {
      seriesId: series.id,
      today: TODAY,
      ahead: 1,
    })
    await world.db
      .update(recurringPeriods)
      .set({ status: 'overdue' })
      .where(eq(recurringPeriods.seriesId, series.id))

    const periods = await listPeriods(world.scope, series.id, '2026-01-01')
    expect(periods.every((period) => period.derivedStatus === 'upcoming')).toBe(
      true,
    )
  })
})

describe('yearly month and JDG duty shape', () => {
  it('stores an annual month and materialises that month, not the start date’s', async () => {
    const series = await createSeries(
      world.scope,
      seriesInput({
        frequency: 'annual',
        anchorDay: 10,
        anchorMonth: 11,
        startDate: '2026-03-15',
      }),
    )
    expect(series.anchorMonth).toBe(11)
    await materializeSeries(world.scope, {
      seriesId: series.id,
      today: '2026-06-15',
      ahead: 1,
    })
    const periods = await listPeriods(world.scope, series.id, '2026-06-15')
    expect(periods.map((period) => period.dueOn)).toEqual(['2026-11-10'])
  })

  it('drops a leftover yearly month when the series is not annual', async () => {
    const series = await createSeries(
      world.scope,
      seriesInput({
        frequency: 'monthly',
        anchorDay: 20,
        anchorMonth: 11,
        startDate: '2026-03-15',
      }),
    )
    expect(series.anchorMonth).toBeNull()
  })

  it('stores a JDG duty code without inventing an amount', async () => {
    const series = await createSeries(
      world.scope,
      seriesInput({
        name: 'ZUS',
        kind: 'bill',
        dutyCode: 'zus',
        frequency: 'monthly',
        anchorDay: 20,
        expectedAmountMinor: 1_234_00,
        startDate: '2026-01-20',
      }),
    )
    expect(series.dutyCode).toBe('zus')
    expect(series.anchorDay).toBe(20)
    expect(series.expectedAmountMinor).toBe(1_234_00)
  })

  describe('an update', () => {
    it('clears the yearly month when the series stops being annual', async () => {
      const series = await createSeries(
        world.scope,
        seriesInput({
          frequency: 'annual',
          anchorDay: 10,
          anchorMonth: 11,
          startDate: '2026-03-15',
        }),
      )
      const updated = await updateSeries(world.scope, series.id, {
        frequency: 'monthly',
      })
      expect(updated.anchorMonth).toBeNull()
    })

    it('keeps the yearly month when only another field changes on an annual series', async () => {
      const series = await createSeries(
        world.scope,
        seriesInput({
          frequency: 'annual',
          anchorDay: 10,
          anchorMonth: 11,
          startDate: '2026-03-15',
        }),
      )
      const updated = await updateSeries(world.scope, series.id, {
        frequency: 'annual',
        name: 'Renamed',
      })
      expect(updated.anchorMonth).toBe(11)
    })

    it('ignores a yearly month sent for a series that is not annual', async () => {
      const series = await createSeries(
        world.scope,
        seriesInput({ frequency: 'monthly', anchorDay: 20 }),
      )
      const updated = await updateSeries(world.scope, series.id, {
        anchorMonth: 5,
      })
      expect(updated.anchorMonth).toBeNull()
    })

    it('sets and clears a duty code, and refuses an unknown one', async () => {
      const series = await createSeries(world.scope, seriesInput({}))
      const withDuty = await updateSeries(world.scope, series.id, {
        dutyCode: 'vat_7',
      })
      expect(withDuty.dutyCode).toBe('vat_7')
      const cleared = await updateSeries(world.scope, series.id, {
        dutyCode: null,
      })
      expect(cleared.dutyCode).toBeNull()
      await expect(
        updateSeries(world.scope, series.id, {
          // The point of the case: a code outside the enum, past the type.
          dutyCode: 'pit_28' as 'zus',
        }),
      ).rejects.toThrow()
    })
  })
})

describe('the termination is a union', () => {
  it('stores an end date and no occurrence count', async () => {
    const series = await createSeries(
      world.scope,
      seriesInput({
        termination: { kind: 'endDate', endDate: '2026-12-31' },
      }),
    )
    expect(series.endDate).toBe('2026-12-31')
    expect(series.maxOccurrences).toBeNull()
    expect(terminationOf(series)).toEqual({
      kind: 'endDate',
      endDate: '2026-12-31',
    })
  })

  it('stores an occurrence count and no end date', async () => {
    const series = await createSeries(
      world.scope,
      seriesInput({
        termination: { kind: 'maxOccurrences', maxOccurrences: 12 },
      }),
    )
    expect(series.endDate).toBeNull()
    expect(series.maxOccurrences).toBe(12)
    expect(terminationOf(series)).toEqual({
      kind: 'maxOccurrences',
      maxOccurrences: 12,
    })
  })

  it('terminates inclusively on both forms', async () => {
    const twelve = occurrences({
      frequency: 'monthly',
      anchorDay: null,
      startDate: '2026-01-15',
      maxOccurrences: 12,
    })
    expect(twelve).toHaveLength(12)

    const dated = occurrences({
      frequency: 'monthly',
      anchorDay: null,
      startDate: '2026-01-15',
      endDate: '2026-03-15',
    })
    // The 15th of March is the end date and still counts.
    expect(dated.map((one) => one.dueOn)).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ])
  })

  it('refuses auto_record together with matching rules', async () => {
    await expect(
      createSeries(
        world.scope,
        seriesInput({
          autoRecord: true,
          matchingRules: { payee: ['rent'] },
        }),
      ),
    ).rejects.toBeInstanceOf(RecurringAutomationConflictError)
  })

  it('refuses the pair when an edit would create it', async () => {
    const series = await createSeries(
      world.scope,
      seriesInput({ autoRecord: true }),
    )
    await expect(
      updateSeries(world.scope, series.id, {
        matchingRules: { payee: ['rent'] },
      }),
    ).rejects.toBeInstanceOf(RecurringAutomationConflictError)
  })
})

describe('skipping a period', () => {
  async function materialisedPeriod(): Promise<{
    seriesId: string
    periodStart: string
  }> {
    const series = await createSeries(world.scope, seriesInput())
    await materializeSeries(world.scope, {
      seriesId: series.id,
      today: TODAY,
      ahead: 0,
    })
    const period = (await listPeriods(world.scope, series.id, TODAY)).at(0)
    if (period === undefined) throw new Error('no period materialised')
    return { seriesId: series.id, periodStart: period.periodStart }
  }

  async function storedPeriod(key: { seriesId: string; periodStart: string }) {
    const [row] = await world.db
      .select()
      .from(recurringPeriods)
      .where(
        and(
          eq(recurringPeriods.seriesId, key.seriesId),
          eq(recurringPeriods.periodStart, key.periodStart),
        ),
      )
    return row
  }

  it('refuses a period another tab has already marked paid, and leaves it and its link alone', async () => {
    const key = await materialisedPeriod()
    await seedTransaction(world.db, {
      id: 'txn-a',
      refAmountMinor: 250_000,
      bookedOn: '2026-01-31',
    })
    await markPaid(world.scope, { ...key, transactionId: 'txn-a' })

    await expect(markSkipped(world.scope, key)).rejects.toBeInstanceOf(
      RecurringPeriodPaidError,
    )

    const period = await storedPeriod(key)
    expect(period.status).toBe('paid')
    expect(period.settledTransactionId).toBe('txn-a')
    const links = await world.db
      .select({ status: recurringLinks.status })
      .from(recurringLinks)
      .where(eq(recurringLinks.seriesId, key.seriesId))
    expect(links).toEqual([{ status: 'active' }])
  })

  it('skips an upcoming period', async () => {
    const key = await materialisedPeriod()

    await markSkipped(world.scope, key)

    const period = await storedPeriod(key)
    expect(period.status).toBe('skipped')
    expect(period.settledTransactionId).toBeNull()
  })

  it('succeeds without error on a period that is already skipped', async () => {
    const key = await materialisedPeriod()
    await markSkipped(world.scope, key)

    await expect(markSkipped(world.scope, key)).resolves.toBeUndefined()

    expect((await storedPeriod(key)).status).toBe('skipped')
  })

  it('is a not-found, not a conflict, for a period that does not exist', async () => {
    const { seriesId } = await materialisedPeriod()

    await expect(
      markSkipped(world.scope, { seriesId, periodStart: '1999-01-31' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('money', () => {
  it('refuses a fractional amount', async () => {
    await expect(
      createSeries(world.scope, seriesInput({ expectedAmountMinor: 1234.5 })),
    ).rejects.toThrow()
  })

  it('refuses an amount of nothing', async () => {
    await expect(
      createSeries(world.scope, seriesInput({ expectedAmountMinor: 0 })),
    ).rejects.toThrow()
  })

  it('copies no amount when a period is marked paid', async () => {
    const series = await createSeries(world.scope, seriesInput())
    await materializeSeries(world.scope, {
      seriesId: series.id,
      today: TODAY,
      ahead: 0,
    })
    await seedTransaction(world.db, {
      id: 'txn-a',
      refAmountMinor: 260_000,
      bookedOn: '2026-03-31',
    })
    const period = (await listPeriods(world.scope, series.id, TODAY)).at(0)
    if (period === undefined) throw new Error('no period materialised')

    await markPaid(world.scope, {
      seriesId: series.id,
      periodStart: period.periodStart,
      transactionId: 'txn-a',
    })

    const settled = (await listPeriods(world.scope, series.id, TODAY)).find(
      (row) => row.periodStart === period.periodStart,
    )
    // The expectation is unchanged and the transaction is unchanged. The difference between them
    // is a read, and it is stored nowhere.
    expect(settled?.expectedAmountMinor).toBe(250_000)
    expect(settled?.settledAmountMinor).toBe(260_000)
    expect(periodVarianceMinor(settled!)).toBe(10_000)

    const [row] = await world.db
      .select({ amountMinor: transactions.amountMinor })
      .from(transactions)
      .where(eq(transactions.id, 'txn-a'))
    expect(row.amountMinor).toBe(260_000)
  })

  it('reports no variance when the two amounts are in different currencies', () => {
    expect(
      periodVarianceMinor({
        seriesId: 's',
        periodStart: '2026-03-01',
        dueOn: '2026-03-01',
        status: 'paid',
        derivedStatus: 'paid',
        expectedAmountMinor: 18_000 as never,
        expectedCurrencyCode: 'PLN',
        settledTransactionId: 't',
        settledAmountMinor: 4_000 as never,
        settledCurrencyCode: 'EUR',
        settledOn: '2026-03-01',
      }),
    ).toBeNull()
  })
})

describe('tenant isolation', () => {
  async function seriesInB(): Promise<string> {
    const series = await createSeries(
      world.otherScope,
      seriesInput({ accountId: 'acc-b' }),
    )
    await materializeSeries(world.otherScope, {
      seriesId: series.id,
      today: TODAY,
      ahead: 0,
    })
    return series.id
  }

  it("does not list B's series", async () => {
    await seriesInB()
    expect(await listSeries(world.scope, { includeInactive: true })).toEqual([])
  })

  it.each([
    ['getSeries', (id: string) => getSeries(world.scope, id)],
    ['pauseSeries', (id: string) => pauseSeries(world.scope, id)],
    ['deleteSeries', (id: string) => deleteSeries(world.scope, id)],
    [
      'updateSeries',
      (id: string) => updateSeries(world.scope, id, { name: 'Taken' }),
    ],
    [
      'markSkipped',
      (id: string) =>
        markSkipped(world.scope, { seriesId: id, periodStart: '2026-01-31' }),
    ],
    [
      'revertPeriod',
      (id: string) =>
        revertPeriod(world.scope, { seriesId: id, periodStart: '2026-01-31' }),
    ],
    [
      'unlinkTransaction',
      (id: string) =>
        unlinkTransaction(world.scope, {
          seriesId: id,
          transactionId: 'txn-b',
        }),
    ],
    [
      'materializeSeries',
      (id: string) =>
        materializeSeries(world.scope, { seriesId: id, today: TODAY }),
    ],
  ])("refuses B's series id from A's scope: %s", async (_name, call) => {
    const id = await seriesInB()
    await expect(call(id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it("refuses B's transaction id on A's own period", async () => {
    const mine = await createSeries(world.scope, seriesInput())
    await materializeSeries(world.scope, {
      seriesId: mine.id,
      today: TODAY,
      ahead: 0,
    })
    await seedTransaction(world.db, {
      id: 'txn-b',
      refAmountMinor: 250_000,
      organizationId: 'org-b',
      accountId: 'acc-b',
    })
    const period = (await listPeriods(world.scope, mine.id, TODAY)).at(0)
    if (period === undefined) throw new Error('no period materialised')

    await expect(
      markPaid(world.scope, {
        seriesId: mine.id,
        periodStart: period.periodStart,
        transactionId: 'txn-b',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("keeps B's periods out of A's upcoming list", async () => {
    await seriesInB()
    const mine = await createSeries(world.scope, seriesInput({ name: 'Mine' }))
    await materializeSeries(world.scope, {
      seriesId: mine.id,
      today: TODAY,
      ahead: 1,
    })

    const upcoming = await getUpcoming(world.scope, { today: TODAY })
    expect(upcoming.length).toBeGreaterThan(0)
    expect(upcoming.every((period) => period.seriesId === mine.id)).toBe(true)
  })

  it("leaves B's rows exactly as they were", async () => {
    const id = await seriesInB()
    const before = await world.db
      .select()
      .from(recurringSeries)
      .where(eq(recurringSeries.id, id))

    await createSeries(world.scope, seriesInput())
    await expect(deleteSeries(world.scope, id)).rejects.toBeInstanceOf(
      NotFoundError,
    )

    const after = await world.db
      .select()
      .from(recurringSeries)
      .where(eq(recurringSeries.id, id))
    expect(after).toEqual(before)
    expect(NOW.getTime()).toBeGreaterThan(0)
  })
})
