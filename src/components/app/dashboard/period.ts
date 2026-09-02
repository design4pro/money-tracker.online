import { endOfMonth, parseDate, startOfMonth } from '@internationalized/date'

import type { MessageKey } from '#/lib/i18n'

/**
 * The dashboard's period model.
 *
 * **The arithmetic is calendar arithmetic, in UTC, on `YYYY-MM-DD` strings** — `@internationalized/
 * date`, never `Date` and never a millisecond offset. "A month ago" is not 30 days, "three months"
 * is not 90, and a `Date` subtraction in a browser set to Warsaw quietly moves a boundary by an
 * hour twice a year. `booked_on` is a calendar date, so the range that filters it has to be one.
 *
 * The period is a **closed** range: `from` and `to` are both included, matching
 * `transactionFiltersSchema`, whose bounds are inclusive.
 *
 * `today` is a parameter rather than a call to the clock. A pure function is testable at a pinned
 * date, and the dashboard's loader is the one place that decides what "now" is.
 */

export const DASHBOARD_PERIODS = [
  'thisMonth',
  'lastMonth',
  'last3Months',
  'last12Months',
  'thisYear',
] as const

export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number]

export function isDashboardPeriod(value: unknown): value is DashboardPeriod {
  return (
    typeof value === 'string' &&
    (DASHBOARD_PERIODS as ReadonlyArray<string>).includes(value)
  )
}

/** The label key for a period, so the selector and the header cannot name it differently. */
export const PERIOD_LABEL_KEYS: Record<DashboardPeriod, MessageKey> = {
  thisMonth: 'common.thisMonth',
  lastMonth: 'common.lastMonth',
  last3Months: 'dashboard.period.last3Months',
  last12Months: 'dashboard.period.last12Months',
  thisYear: 'common.thisYear',
}

export interface PeriodRange {
  /** Inclusive first day, `YYYY-MM-DD`. */
  readonly from: string
  /** Inclusive last day, `YYYY-MM-DD`. */
  readonly to: string
}

/** The closed calendar range a period covers, given the day the request is being served on. */
export function periodRange(
  period: DashboardPeriod,
  today: string,
): PeriodRange {
  const day = parseDate(today)

  switch (period) {
    case 'thisMonth':
      return {
        from: startOfMonth(day).toString(),
        to: endOfMonth(day).toString(),
      }
    case 'lastMonth': {
      const previous = startOfMonth(day).subtract({ months: 1 })
      return {
        from: previous.toString(),
        to: endOfMonth(previous).toString(),
      }
    }
    case 'last3Months':
      return {
        from: startOfMonth(day.subtract({ months: 2 })).toString(),
        to: endOfMonth(day).toString(),
      }
    case 'last12Months':
      return {
        from: startOfMonth(day.subtract({ months: 11 })).toString(),
        to: endOfMonth(day).toString(),
      }
    case 'thisYear':
      return {
        from: day.set({ month: 1, day: 1 }).toString(),
        to: day.set({ month: 12, day: 31 }).toString(),
      }
  }
}

/**
 * The first day of each month the period covers, in order.
 *
 * The cash-flow chart buckets by month, and the buckets are derived from the range rather than
 * from the transactions: a month with nothing in it is a real zero on the chart, not a month the
 * axis silently skips.
 */
export function monthsIn(range: PeriodRange): ReadonlyArray<string> {
  const last = startOfMonth(parseDate(range.to))
  const months: Array<string> = []
  let cursor = startOfMonth(parseDate(range.from))

  while (cursor.compare(last) <= 0 && months.length < 24) {
    months.push(cursor.toString())
    cursor = cursor.add({ months: 1 })
  }
  return months
}

/**
 * The `count` months ending at `firstDay` inclusive, in order.
 *
 * A period that resolves to a single month gives the cash-flow chart one category to draw, and one
 * category is not a chart: two bars in the middle of an empty plot say nothing about whether this
 * month is a normal month, which is the only question a reader has when they look at it. The
 * trailing months are drawn as **context** — the selected month is marked, and the header's totals
 * still count the selected period alone.
 */
export function trailingMonths(
  firstDay: string,
  count: number,
): ReadonlyArray<string> {
  const last = startOfMonth(parseDate(firstDay))
  return Array.from({ length: Math.max(count, 1) }, (_, index) =>
    last.subtract({ months: Math.max(count, 1) - 1 - index }).toString(),
  )
}

/** The closed range of one month, from its first day. */
export function monthRange(firstDay: string): PeriodRange {
  const day = parseDate(firstDay)
  return { from: startOfMonth(day).toString(), to: endOfMonth(day).toString() }
}
