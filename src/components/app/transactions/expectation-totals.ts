import { asMinor } from '#/lib/money'

import type { CurrencyCode, Minor } from '#/lib/money'
import type { ExpectationRow } from './types'

/** What is expected in and out in one currency. */
export interface ExpectedTotal {
  readonly currencyCode: CurrencyCode
  readonly inMinor: Minor
  readonly outMinor: Minor
}

/**
 * The expected figures of the group, one line per currency.
 *
 * Integer addition of the series' own minor units and nothing else: an expectation has no
 * reference amount, so there is no rate to convert with, and it is never added to a ledger total.
 * Income and expense stay apart - netting them would present a plan as a balance - and the lines
 * are ordered by code so the same group reads the same on every render.
 */
export function expectedTotals(
  rows: ReadonlyArray<ExpectationRow>,
): ReadonlyArray<ExpectedTotal> {
  const byCurrency = new Map<
    CurrencyCode,
    { inMinor: number; outMinor: number }
  >()
  for (const row of rows) {
    const line = byCurrency.get(row.currencyCode) ?? { inMinor: 0, outMinor: 0 }
    if (row.direction === 'income') {
      line.inMinor += row.expectedAmountMinor
    } else {
      line.outMinor += row.expectedAmountMinor
    }
    byCurrency.set(row.currencyCode, line)
  }
  return [...byCurrency.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currencyCode, line]) => ({
      currencyCode,
      inMinor: asMinor(line.inMinor),
      outMinor: asMinor(line.outMinor),
    }))
}
