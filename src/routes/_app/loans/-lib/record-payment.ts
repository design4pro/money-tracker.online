import { getLocalTimeZone, today } from '@internationalized/date'

import type { NewTransactionSearch } from '#/routes/_app/transactions/-lib/new-search'
import type { InstalmentView, Loan } from '#/server/repos/loans'

/**
 * The route out of an empty liability settle picker: the entry form, started from the instalment.
 *
 * The result is search params for `/transactions/new`. Navigating there creates nothing — the
 * person still presses Save. The picker never mints money (`settle-dialog.tsx`).
 *
 * A due date after today is left out: a settled entry may not be dated in the future
 * (`docs/MONEY.md` §6.1), and carrying it would open the form already refusing. A null
 * `account_id` is omitted, never replaced with a default.
 *
 * `returnTo=loan` plus the loan id and sequence is the closed way back: after Save the form
 * reopens this instalment's picker so the new entry can be pointed at.
 */

export function recordLoanPaymentSearch(
  loan: Pick<Loan, 'id' | 'accountId'>,
  instalment: Pick<
    InstalmentView,
    'sequence' | 'dueOn' | 'amountMinor' | 'currencyCode'
  >,
  todayIso: string = today(getLocalTimeZone()).toString(),
): NewTransactionSearch {
  return {
    direction: 'expense',
    amount: instalment.amountMinor,
    currency: instalment.currencyCode,
    ...(instalment.dueOn > todayIso ? {} : { date: instalment.dueOn }),
    ...(loan.accountId === null ? {} : { account: loan.accountId }),
    returnTo: 'loan',
    returnLoan: loan.id,
    returnSequence: instalment.sequence,
  }
}
