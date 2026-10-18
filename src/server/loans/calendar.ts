/**
 * The month × year obligation grid.
 *
 * Remaining and paid are integer sums of stored `ref_amount_minor` on instalments due in that
 * month (`docs/MONEY.md` §3). The grid always starts at {@link CALENDAR_START_YEAR} and runs
 * through the later of today and the last due date. Instalments before 2025 are omitted from
 * the grid, not rewritten.
 */

import { ZERO_MINOR, sumMinor } from '#/lib/money'
import { CALENDAR_START_YEAR } from '#/lib/obligation-calendar'
import { listInstalments, listLoans } from '#/server/repos/loans'
import { conversionContextFor } from '#/server/repos/workspace-currencies'

import type { Book } from '#/lib/enums'
import type { Minor } from '#/lib/money'
import type { TenantScope } from '#/server/repos/base'
import type { InstalmentView } from '#/server/repos/loans'

export interface CalendarCell {
  readonly key: string
  readonly year: number
  readonly month: number
  readonly paidRefMinor: Minor
  readonly remainingRefMinor: Minor
  readonly overdueCount: number
}

export interface ObligationCalendar {
  readonly baseCurrencyCode: string
  /** Inclusive, from {@link CALENDAR_START_YEAR} through the last year that has a reason to exist. */
  readonly years: ReadonlyArray<number>
  /** 12 cells per year, month 1–12, in year then month order. */
  readonly cells: ReadonlyArray<CalendarCell>
  /** `YYYY-MM` of `today`, so the grid can mark the current month without a second clock. */
  readonly todayMonth: string
}

export interface CalendarInstalment {
  readonly dueOn: string
  readonly derivedStatus: InstalmentView['derivedStatus']
  readonly refAmountMinor: Minor
}

function monthKey(year: number, month: number): string {
  return `${String(year)}-${String(month).padStart(2, '0')}`
}

export function yearsThrough(
  today: string,
  dueOns: ReadonlyArray<string>,
): ReadonlyArray<number> {
  let end = Number(today.slice(0, 4))
  if (!Number.isFinite(end) || end < CALENDAR_START_YEAR) {
    end = CALENDAR_START_YEAR
  }
  for (const dueOn of dueOns) {
    const year = Number(dueOn.slice(0, 4))
    if (Number.isFinite(year) && year > end) end = year
  }
  const years: Array<number> = []
  for (let year = CALENDAR_START_YEAR; year <= end; year += 1) {
    years.push(year)
  }
  return years
}

/**
 * Fills every month of every year. A month with no instalment is a **zero**, not a gap: the
 * question is "what is due", and the answer can be nothing.
 */
export function assembleCalendar(
  instalments: ReadonlyArray<CalendarInstalment>,
  today: string,
  baseCurrencyCode: string,
): ObligationCalendar {
  const years = yearsThrough(
    today,
    instalments.map((row) => row.dueOn),
  )
  const buckets = new Map<
    string,
    { paid: Array<Minor>; remaining: Array<Minor>; overdueCount: number }
  >()
  for (const year of years) {
    for (let month = 1; month <= 12; month += 1) {
      buckets.set(monthKey(year, month), {
        paid: [],
        remaining: [],
        overdueCount: 0,
      })
    }
  }

  for (const row of instalments) {
    const year = Number(row.dueOn.slice(0, 4))
    if (!Number.isFinite(year) || year < CALENDAR_START_YEAR) continue
    const bucket = buckets.get(row.dueOn.slice(0, 7))
    if (bucket === undefined) continue
    if (row.derivedStatus === 'paid') {
      bucket.paid.push(row.refAmountMinor)
      continue
    }
    bucket.remaining.push(row.refAmountMinor)
    if (row.derivedStatus === 'overdue') bucket.overdueCount += 1
  }

  const cells: Array<CalendarCell> = []
  for (const year of years) {
    for (let month = 1; month <= 12; month += 1) {
      const key = monthKey(year, month)
      const bucket = buckets.get(key)
      if (bucket === undefined) continue
      cells.push({
        key,
        year,
        month,
        paidRefMinor:
          bucket.paid.length === 0 ? ZERO_MINOR : sumMinor(bucket.paid),
        remainingRefMinor:
          bucket.remaining.length === 0
            ? ZERO_MINOR
            : sumMinor(bucket.remaining),
        overdueCount: bucket.overdueCount,
      })
    }
  }

  return {
    baseCurrencyCode,
    years,
    cells,
    todayMonth: today.slice(0, 7),
  }
}

export async function obligationCalendarFor(
  scope: TenantScope,
  today: string,
  input: { readonly book?: Book } = {},
): Promise<ObligationCalendar> {
  const conversion = await conversionContextFor(scope)
  const loans = await listLoans(scope, {
    book: input.book,
    includeClosed: true,
  })
  const instalments: Array<CalendarInstalment> = []
  for (const loan of loans) {
    const rows = await listInstalments(scope, { loanId: loan.id, today })
    for (const row of rows) {
      instalments.push({
        dueOn: row.dueOn,
        derivedStatus: row.derivedStatus,
        refAmountMinor: row.refAmountMinor,
      })
    }
  }
  return assembleCalendar(instalments, today, conversion.baseCurrencyCode)
}
