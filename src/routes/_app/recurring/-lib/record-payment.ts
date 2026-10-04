import type { NewTransactionSearch } from '#/routes/_app/transactions/-lib/new-search'
import type { RecurringSeries } from '#/server/db/types'
import type { PeriodView } from '#/server/repos/recurring'

/**
 * The route out of an empty mark-paid picker: the entry form, started from the period.
 *
 * ## It describes a payment; it never records one
 *
 * The result is a set of search params for `/transactions/new`. Navigating there creates nothing -
 * the person reads the form and presses Save, which is the only way a transaction comes into being
 * and the reason the mark-paid dialog can keep its refusal to create (see `mark-paid-dialog.tsx`).
 *
 * ## What the series does not have, the form is left to ask for
 *
 * `account_id`, `category_id` and `payee_id` on a series are `onDelete: 'set null'`, so any of them
 * can be `null`. A `null` is **omitted**, never replaced with a default: the form then shows the
 * state it shows for an entry typed from scratch, which is honest about what is known.
 *
 * ## The amount is the period's expectation, in the period's own currency
 *
 * Integer minor units as the period holds them - no division, no scale of two. Whether it fits the
 * account the form lands on is decided by the form's own `applyPrefill`, which leaves it empty when
 * the currencies differ.
 */

export type RecordPaymentOrigin = 'series' | 'list'

export function recordPaymentSearch(
  series: Pick<
    RecurringSeries,
    'id' | 'direction' | 'accountId' | 'categoryId' | 'payeeId'
  >,
  period: Pick<
    PeriodView,
    'periodStart' | 'dueOn' | 'expectedAmountMinor' | 'expectedCurrencyCode'
  >,
  origin: RecordPaymentOrigin,
): NewTransactionSearch {
  return {
    direction: series.direction === 'income' ? 'income' : 'expense',
    amount: period.expectedAmountMinor,
    currency: period.expectedCurrencyCode,
    date: period.dueOn,
    ...(series.accountId === null ? {} : { account: series.accountId }),
    ...(series.categoryId === null ? {} : { category: series.categoryId }),
    ...(series.payeeId === null ? {} : { payee: series.payeeId }),
    returnTo: origin,
    returnSeries: series.id,
    returnPeriod: period.periodStart,
  }
}
