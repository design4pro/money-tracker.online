import { describe, expect, it } from 'vitest'

import { asCurrencyCode, asMinor } from '#/lib/money'

import { expectedTotals } from '../expectation-totals'

import type { ExpectationRow } from '../types'

/**
 * The expected figures under the group: a sum of expectations among themselves, one line per
 * currency. It never touches a ledger total and never converts, so two currencies are two lines.
 */

function row(
  direction: 'income' | 'expense',
  amount: number,
  currency: string,
  id = `${direction}-${amount}-${currency}`,
): ExpectationRow {
  return {
    kind: 'expectation',
    id,
    seriesId: id,
    periodStart: '2026-10-01',
    seriesName: id,
    direction,
    expectedAmountMinor: asMinor(amount),
    currencyCode: asCurrencyCode(currency),
    dueOn: '2026-10-01',
    status: 'upcoming',
    accountId: null,
    categoryId: null,
    payeeId: null,
  }
}

describe('expectedTotals', () => {
  it('is empty for no rows', () => {
    expect(expectedTotals([])).toEqual([])
  })

  it('keeps income and expense apart, never netting them', () => {
    expect(
      expectedTotals([
        row('income', 500_000, 'PLN'),
        row('expense', 12_345, 'PLN'),
        row('expense', 5_000, 'PLN'),
      ]),
    ).toEqual([{ currencyCode: 'PLN', inMinor: 500_000, outMinor: 17_345 }])
  })

  it('gives each currency its own line, ordered by code, without converting', () => {
    expect(
      expectedTotals([
        row('expense', 1_000, 'USD'),
        row('expense', 2_000, 'EUR'),
        row('income', 300, 'JPY'),
      ]),
    ).toEqual([
      { currencyCode: 'EUR', inMinor: 0, outMinor: 2_000 },
      { currencyCode: 'JPY', inMinor: 300, outMinor: 0 },
      { currencyCode: 'USD', inMinor: 0, outMinor: 1_000 },
    ])
  })
})
