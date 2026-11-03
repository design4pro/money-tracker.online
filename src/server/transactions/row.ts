/**
 * Brands a transaction row's money columns on the way out of a repository.
 *
 * The claim `#/server/db/types` makes — that a repository hands out `Minor` and `RateE10` rather
 * than bare `number` — is made true here, and it is a check rather than a cast: a column that
 * somehow holds a non-integer throws at the boundary instead of becoming a float two layers up.
 *
 * Lives next to conversion, not inside the transactions table repository, so accounts, budgets,
 * goals and transfers can brand a row without depending on the write path.
 */

import { asMinor, asRateE10 } from '#/lib/money'

import type { Transaction } from '#/server/db/types'
import type { transactions } from '#/server/db/schema'

export function toTransaction(
  row: typeof transactions.$inferSelect,
): Transaction {
  return {
    ...row,
    amountMinor: asMinor(row.amountMinor),
    refAmountMinor: asMinor(row.refAmountMinor),
    rateE10: asRateE10(row.rateE10),
  }
}
