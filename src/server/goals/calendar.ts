/**
 * Month arithmetic for the goals surface, in the one place both consumers can reach it.
 *
 * Two modules need to bucket contributions by calendar month: {@link projectCompletion}, which
 * takes a median over them, and the detail screen's history series, which draws them. Buckets
 * computed twice are buckets that eventually disagree, and a chart that disagrees with the
 * projection printed beside it is worse than either being wrong alone — so the bucketing lives
 * here and both import it.
 *
 * **Every function is pure and none constructs a `Date`.** A month index is `year * 12 + month`,
 * which makes month arithmetic plain addition; the two ends of a month come from
 * `@internationalized/date`, the same library `budgets/period.ts` and `recurring/schedule.ts`
 * step through — one calendar implementation for the product, so a leap year cannot be right in
 * one module and wrong in another. `Date` is what neither uses: it would drag a timezone into a
 * calculation about calendar days, and `booked_on` is a calendar day with no instant behind it
 * (`docs/MONEY.md` §6.1).
 */

import { CalendarDate } from '@internationalized/date'

/** Anything with a booked day and an integer amount. Structural, so no module owns the shape. */
export interface MonthlyDatum {
  /** `YYYY-MM-DD`. A UTC calendar day, never an instant. */
  readonly bookedOn: string
  readonly amountMinor: number
}

/** `'2026-03-15'` → `2026 * 12 + 2`. A month index, so month arithmetic is plain addition. */
export function monthIndexOf(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4))
  const month = Number(isoDate.slice(5, 7))
  return year * 12 + (month - 1)
}

/** A month index back to the first day of that month, as a calendar date. */
function firstDayOf(index: number): CalendarDate {
  return new CalendarDate(Math.floor(index / 12), (index % 12) + 1, 1)
}

/** A month index back to the `YYYY-MM-DD` of that month's **first** day. */
export function startOfMonth(index: number): string {
  return firstDayOf(index).toString()
}

/**
 * A month index back to the `YYYY-MM-DD` of that month's **last** day.
 *
 * Reached by stepping to the next month and back one day rather than by a length table: the
 * length table is where a leap year gets written down a second time.
 */
export function endOfMonth(index: number): string {
  return firstDayOf(index).add({ months: 1 }).subtract({ days: 1 }).toString()
}

/** Month index → the integer sum of everything booked in that month. */
export function monthlySums(
  data: ReadonlyArray<MonthlyDatum>,
): Map<number, number> {
  const sums = new Map<number, number>()
  for (const datum of data) {
    const index = monthIndexOf(datum.bookedOn)
    sums.set(index, (sums.get(index) ?? 0) + datum.amountMinor)
  }
  return sums
}
