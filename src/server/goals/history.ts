import { asMinor } from '#/lib/money'
import {
  monthIndexOf,
  monthlySums,
  startOfMonth,
} from '#/server/goals/calendar'

import type { Minor } from '#/lib/money'
import type { MonthlyDatum } from '#/server/goals/calendar'

/**
 * A goal's contributions, month by month — the series the detail screen draws.
 *
 * ## Why this is computed on the server
 *
 * It is arithmetic on money, and money arithmetic belongs where the integers are. A component
 * summing `amountMinor` in a `reduce` is one refactor away from summing a formatted string, and it
 * would be a *second* opinion about a figure the projection has already formed one about. Both
 * bucket by the same {@link monthlySums}, so the bars and the median cannot disagree.
 *
 * ## Empty months are zeroes, not gaps
 *
 * Every month between the first contribution and `today` appears, and a month with nothing in it
 * carries `0`. For a bar chart that is the truth rather than a convenience: not saving in March is
 * a fact about March, and a chart that omitted it would compress the timeline and make a dormant
 * goal look steady. It is also exactly what the rate's window does with the same months, which is
 * why the picture and the projection tell the same story.
 *
 * The series is capped at {@link MAX_MONTHS}. A goal running for years is a scroll bar and an
 * unreadable axis otherwise, and the recent stretch is the part the projection is about.
 */

/** One column of the history chart. */
export interface ContributionMonth {
  /** `YYYY-MM-01` — the month, as a date the caller can hand to a formatter. */
  readonly monthStart: string
  /** What went in that month. `0` for a month with no contribution. */
  readonly addedMinor: Minor
}

/** How many months the chart shows. Two years of columns is already a dense axis. */
export const MAX_MONTHS = 24

export interface ContributionSeriesArgs {
  readonly contributions: ReadonlyArray<MonthlyDatum>
  /** The UTC calendar day. A parameter, never a clock read — see `fns/goals`. */
  readonly today: string
}

export function monthlyContributionSeries({
  contributions,
  today,
}: ContributionSeriesArgs): ReadonlyArray<ContributionMonth> {
  if (contributions.length === 0) return []

  const sums = monthlySums(contributions)
  const current = monthIndexOf(today)
  const first = Math.min(...sums.keys())
  // A contribution booked in the future — a planned transfer already recorded — must not make the
  // range run backwards, so the last column is never before the first.
  const last = Math.max(current, ...sums.keys())
  const start = Math.max(first, last - (MAX_MONTHS - 1))

  const months: Array<ContributionMonth> = []
  for (let index = start; index <= last; index += 1) {
    months.push({
      monthStart: startOfMonth(index),
      addedMinor: asMinor(sums.get(index) ?? 0),
    })
  }
  return months
}
