import { MoneyOverflowError, sumMinor } from '#/lib/money'

import type { CurrencyCode, Minor } from '#/lib/money'
import type { ExpectationRow } from './types'

/** One expected figure: what the listed rows of one currency and one direction add up to. */
export interface ExpectedFigure {
  readonly currencyCode: CurrencyCode
  readonly direction: ExpectationRow['direction']
  /** Strictly positive, integer minor units at {@link currencyCode}'s own scale. */
  readonly amountMinor: Minor
}

const DIRECTIONS = ['income', 'expense'] as const

/**
 * What the expected group adds up to, per currency and per direction.
 *
 * ## Exactly the rows the group lists
 *
 * The sum is over the rows it is handed, so the figures and the table beside them cannot disagree,
 * and a capped group's figures cover the listed rows only. It is a function of the view model and
 * nothing is read from the server for it.
 *
 * ## Never converted, never netted
 *
 * An expectation has no reference amount and no rate until it settles (`ExpectationRow`), so a
 * currency is summed in its own integer minor units, whatever its `currencies.digits`, and two
 * currencies are two lines. Income and expense of one currency are two figures; a direction a
 * currency does not have draws no zero line.
 *
 * ## An overflow omits the currency
 *
 * `sumMinor` throws {@link MoneyOverflowError} rather than return a rounded total. A screen must
 * not crash on it and must not draw one direction of a currency whose other direction is unknown,
 * so the whole currency is left out.
 *
 * Ordered by currency code ascending, income before expense: the order does not depend on the order
 * of the rows, which depends on due dates.
 */
export function expectedFiguresByCurrency(
  rows: ReadonlyArray<ExpectationRow>,
): ReadonlyArray<ExpectedFigure> {
  const byCurrency = new Map<CurrencyCode, Array<ExpectationRow>>()
  for (const row of rows) {
    const bucket = byCurrency.get(row.currencyCode)
    if (bucket === undefined) {
      byCurrency.set(row.currencyCode, [row])
    } else {
      bucket.push(row)
    }
  }

  const figures: Array<ExpectedFigure> = []
  const codes = [...byCurrency.keys()].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  for (const currencyCode of codes) {
    const bucket = byCurrency.get(currencyCode) ?? []
    try {
      const currencyFigures = DIRECTIONS.flatMap((direction) => {
        const amounts = bucket
          .filter((row) => row.direction === direction)
          .map((row) => row.expectedAmountMinor)
        return amounts.length === 0
          ? []
          : [{ currencyCode, direction, amountMinor: sumMinor(amounts) }]
      })
      figures.push(...currencyFigures)
    } catch (error) {
      if (!(error instanceof MoneyOverflowError)) {
        throw error
      }
    }
  }
  return figures
}
