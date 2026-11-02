/**
 * The typed boundary between D1 and the rest of the server.
 *
 * Drizzle infers every money column in `./schema` as a plain `number`, because that is what
 * SQLite stores and what the driver returns. A plain `number` is also what a major-unit float is,
 * and the two are indistinguishable to the compiler — which is the exact bug `src/lib/money`
 * exists to make unrepresentable: an amount off by a factor of a hundred, silent, discovered by a
 * person reconciling a bank statement.
 *
 * This module closes that hole at the one place it opens: the row a repository has just read.
 * {@link BrandMoney} rewrites the money-shaped fields of an inferred row to the branded scalars,
 * so a repository that hands a row outward hands out `Minor` and `RateE10`, and arithmetic on it
 * has to go through `src/lib/money`.
 *
 * **The branding is a claim, and the repository is what makes it true.** A cast is not a check:
 * the value has to have come from a column the schema constrains (`amount_minor > 0`,
 * `rate_e10 > 0`) and the repository re-parses its input with Zod before it writes, which is what
 * this file's types assume on the way back out. Nothing here validates at runtime; nothing here
 * should.
 *
 * Column-shape convention, and the whole of the rule these types encode:
 * - a field named `…Minor` is an integer count of minor units in some currency's own scale
 *   (`currencies.digits`, never a hard-coded 2), and becomes `Minor`;
 * - a field named `rateE10` is a rate × 10^10, and becomes `RateE10`;
 * - every other field passes through untouched.
 *
 * Naming a column `somethingMinor` therefore has a type consequence, which is the point: the
 * convention is enforced by the compiler rather than by a reviewer noticing.
 */

import type { Minor, RateE10 } from '#/lib/money'

import type {
  accountBalances,
  accounts,
  budgetPeriods,
  budgets,
  exchangeRates,
  organizationExchangeRates,
  recurringCandidates,
  recurringPeriods,
  recurringSeries,
  refunds,
  loanInstalments,
  loans,
  savingsGoals,
  subscriptions,
  tagReminders,
  transactionSplits,
  transactionTemplates,
  transactions,
} from './schema'

/**
 * Rewrite the money-shaped fields of an inferred row to their branded scalars.
 *
 * Nullability is preserved: a nullable `credit_limit_minor` stays `Minor | null`, so "this
 * account has no limit" and "this account's limit is zero" remain different values. Everything
 * else — ids, dates, flags, JSON text — is passed through unchanged.
 */
export type BrandMoney<TRow> = {
  [K in keyof TRow]: K extends `${string}Minor`
    ? null extends TRow[K]
      ? Minor | null
      : Minor
    : K extends 'rateE10'
      ? null extends TRow[K]
        ? RateE10 | null
        : RateE10
      : TRow[K]
}

/* -------------------------------------------------------------------------- */
/* Branded rows — every table whose row carries an amount or a rate           */
/* -------------------------------------------------------------------------- */

/** A transaction as the repositories hand it out: amounts branded, rate branded. */
export type Transaction = BrandMoney<typeof transactions.$inferSelect>

/** One line of a split receipt. Its amounts sum to the parent's, asserted in the repository. */
export type TransactionSplit = BrandMoney<typeof transactionSplits.$inferSelect>

/** A saved shape. Its amount is nullable — half a template's value is "you type the number". */
export type TransactionTemplate = BrandMoney<
  typeof transactionTemplates.$inferSelect
>

/** An account, with its four balance columns and its optional credit limit branded. */
export type Account = BrandMoney<typeof accounts.$inferSelect>

/** One day of one account's balance grid. Sparse: a repeated value is omitted, not stored. */
export type AccountBalance = BrandMoney<typeof accountBalances.$inferSelect>

/** A refund link and the amount that came back. */
export type Refund = BrandMoney<typeof refunds.$inferSelect>

/** An envelope. */
export type Budget = BrandMoney<typeof budgets.$inferSelect>

/** A materialised budget period. `carriedInMinor` is signed and, once closed, frozen. */
export type BudgetPeriod = BrandMoney<typeof budgetPeriods.$inferSelect>

/** A repeating expectation. */
export type RecurringSeries = BrandMoney<typeof recurringSeries.$inferSelect>

/** One materialised occurrence of a series. */
export type RecurringPeriod = BrandMoney<typeof recurringPeriods.$inferSelect>

/** A detected-from-history proposal, with its evidence. */
export type RecurringCandidate = BrandMoney<
  typeof recurringCandidates.$inferSelect
>

/** A savings goal. `contributedMinor` is a cache; the contribution links are the authority. */
export type SavingsGoal = BrandMoney<typeof savingsGoals.$inferSelect>

/** A borrowing in the register. `ref_*` amounts are historical; `annualRateE10` is not an FX rate. */
export type Loan = BrandMoney<typeof loans.$inferSelect>

/** One scheduled payment. Paid only by pointing at a transaction. */
export type LoanInstalment = BrandMoney<typeof loanInstalments.$inferSelect>

/** A tag reminder's threshold, which is an amount and so carries its own currency. */
export type TagReminder = BrandMoney<typeof tagReminders.$inferSelect>

/** A catalog rate for one ordered pair on one UTC day. */
export type ExchangeRate = BrandMoney<typeof exchangeRates.$inferSelect>

/** A workspace's own rate, valid over a range of days rather than at a point. */
export type OrganizationExchangeRate = BrandMoney<
  typeof organizationExchangeRates.$inferSelect
>

/**
 * The Polar mirror.
 *
 * `unitAmountMinor` is branded like any other amount, but it is the **provider's** number: no
 * path converts it to the workspace base currency, because a price is not a transaction.
 */
export type Subscription = BrandMoney<typeof subscriptions.$inferSelect>
