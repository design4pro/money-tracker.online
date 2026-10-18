/**
 * Year and twelve-month forecasts for a recurring series, in integer minor units.
 *
 * Three questions, three sums, never a float:
 *
 * - **Spent this year** — linked transactions booked in the calendar year of `today`, in the
 *   series' own currency. A linked row in another currency is skipped, not converted
 *   (`docs/MONEY.md` §1, §3: no implied rate).
 * - **Rest of year** — expected amounts of occurrences due this calendar year that are still
 *   open (upcoming or overdue). Paid and skipped periods are out. This includes overdue unpaid
 *   rows: they are still to pay this year.
 * - **Next 12 months** — expected amounts of open occurrences due after today through the
 *   calendar day twelve months later.
 *
 * The schedule is the plan; linked transactions are the record. Neither is rewritten here.
 */

import { parseDate } from '@internationalized/date'

import { asMinor } from '#/lib/money'
import { occurrences } from './schedule'

import type { CalendarDate } from '@internationalized/date'
import type { Minor } from '#/lib/money'
import type { RecurringPeriodStatus } from '#/lib/enums'
import type { RecurringSchedule } from './schedule'

export interface SeriesForecast {
  readonly currencyCode: string
  readonly spentThisYearMinor: Minor
  readonly restOfYearMinor: Minor
  readonly next12MonthsMinor: Minor
}

export interface ForecastLink {
  readonly bookedOn: string
  readonly amountMinor: number
  readonly currencyCode: string
  /** `unlinked` rows are history of a pointer, not spending. */
  readonly status: string
}

export interface ForecastPeriod {
  readonly periodStart: string
  readonly derivedStatus: RecurringPeriodStatus
}

export interface SeriesForecastInput {
  readonly schedule: RecurringSchedule
  readonly expectedAmountMinor: number
  readonly expectedCurrencyCode: string
  /** A paused or finished series plans nothing ahead; what it already spent still counts. */
  readonly isActive: boolean
  readonly today: string
  readonly links: ReadonlyArray<ForecastLink>
  readonly periods: ReadonlyArray<ForecastPeriod>
}

function yearBounds(today: CalendarDate): { start: string; end: string } {
  return {
    start: today.set({ month: 1, day: 1 }).toString(),
    end: today.set({ month: 12, day: 31 }).toString(),
  }
}

function isClosed(status: RecurringPeriodStatus | undefined): boolean {
  return status === 'paid' || status === 'skipped'
}

function expectedOpen(
  input: SeriesForecastInput,
  from: string,
  through: string,
): Minor {
  if (!input.isActive) return asMinor(0)
  const byPeriod = new Map(
    input.periods.map((period) => [period.periodStart, period.derivedStatus]),
  )
  let total = 0
  for (const occurrence of occurrences(input.schedule, { from, through })) {
    if (isClosed(byPeriod.get(occurrence.periodStart))) continue
    if (!Number.isInteger(input.expectedAmountMinor)) {
      throw new Error('forecast amounts must be integer minor units')
    }
    total += input.expectedAmountMinor
  }
  return asMinor(total)
}

export function forecastSeries(input: SeriesForecastInput): SeriesForecast {
  const today = parseDate(input.today)
  const year = yearBounds(today)
  const tomorrow = today.add({ days: 1 }).toString()
  const twelveMonths = today.add({ months: 12 }).toString()

  let spent = 0
  for (const link of input.links) {
    if (link.status === 'unlinked') continue
    if (link.currencyCode !== input.expectedCurrencyCode) continue
    if (link.bookedOn < year.start || link.bookedOn > year.end) continue
    if (!Number.isInteger(link.amountMinor)) {
      throw new Error('forecast amounts must be integer minor units')
    }
    spent += link.amountMinor
  }

  return {
    currencyCode: input.expectedCurrencyCode,
    spentThisYearMinor: asMinor(spent),
    restOfYearMinor: expectedOpen(input, year.start, year.end),
    next12MonthsMinor: expectedOpen(input, tomorrow, twelveMonths),
  }
}

/** Collapse per-series forecasts that share a currency. Integer addition only. */
export function rollupForecasts(
  forecasts: ReadonlyArray<SeriesForecast>,
): ReadonlyArray<SeriesForecast> {
  const byCurrency = new Map<string, SeriesForecast>()
  for (const one of forecasts) {
    const existing = byCurrency.get(one.currencyCode)
    if (existing === undefined) {
      byCurrency.set(one.currencyCode, one)
      continue
    }
    byCurrency.set(one.currencyCode, {
      currencyCode: one.currencyCode,
      spentThisYearMinor: asMinor(
        existing.spentThisYearMinor + one.spentThisYearMinor,
      ),
      restOfYearMinor: asMinor(existing.restOfYearMinor + one.restOfYearMinor),
      next12MonthsMinor: asMinor(
        existing.next12MonthsMinor + one.next12MonthsMinor,
      ),
    })
  }
  return [...byCurrency.values()]
}
