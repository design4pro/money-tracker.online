/**
 * Where one budget's periods fall on the calendar.
 *
 * **Calendar arithmetic, never millisecond arithmetic.** A month is not 30 days and a quarter is
 * not 91, so every step below goes through `@internationalized/date` on `YYYY-MM-DD` strings —
 * the same representation `budget_periods.period_start` stores and `transactions.booked_on`
 * compares against. A `Date` subtraction in a browser set to Warsaw moves a boundary by an hour
 * twice a year, and a budget whose March starts on the 28th of February is a budget nobody trusts.
 *
 * **Periods tile forward from `start_date`, not from the first of the month.** A budget somebody
 * started on the 12th runs 12th-to-11th, because that is the day their salary lands. Tiling from
 * an anchor also makes the index arithmetic exact: period `n` starts at `start_date + n × length`,
 * so "which period is today in" is a subtraction rather than a walk.
 *
 * `one_off` is a single period. It ends at `end_date` when there is one, and at
 * {@link OPEN_ENDED_END} when there is not — a real date rather than a `null`, because
 * `budget_periods.period_end` is `NOT NULL` and a screen that renders "—" for the end of a period
 * cannot say whether the period is open or the data is missing.
 *
 * Nothing here reads a clock: `today` is always a parameter, so a period boundary is testable at a
 * pinned date and the caller (a loader, a cron branch) is the one place that decides what now is.
 */

import { parseDate } from '@internationalized/date'

import type { BudgetPeriod } from '#/server/db/schema'

/** The last day a `one_off` budget with no stated end covers. */
export const OPEN_ENDED_END = '9999-12-31'

/** A closed calendar range: both ends included, matching `booked_on` comparisons. */
export interface PeriodBounds {
  /** Inclusive first day, `YYYY-MM-DD`. */
  readonly periodStart: string
  /** Inclusive last day, `YYYY-MM-DD`. */
  readonly periodEnd: string
}

/**
 * How long one period of each cadence runs.
 *
 * A count and a unit rather than a single number, because `weekly` is not expressible in months
 * and rounding it to one would put a transaction in the wrong envelope roughly one week in four.
 * The two units also differ in a way the arithmetic below cares about: months clamp at the end of
 * the month and weeks never do, so a 31st anchor needs correcting and a weekly one cannot.
 *
 * `one_off` has no cadence at all, which is `null` rather than a zero-length one: zero would make
 * the tiling arithmetic divide by nothing.
 */
export interface PeriodCadence {
  readonly unit: 'week' | 'month'
  readonly count: number
}

const CADENCE: Record<BudgetPeriod, PeriodCadence | null> = {
  one_off: null,
  weekly: { unit: 'week', count: 1 },
  monthly: { unit: 'month', count: 1 },
  quarterly: { unit: 'month', count: 3 },
  yearly: { unit: 'month', count: 12 },
}

/** What a budget has to say about its own calendar. The three columns, and nothing else. */
export interface BudgetCalendar {
  readonly period: BudgetPeriod
  /** `budgets.start_date`. The anchor every period is measured from. */
  readonly startDate: string
  /** `budgets.end_date`, or `null` for a budget that runs until it is closed. */
  readonly endDate: string | null
}

/**
 * The three calendar columns of a budget row, narrowed.
 *
 * Drizzle types `period` as `string`; `budgets_period_check` in `schema.ts` is what makes the
 * union true. Asserted once here rather than at each call site that would otherwise carry an
 * inline cast.
 */
export function calendarOf(budget: {
  readonly period: string
  readonly startDate: string
  readonly endDate: string | null
}): BudgetCalendar {
  return {
    period: budget.period as BudgetPeriod,
    startDate: budget.startDate,
    endDate: budget.endDate,
  }
}

/** How long one period runs, or `null` for `one_off`, which has exactly one. */
export function periodCadence(period: BudgetPeriod): PeriodCadence | null {
  return CADENCE[period]
}

/** `cadence x multiple`, in the shape `CalendarDate.add` takes. */
function span(cadence: PeriodCadence, multiple: number) {
  const total = cadence.count * multiple
  return cadence.unit === 'week' ? { weeks: total } : { months: total }
}

/**
 * The bounds of period `index`, counting from zero at `start_date`.
 *
 * The end is the day before the next period begins, so consecutive periods abut without
 * overlapping — the property `budget_periods`' primary key exists to protect and the one a
 * "carried in from the previous period" chain depends on.
 */
export function periodBoundsAt(
  calendar: BudgetCalendar,
  index: number,
): PeriodBounds {
  const anchor = parseDate(calendar.startDate)
  const cadence = periodCadence(calendar.period)

  if (cadence === null) {
    return {
      periodStart: calendar.startDate,
      periodEnd: calendar.endDate ?? OPEN_ENDED_END,
    }
  }

  // Both ends are measured from the **anchor**, never from the previous period's start. Adding a
  // month to a clamped date does not undo the clamp — 31 Jan + 1 month is 28 Feb, and 28 Feb + 1
  // month is 28 Mar, not 31 Mar — so deriving the next start from `start` would open a three-day
  // gap between period 1 and period 2 of every budget anchored on a 29th, 30th or 31st. Weeks
  // never clamp, but they go through the same anchored arithmetic so there is one rule here, not
  // one rule and an exception.
  const start = anchor.add(span(cadence, index))
  const nextStart = anchor.add(span(cadence, index + 1))
  const naturalEnd = nextStart.subtract({ days: 1 })
  const limit = calendar.endDate === null ? null : parseDate(calendar.endDate)
  const end =
    limit !== null && naturalEnd.compare(limit) > 0 ? limit : naturalEnd

  return { periodStart: start.toString(), periodEnd: end.toString() }
}

/**
 * Which period `day` falls in, or `null` when the budget does not cover it.
 *
 * Counted rather than walked. A walk would be O(periods) on a budget somebody started in 2019 and
 * would have to be capped, and a cap is a silent wrong answer.
 *
 * How the count is reached differs by unit, and only one of the two needs correcting afterwards:
 *
 * - **Weeks** divide the exact day distance by the exact period length, so the answer is right
 *   first time. Weeks do not clamp, so there is nothing for the loops below to fix.
 * - **Months** divide the whole-month distance, which ignores both the day of the month and the
 *   end-of-month clamp, and is therefore never more than one period out in either direction.
 */
export function periodIndexFor(
  calendar: BudgetCalendar,
  day: string,
): number | null {
  const anchor = parseDate(calendar.startDate)
  const target = parseDate(day)
  if (target.compare(anchor) < 0) return null
  if (
    calendar.endDate !== null &&
    target.compare(parseDate(calendar.endDate)) > 0
  ) {
    return null
  }

  const cadence = periodCadence(calendar.period)
  if (cadence === null) return 0

  // `toJulianDay` is a day count, not a millisecond one: it is the calendar's own numbering, so a
  // subtraction of two of them is an exact number of days with no zone and no DST anywhere near
  // it. That keeps this file's rule — calendar arithmetic, never millisecond arithmetic — intact
  // while still giving weeks the exact distance they need.
  const estimate =
    cadence.unit === 'week'
      ? Math.floor(
          (anchor.calendar.toJulianDay(target) -
            anchor.calendar.toJulianDay(anchor)) /
            (7 * cadence.count),
        )
      : Math.floor(
          ((target.year - anchor.year) * 12 + (target.month - anchor.month)) /
            cadence.count,
        )

  // The corrections ask the bounds themselves, which are the only source of truth about where a
  // period starts — a day-of-month comparison gets a clamped boundary wrong, and getting it wrong
  // puts a transaction in the neighbouring envelope. Both loops are no-ops for a weekly budget.
  let index = Math.max(estimate, 0)

  for (let guard = 0; guard < 2 && index > 0; guard += 1) {
    const start = parseDate(periodBoundsAt(calendar, index).periodStart)
    if (target.compare(start) >= 0) break
    index -= 1
  }
  for (let guard = 0; guard < 2; guard += 1) {
    const end = parseDate(periodBoundsAt(calendar, index).periodEnd)
    if (target.compare(end) <= 0) break
    index += 1
  }
  return index
}

/** The bounds of the period containing `day`, or `null` when the budget does not cover it. */
export function periodContaining(
  calendar: BudgetCalendar,
  day: string,
): PeriodBounds | null {
  const index = periodIndexFor(calendar, day)
  return index === null ? null : periodBoundsAt(calendar, index)
}

/**
 * The period that follows the one starting on `periodStart`, or `null` when the budget ends first.
 *
 * `null` for a `one_off` budget always: a one-off envelope has exactly one period, and inventing a
 * second one would give the rollover chain somewhere to carry a balance nobody asked it to carry.
 */
export function periodAfter(
  calendar: BudgetCalendar,
  periodStart: string,
): PeriodBounds | null {
  if (periodCadence(calendar.period) === null) return null

  // Indexed from the anchor rather than stepped from `periodStart`, for the reason
  // `periodBoundsAt` gives: stepping compounds the end-of-month clamp.
  const index = periodIndexFor(calendar, periodStart)
  if (index === null) return null

  const next = periodBoundsAt(calendar, index + 1)
  if (
    calendar.endDate !== null &&
    parseDate(next.periodStart).compare(parseDate(calendar.endDate)) > 0
  ) {
    return null
  }
  return next
}

/**
 * Every period from the anchor up to and including the one containing `today`, in order.
 *
 * `cap` bounds the walk, and when it bites it keeps the **most recent** periods rather than the
 * oldest: a budget anchored far enough in the past to exceed it is almost always a mistyped year,
 * and the periods somebody wants to see in that case are the ones near today, not the ones near
 * 1907. The default covers 40 years of monthly periods and **nine and a half of weekly ones**, so
 * a weekly budget is the only cadence a real person could push past it — and it degrades the way
 * the paragraph above describes rather than failing.
 */
export function periodsThrough(
  calendar: BudgetCalendar,
  today: string,
  cap = 500,
): ReadonlyArray<PeriodBounds> {
  const last = periodIndexFor(calendar, today)
  if (last === null) {
    // `today` before the anchor: the budget has not started, so it has no periods yet. After the
    // end date every period still exists — the index is clamped to the final one instead.
    const anchor = parseDate(calendar.startDate)
    if (parseDate(today).compare(anchor) < 0) return []
    const end = calendar.endDate
    if (end === null) return []
    const finalIndex = periodIndexFor(calendar, end)
    if (finalIndex === null) return []
    return rangeOfPeriods(calendar, finalIndex, cap)
  }
  return rangeOfPeriods(calendar, last, cap)
}

function rangeOfPeriods(
  calendar: BudgetCalendar,
  lastIndex: number,
  cap: number,
): ReadonlyArray<PeriodBounds> {
  const count = Math.min(lastIndex + 1, cap)
  return Array.from({ length: count }, (_unused, index) =>
    periodBoundsAt(calendar, lastIndex - count + 1 + index),
  )
}
