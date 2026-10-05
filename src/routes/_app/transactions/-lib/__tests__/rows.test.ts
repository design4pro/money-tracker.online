import { describe, expect, it } from 'vitest'

import { asMinor } from '#/lib/money'

import { toExpectationRow } from '../rows'

import type { UpcomingPeriod } from '#/server/repos/recurring'

/**
 * `toExpectationRow` is where an unsettled recurring period becomes a row the planned screen draws,
 * and the properties below are the ones that keep an expectation from being mistaken for money:
 * it has no reference amount, no reference currency and no rate - the row type has no field for
 * them, so the compiler refuses a sum - and it keeps the series' own currency.
 */

function upcoming(over: Partial<UpcomingPeriod> = {}): UpcomingPeriod {
  return {
    seriesId: 'ser-1',
    periodStart: '2026-04-01',
    dueOn: '2026-04-10',
    status: 'upcoming',
    derivedStatus: 'upcoming',
    expectedAmountMinor: asMinor(250_000),
    expectedCurrencyCode: 'PLN',
    settledTransactionId: null,
    settledAmountMinor: null,
    settledCurrencyCode: null,
    settledOn: null,
    seriesName: 'Rent',
    seriesKind: 'bill',
    direction: 'expense',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    payeeId: 'pay-1',
    ...over,
  }
}

describe('toExpectationRow', () => {
  it('carries no reference amount, no reference currency and no rate', () => {
    const row = toExpectationRow(upcoming())

    expect(Object.keys(row)).not.toContain('refAmountMinor')
    expect(Object.keys(row)).not.toContain('refCurrencyCode')
    expect(Object.keys(row)).not.toContain('rateE10')
    expect(row.kind).toBe('expectation')
  })

  it('keeps the amount and the currency of the series, in minor units', () => {
    const row = toExpectationRow(
      upcoming({
        expectedAmountMinor: asMinor(1_234_567),
        expectedCurrencyCode: 'KWD',
      }),
    )

    expect(row.expectedAmountMinor).toBe(1_234_567)
    expect(row.currencyCode).toBe('KWD')
  })

  it('names the row by its natural key, which no transaction id can equal', () => {
    const row = toExpectationRow(upcoming())

    expect(row.id).toBe('ser-1:2026-04-01')
    expect(row.seriesId).toBe('ser-1')
    expect(row.periodStart).toBe('2026-04-01')
  })

  it('maps the status the day derived, not the one the row stored', () => {
    expect(
      toExpectationRow(
        upcoming({ status: 'upcoming', derivedStatus: 'overdue' }),
      ).status,
    ).toBe('overdue')
    expect(
      toExpectationRow(
        upcoming({ status: 'overdue', derivedStatus: 'upcoming' }),
      ).status,
    ).toBe('upcoming')
  })

  it('keeps a missing link as null rather than inventing one', () => {
    const row = toExpectationRow(
      upcoming({ accountId: null, categoryId: null, payeeId: null }),
    )

    expect(row.accountId).toBeNull()
    expect(row.categoryId).toBeNull()
    expect(row.payeeId).toBeNull()
  })

  it('keeps the direction of the series and the due date as a calendar date', () => {
    const row = toExpectationRow(
      upcoming({ direction: 'income', dueOn: '2026-05-31' }),
    )

    expect(row.direction).toBe('income')
    expect(row.dueOn).toBe('2026-05-31')
  })
})
