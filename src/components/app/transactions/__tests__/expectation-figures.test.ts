import { describe, expect, it } from 'vitest'

import { asCurrencyCode, asMinor } from '#/lib/money'

import { expectedFiguresByCurrency } from '../expectation-figures'

import type { ExpectationRow } from '../types'

/**
 * The expected figures are a pure function of the rows the group lists: each currency sums in its
 * own scale, income and expense stay two figures, and nothing is converted or netted.
 */

function row(
  over: Partial<ExpectationRow> & {
    currency: string
    amount: number
    direction: ExpectationRow['direction']
  },
): ExpectationRow {
  const { currency, amount, ...rest } = over
  return {
    kind: 'expectation',
    id: `ser-${currency}-${amount}:2026-10-10`,
    seriesId: `ser-${currency}-${amount}`,
    periodStart: '2026-10-10',
    seriesName: 'Series',
    expectedAmountMinor: asMinor(amount),
    currencyCode: asCurrencyCode(currency),
    dueOn: '2026-10-10',
    status: 'upcoming',
    accountId: null,
    categoryId: null,
    payeeId: null,
    ...rest,
  }
}

const figure = (
  currencyCode: string,
  direction: 'income' | 'expense',
  amountMinor: number,
) => ({
  currencyCode: asCurrencyCode(currencyCode),
  direction,
  amountMinor: asMinor(amountMinor),
})

describe('expectedFiguresByCurrency', () => {
  it('is empty for no rows', () => {
    expect(expectedFiguresByCurrency([])).toEqual([])
  })

  it('draws one line per currency and never converts between them', () => {
    expect(
      expectedFiguresByCurrency([
        row({ currency: 'PLN', amount: 120_000, direction: 'expense' }),
        row({ currency: 'EUR', amount: 8_900, direction: 'expense' }),
        row({ currency: 'PLN', amount: 30_050, direction: 'expense' }),
      ]),
    ).toEqual([
      figure('EUR', 'expense', 8_900),
      figure('PLN', 'expense', 150_050),
    ])
  })

  it('keeps income and expense of one currency as two figures, income first, never netted', () => {
    expect(
      expectedFiguresByCurrency([
        row({ currency: 'PLN', amount: 500, direction: 'expense' }),
        row({ currency: 'PLN', amount: 700, direction: 'income' }),
        row({ currency: 'PLN', amount: 100, direction: 'income' }),
      ]),
    ).toEqual([figure('PLN', 'income', 800), figure('PLN', 'expense', 500)])
  })

  it('draws no zero line for a direction a currency does not have', () => {
    const figures = expectedFiguresByCurrency([
      row({ currency: 'PLN', amount: 500, direction: 'income' }),
    ])

    expect(figures).toEqual([figure('PLN', 'income', 500)])
  })

  it('sums each currency in its own scale: 0, 2 and 3 minor-unit digits side by side', () => {
    // JPY has no minor unit, KWD has three; the sum is over integer minor units whatever the scale,
    // so the three never leak into one another.
    expect(
      expectedFiguresByCurrency([
        row({ currency: 'KWD', amount: 1_500, direction: 'expense' }),
        row({ currency: 'JPY', amount: 3_000, direction: 'expense' }),
        row({ currency: 'PLN', amount: 1_050, direction: 'expense' }),
        row({ currency: 'KWD', amount: 250, direction: 'expense' }),
        row({ currency: 'JPY', amount: 2_000, direction: 'expense' }),
      ]),
    ).toEqual([
      figure('JPY', 'expense', 5_000),
      figure('KWD', 'expense', 1_750),
      figure('PLN', 'expense', 1_050),
    ])
  })

  it('orders lines by currency code ascending whatever order the rows come in', () => {
    const rows = [
      row({ currency: 'USD', amount: 1, direction: 'income' }),
      row({ currency: 'EUR', amount: 1, direction: 'income' }),
      row({ currency: 'PLN', amount: 1, direction: 'income' }),
    ]

    expect(
      expectedFiguresByCurrency(rows).map((line) => line.currencyCode),
    ).toEqual(['EUR', 'PLN', 'USD'])
    expect(
      expectedFiguresByCurrency([...rows].reverse()).map(
        (line) => line.currencyCode,
      ),
    ).toEqual(['EUR', 'PLN', 'USD'])
  })

  it('drops the currency whose sum overflows instead of throwing, and keeps the others', () => {
    const figures = expectedFiguresByCurrency([
      row({
        currency: 'PLN',
        amount: Number.MAX_SAFE_INTEGER,
        direction: 'expense',
      }),
      row({ currency: 'PLN', amount: 1, direction: 'expense' }),
      row({ currency: 'PLN', amount: 7, direction: 'income' }),
      row({ currency: 'EUR', amount: 8_900, direction: 'expense' }),
    ])

    expect(figures).toEqual([figure('EUR', 'expense', 8_900)])
  })

  it('keeps a sum that lands exactly on the largest safe integer', () => {
    expect(
      expectedFiguresByCurrency([
        row({
          currency: 'PLN',
          amount: Number.MAX_SAFE_INTEGER - 1,
          direction: 'expense',
        }),
        row({ currency: 'PLN', amount: 1, direction: 'expense' }),
      ]),
    ).toEqual([figure('PLN', 'expense', Number.MAX_SAFE_INTEGER)])
  })
})
