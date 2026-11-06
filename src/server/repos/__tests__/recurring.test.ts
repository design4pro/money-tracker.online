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

import { ConflictError, NotFoundError } from '../errors'
import { createLoan, markInstalmentPaid } from '../loans'
import { deleteTransaction } from '../transactions'
import {
  RecurringAutomationConflictError,
  RecurringPeriodPaidError,
  RecurringTransactionLinkedError,
  createSeries,
  deleteSeries,
  getSeries,
  getUpcoming,
  listPeriods,
  listSeries,
  listSeriesLinkDetails,
  markPaid,
  sumSeriesSpendThisYear,
  markSkipped,
  pauseSeries,
  periodVarianceMinor,
  removeUnpaidOpenPeriods,
  revertPeriod,
  terminationOf,
  unlinkTransaction,
  updateSeries,
} from '../recurring'
import {
  NOW,
  createBudgetWorld,
  executed,
  fault,
  seedTransaction,
} from './budget-harness'

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

describe('overview spent-this-year aggregate', () => {
  async function linkPayment(input: {
    readonly seriesId: string
    readonly transactionId: string
    readonly amountMinor: number
    readonly bookedOn: string
    readonly periodStart?: string
  }): Promise<void> {
    await seedTransaction(world.db, {
      id: input.transactionId,
      refAmountMinor: input.amountMinor,
      bookedOn: input.bookedOn,
    })
    if (input.periodStart !== undefined) {
      await markPaid(world.scope, {
        seriesId: input.seriesId,
        periodStart: input.periodStart,
        transactionId: input.transactionId,
      })
      return
    }
    await world.db.insert(recurringLinks).values({
      organizationId: 'org-a',
      seriesId: input.seriesId,
      transactionId: input.transactionId,
      createdAt: NOW,
      updatedAt: NOW,
    })
  }

  it('sums this calendar year per series, skipping other years, currencies and policy rows', async () => {
    const zloty = await createSeries(world.scope, seriesInput({ name: 'Rent' }))
    const euro = await createSeries(
      world.scope,
      seriesInput({
        name: 'Hosting',
        expectedAmountMinor: 40_00,
        expectedCurrencyCode: 'EUR',
      }),
    )
    const income = await createSeries(
      world.scope,
      seriesInput({ name: 'Salary', direction: 'income' }),
    )
    await materializeSeries(world.scope, {
      seriesId: zloty.id,
      today: TODAY,
      ahead: 0,
    })
    await materializeSeries(world.scope, {
      seriesId: euro.id,
      today: TODAY,
      ahead: 0,
    })
    const zlotyPeriod = (await listPeriods(world.scope, zloty.id, TODAY)).at(0)
    const euroPeriod = (await listPeriods(world.scope, euro.id, TODAY)).at(0)
    if (zlotyPeriod === undefined || euroPeriod === undefined) {
      throw new Error('no period materialised')
    }

    await linkPayment({
      seriesId: zloty.id,
      transactionId: 'zloty-this-year',
      amountMinor: 250_000,
      bookedOn: '2026-01-31',
      periodStart: zlotyPeriod.periodStart,
    })
    await linkPayment({
      seriesId: euro.id,
      transactionId: 'euro-this-year',
      amountMinor: 40_00,
      bookedOn: '2026-02-01',
      periodStart: euroPeriod.periodStart,
    })
    await world.db
      .update(transactions)
      .set({
        currencyCode: 'EUR',
        refCurrencyCode: 'EUR',
      })
      .where(eq(transactions.id, 'euro-this-year'))

    await linkPayment({
      seriesId: zloty.id,
      transactionId: 'zloty-last-year',
      amountMinor: 250_000,
      bookedOn: '2025-12-31',
    })
    await linkPayment({
      seriesId: zloty.id,
      transactionId: 'zloty-next-year',
      amountMinor: 250_000,
      bookedOn: '2027-01-01',
    })
    await linkPayment({
      seriesId: zloty.id,
      transactionId: 'zloty-other-currency',
      amountMinor: 40_00,
      bookedOn: '2026-02-15',
    })
    await world.db
      .update(transactions)
      .set({ currencyCode: 'EUR', refCurrencyCode: 'EUR' })
      .where(eq(transactions.id, 'zloty-other-currency'))
    await linkPayment({
      seriesId: zloty.id,
      transactionId: 'zloty-planned',
      amountMinor: 10_00,
      bookedOn: '2026-03-01',
    })
    await world.db
      .update(transactions)
      .set({ isPlanned: true })
      .where(eq(transactions.id, 'zloty-planned'))
    await linkPayment({
      seriesId: zloty.id,
      transactionId: 'zloty-adjustment',
      amountMinor: 10_00,
      bookedOn: '2026-03-02',
    })
    await world.db
      .update(transactions)
      .set({ isBalanceAdjustment: true })
      .where(eq(transactions.id, 'zloty-adjustment'))
    await linkPayment({
      seriesId: zloty.id,
      transactionId: 'zloty-transfer',
      amountMinor: 10_00,
      bookedOn: '2026-03-03',
    })
    await world.db
      .update(transactions)
      .set({ transferKind: 'external_out' })
      .where(eq(transactions.id, 'zloty-transfer'))
    await linkPayment({
      seriesId: zloty.id,
      transactionId: 'zloty-unlinked',
      amountMinor: 10_00,
      bookedOn: '2026-03-04',
    })
    await world.db
      .update(recurringLinks)
      .set({ status: 'unlinked' })
      .where(eq(recurringLinks.transactionId, 'zloty-unlinked'))
    await linkPayment({
      seriesId: income.id,
      transactionId: 'income-this-year',
      amountMinor: 8_000_00,
      bookedOn: '2026-03-01',
    })
    await world.db
      .update(transactions)
      .set({ direction: 'income' })
      .where(eq(transactions.id, 'income-this-year'))

    executed.length = 0
    const rows = await sumSeriesSpendThisYear(world.scope, {
      today: TODAY,
      seriesIds: [zloty.id, euro.id, income.id, zloty.id],
    })
    const sql = executed.join('\n')

    expect(rows).toHaveLength(2)
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          seriesId: zloty.id,
          currencyCode: 'PLN',
          spentThisYearMinor: 250_000,
        },
        {
          seriesId: euro.id,
          currencyCode: 'EUR',
          spentThisYearMinor: 40_00,
        },
      ]),
    )
    expect(Number.isInteger(rows[0]?.spentThisYearMinor)).toBe(true)
    expect(sql).toContain('sum(')
    expect(sql).toContain('booked_on')
    expect(sql).toMatch(/organization_id/)
  })

  it('includes the first and last calendar day of the year and returns nothing for no series', async () => {
    const series = await createSeries(world.scope, seriesInput())
    await linkPayment({
      seriesId: series.id,
      transactionId: 'new-years-day',
      amountMinor: 10_00,
      bookedOn: '2026-01-01',
    })
    await linkPayment({
      seriesId: series.id,
      transactionId: 'new-years-eve',
      amountMinor: 20_00,
      bookedOn: '2026-12-31',
    })

    const rows = await sumSeriesSpendThisYear(world.scope, {
      today: '2026-06-15',
      seriesIds: [series.id],
    })
    expect(rows).toEqual([
      {
        seriesId: series.id,
        currencyCode: 'PLN',
        spentThisYearMinor: 30_00,
      },
    ])

    executed.length = 0
    await expect(
      sumSeriesSpendThisYear(world.scope, { today: TODAY, seriesIds: [] }),
    ).resolves.toEqual([])
    expect(executed).toEqual([])
  })
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

  it('refuses a transaction that already settles another period of another series', async () => {
    const rent = await createSeries(world.scope, seriesInput({ name: 'Rent' }))
    const phone = await createSeries(
      world.scope,
      seriesInput({ name: 'Phone', expectedAmountMinor: 50_00 }),
    )
    await materializeSeries(world.scope, {
      seriesId: rent.id,
      today: TODAY,
      ahead: 0,
    })
    await materializeSeries(world.scope, {
      seriesId: phone.id,
      today: TODAY,
      ahead: 0,
    })
    await seedTransaction(world.db, {
      id: 'txn-shared',
      refAmountMinor: 250_000,
      bookedOn: '2026-01-31',
    })
    const rentPeriod = (await listPeriods(world.scope, rent.id, TODAY)).at(0)
    const phonePeriod = (await listPeriods(world.scope, phone.id, TODAY)).at(0)
    if (rentPeriod === undefined || phonePeriod === undefined) {
      throw new Error('no period materialised')
    }

    await markPaid(world.scope, {
      seriesId: rent.id,
      periodStart: rentPeriod.periodStart,
      transactionId: 'txn-shared',
    })
    await expect(
      markPaid(world.scope, {
        seriesId: phone.id,
        periodStart: phonePeriod.periodStart,
        transactionId: 'txn-shared',
      }),
    ).rejects.toBeInstanceOf(RecurringTransactionLinkedError)
    expect((await storedPeriod(phonePeriod)).status).not.toBe('paid')
  })

  it('is idempotent for the same period and the same transaction', async () => {
    const key = await materialisedPeriod()
    await seedTransaction(world.db, {
      id: 'txn-again',
      refAmountMinor: 250_000,
      bookedOn: '2026-01-31',
    })
    await markPaid(world.scope, { ...key, transactionId: 'txn-again' })
    await expect(
      markPaid(world.scope, { ...key, transactionId: 'txn-again' }),
    ).resolves.toBeUndefined()
    expect((await storedPeriod(key)).settledTransactionId).toBe('txn-again')
  })

  it('does not leave a period paid when the link write fails', async () => {
    const key = await materialisedPeriod()
    await seedTransaction(world.db, {
      id: 'txn-atomic',
      refAmountMinor: 250_000,
      bookedOn: '2026-01-31',
    })
    fault.when = (query) => /insert into "recurring_links"/i.test(query)

    await expect(
      markPaid(world.scope, { ...key, transactionId: 'txn-atomic' }),
    ).rejects.toThrow(/injected fault/i)

    fault.when = null
    const period = await storedPeriod(key)
    expect(period.status).not.toBe('paid')
    expect(period.settledTransactionId).toBeNull()
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

describe('the book dimension', () => {
  it('defaults a new series to personal', async () => {
    const series = await createSeries(world.scope, seriesInput())
    expect(series.book).toBe('personal')
  })

  it('lists only the book a caller asked for', async () => {
    await createSeries(
      world.scope,
      seriesInput({ name: 'Office', book: 'business' }),
    )
    await createSeries(
      world.scope,
      seriesInput({ name: 'Rent', book: 'personal' }),
    )

    const business = await listSeries(world.scope, { book: 'business' })
    expect(business.map((row) => row.name)).toEqual(['Office'])
    const personal = await listSeries(world.scope, { book: 'personal' })
    expect(personal.map((row) => row.name)).toEqual(['Rent'])
  })

  it('keeps the other book off the upcoming list', async () => {
    const office = await createSeries(
      world.scope,
      seriesInput({ name: 'Office', book: 'business' }),
    )
    await createSeries(
      world.scope,
      seriesInput({ name: 'Rent', book: 'personal' }),
    )
    await materializeSeries(world.scope, {
      seriesId: office.id,
      today: TODAY,
      ahead: 1,
    })

    const upcoming = await getUpcoming(world.scope, {
      today: TODAY,
      book: 'personal',
    })
    expect(upcoming.every((period) => period.seriesId !== office.id)).toBe(true)
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
    [
      'removeUnpaidOpenPeriods',
      (id: string) => removeUnpaidOpenPeriods(world.scope, id),
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

describe('deleting a transaction that settled a paid period', () => {
  const policies = {
    planned: 'include' as const,
    adjustments: 'include' as const,
    transfers: 'include' as const,
    completeness: 'any' as const,
  }

  it('releases that period and leaves every other period unchanged', async () => {
    const series = await createSeries(world.scope, seriesInput())
    await materializeSeries(world.scope, {
      seriesId: series.id,
      today: TODAY,
      ahead: 0,
    })
    const periods = await listPeriods(world.scope, series.id, TODAY)
    const settled = periods.at(0)
    const other = periods.at(1)
    if (settled === undefined || other === undefined) {
      throw new Error('need two materialised periods')
    }
    await seedTransaction(world.db, {
      id: 'txn-netflix',
      refAmountMinor: 4_999,
      bookedOn: settled.dueOn,
    })
    await markPaid(world.scope, {
      seriesId: series.id,
      periodStart: settled.periodStart,
      transactionId: 'txn-netflix',
    })
    const settledBefore = await storedPeriod({
      seriesId: series.id,
      periodStart: settled.periodStart,
    })
    const otherBefore = await storedPeriod({
      seriesId: series.id,
      periodStart: other.periodStart,
    })
    if (settledBefore === undefined || otherBefore === undefined) {
      throw new Error('period row missing')
    }
    expect(settledBefore.status).toBe('paid')
    expect(settledBefore.settledTransactionId).toBe('txn-netflix')

    executed.length = 0
    await deleteTransaction({
      scope: world.scope,
      policies,
      id: 'txn-netflix',
    })
    const release = executed.filter((query) =>
      /recurring_periods|recurring_links|delete from "transactions"/i.test(
        query,
      ),
    )
    // One batch: the three writes are adjacent, period then link then the delete.
    // Bound values are parameters, so the status words are not in the SQL text.
    expect(release).toHaveLength(3)
    const first = executed.indexOf(release[0] ?? '')
    expect(executed.slice(first, first + 3)).toEqual(release)
    expect(release[0]).toMatch(
      /update "recurring_periods" set "status" = \?, "settled_transaction_id" = \?/,
    )
    expect(release[0]).toContain('"recurring_periods"."organization_id"')
    expect(release[0]).toContain('not exists')
    expect(release[1]).toMatch(/update "recurring_links" set "status" = \?/)
    expect(release[1]).toContain('"recurring_links"."organization_id"')
    expect(release[1]).toContain('not exists')
    expect(release[2]).toMatch(/^delete from "transactions"/)
    expect(release[2]).toContain('"transactions"."organization_id"')
    expect(release[2]).toContain('not exists')

    await expect(
      world.db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.id, 'txn-netflix')),
    ).resolves.toEqual([])
    const settledAfter = await storedPeriod({
      seriesId: series.id,
      periodStart: settled.periodStart,
    })
    expect(settledAfter).toMatchObject({
      status: 'upcoming',
      settledTransactionId: null,
      expectedAmountMinor: settledBefore.expectedAmountMinor,
      expectedCurrencyCode: settledBefore.expectedCurrencyCode,
      dueOn: settledBefore.dueOn,
      periodStart: settledBefore.periodStart,
      seriesId: series.id,
    })
    expect(
      await storedPeriod({
        seriesId: series.id,
        periodStart: other.periodStart,
      }),
    ).toEqual(otherBefore)
    await expect(
      world.db
        .select()
        .from(recurringLinks)
        .where(eq(recurringLinks.transactionId, 'txn-netflix')),
    ).resolves.toEqual([])
  })

  it('leaves the paid period in place when a paid loan instalment refuses the delete', async () => {
    const series = await createSeries(world.scope, seriesInput())
    await materializeSeries(world.scope, {
      seriesId: series.id,
      today: TODAY,
      ahead: 0,
    })
    const period = (await listPeriods(world.scope, series.id, TODAY)).at(0)
    if (period === undefined) throw new Error('no period materialised')
    await seedTransaction(world.db, {
      id: 'txn-both',
      refAmountMinor: 120_00,
      bookedOn: period.dueOn,
    })
    await markPaid(world.scope, {
      seriesId: series.id,
      periodStart: period.periodStart,
      transactionId: 'txn-both',
    })
    const loan = await createLoan(world.scope, {
      name: 'Loan A',
      lender: 'Lender A',
      currencyCode: 'PLN',
      principalMinor: 500_00,
      instalmentMinor: 100_00,
      paymentDay: 20,
      openedOn: '2026-01-15',
      endsOn: '2026-04-20',
      book: 'business',
      kind: 'credit',
      instalments: [{ dueOn: '2026-02-20', amountMinor: 120_00 }],
    })
    await markInstalmentPaid(world.scope, {
      loanId: loan.id,
      sequence: 1,
      transactionId: 'txn-both',
    })
    const before = await storedPeriod({
      seriesId: series.id,
      periodStart: period.periodStart,
    })
    const linkBefore = await world.db
      .select()
      .from(recurringLinks)
      .where(eq(recurringLinks.transactionId, 'txn-both'))

    await expect(
      deleteTransaction({
        scope: world.scope,
        policies,
        id: 'txn-both',
      }),
    ).rejects.toBeInstanceOf(ConflictError)

    expect(
      await storedPeriod({
        seriesId: series.id,
        periodStart: period.periodStart,
      }),
    ).toEqual(before)
    expect(
      await world.db
        .select()
        .from(recurringLinks)
        .where(eq(recurringLinks.transactionId, 'txn-both')),
    ).toEqual(linkBefore)
    await expect(
      world.db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.id, 'txn-both')),
    ).resolves.toEqual([{ id: 'txn-both' }])
  })
})
