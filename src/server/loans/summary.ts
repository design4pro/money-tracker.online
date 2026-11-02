/**
 * One loan, as a card and a detail header read it.
 *
 * The repository owns the SQL. This owns the composition: remaining, paid-to-date and the
 * share of the schedule repaid are assembled here once so the list and the detail cannot print
 * two different numbers beside each other.
 *
 * Remaining is the integer sum of **unpaid instalment amounts**, not a bank balance and not a
 * subtraction of formatted figures. The list total sums stored `ref_amount_minor` on those
 * unpaid rows (`docs/MONEY.md` §3). Overdue is derived from `due_on` and `today`, never stored.
 */

import { ZERO_MINOR, asMinor, ratioOfMinor, sumMinor } from '#/lib/money'
import { listInstalments, listLoans } from '#/server/repos/loans'
import { conversionContextFor } from '#/server/repos/workspace-currencies'

import type { Minor } from '#/lib/money'
import type { TenantScope } from '#/server/repos/base'
import type { InstalmentView, ListLoansInput, Loan } from '#/server/repos/loans'

/** One loan, with everything a card draws and nothing a card does not. */
export interface LoanSummary {
  readonly loan: Loan
  readonly paidCount: number
  readonly overdueCount: number
  readonly scheduleCount: number
  /** Sum of paid instalment totals in the loan's own currency. */
  readonly paidMinor: Minor
  /** Sum of unpaid instalment totals in the loan's own currency. */
  readonly remainingMinor: Minor
  /** `paid + remaining`. The schedule's plan, not a ledger. */
  readonly totalMinor: Minor
  /**
   * `paid / total`, **display only**. `null` when the schedule sums to zero, which the create
   * schema's `positive()` rules out; kept so an import of empty money renders an em dash rather
   * than `0%`.
   */
  readonly ratio: number | null
  readonly remainingRefMinor: Minor
  readonly next: InstalmentView | null
  readonly isOverdue: boolean
}

export interface LoansOverview {
  readonly rows: ReadonlyArray<LoanSummary>
  readonly baseCurrencyCode: string
  /** Sum of unpaid instalments in the workspace base currency. Historical `ref_*`. */
  readonly remainingRefMinor: Minor
  readonly overdueCount: number
  readonly overdueRefMinor: Minor
  readonly dueThisMonthCount: number
  readonly dueThisMonthRefMinor: Minor
}

export function summariseLoan(
  loan: Loan,
  instalments: ReadonlyArray<InstalmentView>,
): LoanSummary {
  const paid: Array<Minor> = []
  const remaining: Array<Minor> = []
  const remainingRef: Array<Minor> = []
  let overdueCount = 0
  let next: InstalmentView | null = null

  for (const row of instalments) {
    if (row.derivedStatus === 'paid') {
      paid.push(row.amountMinor)
      continue
    }
    remaining.push(row.amountMinor)
    remainingRef.push(row.refAmountMinor)
    if (row.derivedStatus === 'overdue') overdueCount += 1
    if (next === null) next = row
  }

  const paidMinor = paid.length === 0 ? ZERO_MINOR : sumMinor(paid)
  const remainingMinor =
    remaining.length === 0 ? ZERO_MINOR : sumMinor(remaining)
  const remainingRefMinor =
    remainingRef.length === 0 ? ZERO_MINOR : sumMinor(remainingRef)
  const totalMinor = asMinor(paidMinor + remainingMinor)

  return {
    loan,
    paidCount: paid.length,
    overdueCount,
    scheduleCount: instalments.length,
    paidMinor,
    remainingMinor,
    totalMinor,
    ratio: ratioOfMinor(paidMinor, totalMinor),
    remainingRefMinor,
    next,
    isOverdue: overdueCount > 0,
  }
}

export async function summariseLoans(
  scope: TenantScope,
  today: string,
  input: ListLoansInput = {},
): Promise<LoansOverview> {
  const conversion = await conversionContextFor(scope)
  const loans = await listLoans(scope, input)
  const rows: Array<LoanSummary> = []
  const remainingRef: Array<Minor> = []
  const overdueRef: Array<Minor> = []
  const dueThisMonthRef: Array<Minor> = []
  const thisMonth = today.slice(0, 7)
  let overdueCount = 0

  for (const loan of loans) {
    const instalments = await listInstalments(scope, {
      loanId: loan.id,
      today,
    })
    const summary = summariseLoan(loan, instalments)
    rows.push(summary)
    remainingRef.push(summary.remainingRefMinor)
    overdueCount += summary.overdueCount
    for (const row of instalments) {
      if (row.derivedStatus === 'paid') continue
      if (row.derivedStatus === 'overdue') overdueRef.push(row.refAmountMinor)
      if (row.dueOn.startsWith(thisMonth)) {
        dueThisMonthRef.push(row.refAmountMinor)
      }
    }
  }

  return {
    rows,
    baseCurrencyCode: conversion.baseCurrencyCode,
    remainingRefMinor:
      remainingRef.length === 0 ? ZERO_MINOR : sumMinor(remainingRef),
    overdueCount,
    overdueRefMinor:
      overdueRef.length === 0 ? ZERO_MINOR : sumMinor(overdueRef),
    dueThisMonthCount: dueThisMonthRef.length,
    dueThisMonthRefMinor:
      dueThisMonthRef.length === 0 ? ZERO_MINOR : sumMinor(dueThisMonthRef),
  }
}
