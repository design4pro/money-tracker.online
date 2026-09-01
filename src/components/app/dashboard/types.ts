import type { DashboardPeriod, PeriodRange } from './period'
import type { CurrencyCode, Minor } from '#/lib/money'

/**
 * The view models the dashboard widgets take.
 *
 * They are **not** repository rows. Everything here is already tenant-scoped, already converted to
 * the workspace base currency where a total demands one, and already reduced to what a widget
 * draws — which is what keeps `src/components/app/dashboard/**` free of any import from
 * `src/server`, and what lets every widget be rendered from a fixture in a test.
 *
 * Two money rules survive into this layer intact:
 *
 * - every amount is an integer `Minor` with the currency it is denominated in beside it;
 * - a row keeps **both** its own currency and its base-currency equivalent, because the recent
 *   list shows the transaction's own amount and the totals sum the base one, and collapsing them
 *   here is how two surfaces start disagreeing about the same row.
 */

/** One month of the cash-flow chart. Always present for every month in the range, zeros included. */
export interface CashFlowBucket {
  /** The month's first day, `YYYY-MM-DD`. Stable identity for the chart and the table. */
  readonly key: string
  readonly incomeMinor: Minor
  /** A **positive magnitude**. Money out is a direction, not a negative income. */
  readonly expenseMinor: Minor
  /** Income less expense. Signed, and the only figure here that may be negative. */
  readonly netMinor: Minor
}

/** One account, as the balances widget shows it. */
export interface DashboardAccount {
  readonly id: string
  readonly name: string
  /** The balance in the account's own currency — what the person's bank app says. */
  readonly balanceMinor: Minor
  readonly currencyCode: CurrencyCode
  /**
   * The same balance in the workspace base currency, taken from the account's **stored** `ref`
   * figure. Never a live conversion: the widget's total has to equal the accounts screen's total.
   */
  readonly refBalanceMinor: Minor
  /** Credit cards and loans, which the header files under what is owed rather than what is held. */
  readonly isLiability: boolean
}

/** One row of the recent-transactions widget. */
export interface DashboardTransaction {
  readonly id: string
  /** Calendar date, `YYYY-MM-DD`. */
  readonly bookedOn: string
  /** What the row is called: the payee, or the note, or the account. Resolved by the loader. */
  readonly title: string
  readonly direction: 'income' | 'expense'
  /** The amount in the transaction's own currency — the figure the person entered. */
  readonly amountMinor: Minor
  readonly currencyCode: CurrencyCode
  /** The stored base-currency equivalent, shown beneath when the two currencies differ. */
  readonly refAmountMinor: Minor
}

/** One slice of the spending donut. */
export interface CategorySpend {
  readonly id: string
  readonly label: string
  readonly amountMinor: Minor
}

/** What the whole dashboard is drawn from. One loader, one shape. */
export interface DashboardData {
  /** Everything denominated in the base currency uses this code. */
  readonly baseCurrencyCode: CurrencyCode
  readonly period: DashboardPeriod
  readonly range: PeriodRange
  /**
   * Whether this workspace has anything at all. Derived from counts in the loader, never stored:
   * a flag would drift the moment somebody deleted their last account.
   */
  readonly hasData: boolean
  /** What is held, what is owed and the difference. All in the base currency. */
  readonly netWorth: {
    readonly totalBalanceMinor: Minor
    readonly liabilitiesMinor: Minor
    readonly netWorthMinor: Minor
  }
  readonly cashFlow: {
    readonly buckets: ReadonlyArray<CashFlowBucket>
    readonly incomeMinor: Minor
    readonly expenseMinor: Minor
    readonly netMinor: Minor
  }
  readonly accounts: ReadonlyArray<DashboardAccount>
  readonly recent: ReadonlyArray<DashboardTransaction>
  /**
   * Spending grouped by category, largest first.
   *
   * Empty until the classification repository (plan 08) lands: the dashboard **invents no data**,
   * and a widget with no source renders its designed empty state rather than a fabricated one.
   */
  readonly spending: ReadonlyArray<CategorySpend>
}
