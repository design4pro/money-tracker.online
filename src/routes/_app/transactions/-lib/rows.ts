/**
 * The one place a stored transaction becomes a row the ledger draws.
 *
 * `src/components/app/transactions` deliberately does not know what a D1 column looks like — it
 * renders `LedgerRow`, which is a description of what a person reads rather than of what the
 * database holds. The two overlap today and will not tomorrow (a split, a transfer pair and an
 * attachment count all belong on the row and none of them are columns), and translating once, here
 * at the route boundary, is what stops the list from growing an opinion about the schema.
 *
 * ## The three text columns are narrowed rather than cast
 *
 * `direction`, `payment_method` and `transfer_kind` are `text` in SQLite, so what comes back is a
 * `string` and a cast would be a promise rather than a check. Each is matched against the tuple the
 * screen renders from; a value the screen has no rendering for falls back to the neutral one rather
 * than reaching a `switch` that has no case for it. A row written by a future migration therefore
 * draws as an ordinary expense instead of blanking a cell.
 *
 * The money brands survive: `amountMinor`, `refAmountMinor` and `rateE10` are already branded by the
 * repository, so no arithmetic happens on this path and none can.
 */

import {
  LEDGER_DIRECTIONS,
  LEDGER_PAYMENT_METHODS,
  LEDGER_TRANSFER_KINDS,
} from '#/components/app/transactions'
import { asCurrencyCode } from '#/lib/money'

import type {
  ExpectationRow,
  LedgerDirection,
  LedgerPaymentMethod,
  LedgerRow,
  LedgerTransferKind,
} from '#/components/app/transactions'
import type { Transaction } from '#/server/db/types'
import type { UpcomingPeriod } from '#/server/repos/recurring'

function memberOf<T extends string>(
  vocabulary: ReadonlyArray<T>,
  value: string | null,
  fallback: T,
): T {
  return value !== null && (vocabulary as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : fallback
}

export function toLedgerRow(row: Transaction): LedgerRow {
  const paymentMethod: LedgerPaymentMethod | null =
    row.paymentMethod === null
      ? null
      : memberOf(LEDGER_PAYMENT_METHODS, row.paymentMethod, 'other')

  return {
    kind: 'transaction',
    id: row.id,
    direction: memberOf<LedgerDirection>(
      LEDGER_DIRECTIONS,
      row.direction,
      'expense',
    ),
    amountMinor: row.amountMinor,
    currencyCode: asCurrencyCode(row.currencyCode),
    refAmountMinor: row.refAmountMinor,
    refCurrencyCode: asCurrencyCode(row.refCurrencyCode),
    rateE10: row.rateE10,
    bookedOn: row.bookedOn,
    accountId: row.accountId,
    categoryId: row.categoryId,
    payeeId: row.payeeId,
    note: row.note,
    paymentMethod,
    isPlanned: row.isPlanned,
    isBalanceAdjustment: row.isBalanceAdjustment,
    excludeFromStats: row.excludeFromStats,
    transferKind: memberOf<LedgerTransferKind>(
      LEDGER_TRANSFER_KINDS,
      row.transferKind,
      'none',
    ),
  }
}

/**
 * An unsettled recurring period as the planned screen draws it, and the only place one is built.
 *
 * The row carries the series' own amount and currency and nothing else about money: no reference
 * amount, no rate, no conversion (see {@link ExpectationRow}). `status` is what **today** says
 * (`derivedStatus`), not the value the row stored. The read this is fed by returns unsettled
 * periods only, so `paid` and `skipped` cannot arrive; anything that is not `overdue` draws as
 * `upcoming` rather than reaching a branch with no rendering for it.
 */
export function toExpectationRow(period: UpcomingPeriod): ExpectationRow {
  return {
    kind: 'expectation',
    id: `${period.seriesId}:${period.periodStart}`,
    seriesId: period.seriesId,
    periodStart: period.periodStart,
    seriesName: period.seriesName,
    direction: memberOf<LedgerDirection>(
      LEDGER_DIRECTIONS,
      period.direction,
      'expense',
    ),
    expectedAmountMinor: period.expectedAmountMinor,
    currencyCode: asCurrencyCode(period.expectedCurrencyCode),
    dueOn: period.dueOn,
    status: period.derivedStatus === 'overdue' ? 'overdue' : 'upcoming',
    accountId: period.accountId,
    categoryId: period.categoryId,
    payeeId: period.payeeId,
  }
}
