/**
 * Adopting a real transaction into the period it settled.
 *
 * **It links; it never creates, and it never corrects.** A matched transaction keeps the amount it
 * was entered with — matching is an act of recognition, not of arithmetic, and a matcher that
 * "fixed" a 47 zł bill to the 43 zł the series expected would be quietly rewriting what a person
 * actually paid. The variance between the two is the point, not a defect to be tidied away.
 *
 * **The tolerance is an integer window in minor units, never a percentage.** Five per cent of a
 * 12 zł subscription is 60 grosz and five per cent of a 4 000 zł instalment is 200 zł; the second
 * window is wide enough to adopt an unrelated transaction, and a rule whose strictness depends on
 * the size of the bill is a rule nobody can reason about.
 *
 * **It adopts the earliest unpaid period.** Somebody who pays a missed March bill in April has
 * paid March. Adopting into the newest open period instead is how a series stays exactly one month
 * behind for the rest of its life while every screen shows it as up to date.
 *
 * **Currencies are never compared across.** A 43 EUR transaction does not settle a 43 PLN
 * expectation, and converting one to check would make the match depend on the day's rate.
 */

import { z } from 'zod'

import {
  getMatchableTransaction,
  listOpenPeriodRows,
  listSeries,
  markPaid,
  readMatchingRules,
  stampRecurringOrigin,
} from '#/server/repos/recurring'

import type { MatchingRules } from '#/server/repos/recurring'
import type { TenantScope } from '#/server/repos/base'

/** The facts a rule is tried against. Deliberately not a database row. */
export interface MatchSubject {
  readonly accountId: string
  readonly payeeId: string | null
  readonly payeeName: string | null
  readonly direction: string
  readonly amountMinor: number
  readonly currencyCode: string
  readonly bookedOn: string
  readonly note: string | null
}

/** What a series brings to the comparison. */
export interface MatchSeries {
  readonly id: string
  readonly direction: string
  readonly expectedAmountMinor: number
  readonly expectedCurrencyCode: string
  readonly accountId: string | null
  readonly payeeId: string | null
}

/** Which of the four tests failed, when one did. Reported so a person can be told why. */
export type MatchRejection =
  'direction' | 'currency' | 'account' | 'payee' | 'amount' | 'window'

export type MatchVerdict =
  | { readonly matched: true }
  | { readonly matched: false; readonly because: MatchRejection }

/**
 * Does this transaction settle this period of this series?
 *
 * Pure: no scope, no database, no clock. Every branch below is one of the plan's four rule
 * dimensions — payee, amount tolerance, account, day window — plus the two structural refusals
 * (direction and currency) that are not negotiable by a rule at all.
 */
export function matchesPeriod(input: {
  readonly series: MatchSeries
  readonly rules: MatchingRules
  readonly transaction: MatchSubject
  readonly dueOn: string
}): MatchVerdict {
  const { series, rules, transaction, dueOn } = input

  if (transaction.direction !== series.direction) {
    return { matched: false, because: 'direction' }
  }
  if (transaction.currencyCode !== series.expectedCurrencyCode) {
    return { matched: false, because: 'currency' }
  }

  const account = rules.accountId ?? series.accountId
  if (account !== null && transaction.accountId !== account) {
    return { matched: false, because: 'account' }
  }

  if (!payeeAgrees(rules, series, transaction)) {
    return { matched: false, because: 'payee' }
  }

  // Integer arithmetic on integer minor units, both sides in the same currency by the check above.
  const drift = Math.abs(transaction.amountMinor - series.expectedAmountMinor)
  if (drift > rules.amountToleranceMinor) {
    return { matched: false, because: 'amount' }
  }

  if (Math.abs(daysBetween(transaction.bookedOn, dueOn)) > rules.dayWindow) {
    return { matched: false, because: 'window' }
  }

  return { matched: true }
}

/**
 * The payee test, in the order a person would apply it.
 *
 * Named substrings win when the rule states any: they are what somebody typed, and they are tried
 * against the payee's name *and* the note, because a bank export frequently has the merchant only
 * in the description. With no substrings the series' own payee is the test, and with neither the
 * dimension simply does not constrain anything.
 */
function payeeAgrees(
  rules: MatchingRules,
  series: MatchSeries,
  transaction: MatchSubject,
): boolean {
  if (rules.payee.length > 0) {
    const haystack =
      `${transaction.payeeName ?? ''} ${transaction.note ?? ''}`.toLowerCase()
    return rules.payee.some((needle) => haystack.includes(needle.toLowerCase()))
  }
  if (series.payeeId !== null) return transaction.payeeId === series.payeeId
  return true
}

/**
 * Whole days from `a` to `b`, signed.
 *
 * Both are UTC calendar days by construction (`booked_on`, `due_on`), and this is a **count of
 * days** rather than a month-shaped step, which is the one date operation a UTC epoch does exactly.
 * Anything that steps by months goes through `./schedule`.
 */
function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  )
}

export const matchTransactionSchema = z.strictObject({
  transactionId: z.string().trim().min(1).max(64),
})
export type MatchTransactionInput = z.infer<typeof matchTransactionSchema>

/** What a match did, or why it did nothing. */
export interface MatchResult {
  readonly transactionId: string
  readonly seriesId: string | null
  readonly periodStart: string | null
  /** Always `rule` when something matched: this module is the rule engine and nothing else. */
  readonly matchSource: 'rule' | null
}

/**
 * Tries every active series' matcher against one transaction and links the first that fits.
 *
 * Only series that carry `matching_rules` are considered, which is also every series that could
 * possibly be considered: the schema `CHECK` guarantees such a series does not also auto-record,
 * so the two mechanisms cannot both claim one period. A transaction already attached to a series
 * is left alone — re-matching an adopted row is how one bill ends up settling two periods.
 */
export async function matchTransaction(
  scope: TenantScope,
  input: MatchTransactionInput,
): Promise<MatchResult> {
  const parsed = matchTransactionSchema.parse(input)
  const transaction = await getMatchableTransaction(scope, parsed.transactionId)
  const unmatched: MatchResult = {
    transactionId: transaction.id,
    seriesId: null,
    periodStart: null,
    matchSource: null,
  }
  if (transaction.recurringSeriesId !== null) return unmatched

  for (const series of await listSeries(scope, {})) {
    const rules = readMatchingRules(series.matchingRules)
    if (rules === null) continue

    // Oldest first, so the earliest unpaid period is the one adopted.
    for (const period of await listOpenPeriodRows(scope, series.id)) {
      const verdict = matchesPeriod({
        series,
        rules,
        transaction,
        dueOn: period.dueOn,
      })
      if (!verdict.matched) continue

      await markPaid(scope, {
        seriesId: series.id,
        periodStart: period.periodStart,
        transactionId: transaction.id,
        matchSource: 'rule',
      })
      // The transaction now names its series, which is what stops a second run from adopting the
      // same row into the *next* open period — and what lets the ledger show which bill it paid.
      // `categorization_source` is deliberately not touched: a person chose that category.
      await stampRecurringOrigin(scope, {
        transactionId: transaction.id,
        seriesId: series.id,
      })
      return {
        transactionId: transaction.id,
        seriesId: series.id,
        periodStart: period.periodStart,
        matchSource: 'rule',
      }
    }
  }

  return unmatched
}
