import {
  DateFormatter,
  parseDate,
  toCalendarDate,
} from '@internationalized/date'
import { NumberFormatter } from '@internationalized/number'

import type { CalendarDate, DateValue } from '@internationalized/date'
import type { Locale } from './locales'

/**
 * Locale-aware formatting for everything that is not money.
 *
 * Money has its own module (`#/lib/money`) because it needs the currency's
 * `digits`; the two currency helpers at the bottom of this file are re-exports
 * of that one implementation, so a screen that already imports from here does
 * not have to reach into two places.
 *
 * **Dates are UTC.** A calendar date in this product is a `YYYY-MM-DD` string
 * (`transactions.booked_on`, `account_balances.date`), day bucketing is UTC
 * everywhere, and the reader's timezone is applied only when an *instant* is
 * rendered. Formatting a calendar date in a local timezone is how a transaction
 * booked on the 1st shows up under the 31st for anyone west of Greenwich, so
 * `formatCalendarDate` never takes a timezone at all.
 *
 * **Every formatter is cached per shape.** Constructing an `Intl` object is the
 * expensive part and a transaction list formats thousands of values per render.
 */

/** The date styles the product uses. */
export type DateStyle = 'day' | 'short' | 'medium' | 'long' | 'full'

const DATE_OPTIONS: Readonly<Record<DateStyle, Intl.DateTimeFormatOptions>> = {
  /**
   * `31` — the day of the month alone, for a column that already sits under a
   * heading naming the month. Narrow enough to survive a 360px ledger, which a
   * ten-character `short` date is not.
   */
  day: { day: 'numeric' },
  /** `31/12/2025` — dense tables and chart axes. */
  short: { year: 'numeric', month: '2-digit', day: '2-digit' },
  /** `31 Dec 2025` — transaction rows, where the month must not be misread. */
  medium: { year: 'numeric', month: 'short', day: 'numeric' },
  /** `31 December 2025` — detail panes. */
  long: { year: 'numeric', month: 'long', day: 'numeric' },
  /** `Wednesday, 31 December 2025` — day headers in a grouped list. */
  full: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
}

const dateFormatters = new Map<string, DateFormatter>()

function dateFormatter(
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
  timeZone: string,
): DateFormatter {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`
  const cached = dateFormatters.get(key)
  if (cached !== undefined) {
    return cached
  }
  const created = new DateFormatter(locale, { ...options, timeZone })
  dateFormatters.set(key, created)
  return created
}

/** Accepts either the `YYYY-MM-DD` a column holds or an already-parsed value. */
export type CalendarDateInput = string | DateValue

/**
 * Parses the `YYYY-MM-DD` form every calendar-date column in this product uses.
 *
 * A `DateValue` passes through, narrowed to a calendar date, so a component
 * holding a React Aria `DatePicker` value can call the formatters without
 * converting first.
 */
export function toCalendarDateValue(input: CalendarDateInput): CalendarDate {
  return typeof input === 'string' ? parseDate(input) : toCalendarDate(input)
}

/**
 * A calendar date in the reader's language. No timezone: the value is a date,
 * not an instant, and giving it one is how days drift.
 */
export function formatCalendarDate(
  locale: Locale,
  input: CalendarDateInput,
  style: DateStyle = 'medium',
): string {
  return dateFormatter(locale, DATE_OPTIONS[style], 'UTC').format(
    toCalendarDateValue(input).toDate('UTC'),
  )
}

/**
 * A range of calendar dates — a budget period, a report window — collapsed the
 * way the locale collapses it (`1–31 Dec 2025`, not `1 Dec 2025 – 31 Dec 2025`).
 */
export function formatCalendarDateRange(
  locale: Locale,
  from: CalendarDateInput,
  to: CalendarDateInput,
  style: DateStyle = 'medium',
): string {
  return dateFormatter(locale, DATE_OPTIONS[style], 'UTC').formatRange(
    toCalendarDateValue(from).toDate('UTC'),
    toCalendarDateValue(to).toDate('UTC'),
  )
}

/**
 * An instant — `created_at`, a session's last seen, an import's finish time — in
 * the reader's own timezone, because that is the only frame in which "3 minutes
 * ago" and "at 14:02" agree with each other.
 */
export function formatDateTime(
  locale: Locale,
  epochMs: number,
  timeZone: string,
  style: DateStyle = 'medium',
): string {
  return dateFormatter(
    locale,
    { ...DATE_OPTIONS[style], hour: '2-digit', minute: '2-digit' },
    timeZone,
  ).format(new Date(epochMs))
}

/** Just the clock part of an instant, in the reader's timezone. */
export function formatTime(
  locale: Locale,
  epochMs: number,
  timeZone: string,
): string {
  return dateFormatter(
    locale,
    { hour: '2-digit', minute: '2-digit' },
    timeZone,
  ).format(new Date(epochMs))
}

/* -------------------------------------------------------------------------- */
/* Relative time                                                              */
/* -------------------------------------------------------------------------- */

/** The unit a gap is best described in, and how many of them there are. */
export interface RelativeTimeParts {
  readonly value: number
  readonly unit: Intl.RelativeTimeFormatUnit
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const WEEK_MS = 604_800_000
/** The average month and year, which is what `Intl` itself assumes. */
const MONTH_MS = 2_629_746_000
const YEAR_MS = 31_556_952_000

/**
 * Chooses the unit a gap reads best in — seconds under a minute, then minutes,
 * hours, days, weeks, months, years.
 *
 * Split out from the formatting so the choice is testable without asserting on
 * prose, and so a component that wants to render the number itself (a chart
 * axis, an `aria-label` built from catalogue keys) can reuse it.
 */
export function relativeTimeParts(
  fromEpochMs: number,
  nowEpochMs: number,
): RelativeTimeParts {
  const delta = fromEpochMs - nowEpochMs
  const magnitude = Math.abs(delta)
  const sign = delta < 0 ? -1 : 1

  if (magnitude < MINUTE_MS) {
    return { value: sign * Math.round(magnitude / 1000), unit: 'second' }
  }
  if (magnitude < HOUR_MS) {
    return { value: sign * Math.round(magnitude / MINUTE_MS), unit: 'minute' }
  }
  if (magnitude < DAY_MS) {
    return { value: sign * Math.round(magnitude / HOUR_MS), unit: 'hour' }
  }
  if (magnitude < WEEK_MS) {
    return { value: sign * Math.round(magnitude / DAY_MS), unit: 'day' }
  }
  if (magnitude < MONTH_MS) {
    return { value: sign * Math.round(magnitude / WEEK_MS), unit: 'week' }
  }
  if (magnitude < YEAR_MS) {
    return { value: sign * Math.round(magnitude / MONTH_MS), unit: 'month' }
  }
  return { value: sign * Math.round(magnitude / YEAR_MS), unit: 'year' }
}

const relativeFormatters = new Map<Locale, Intl.RelativeTimeFormat>()

/**
 * `3 days ago`, `3 dni temu`, `yesterday`, `wczoraj`.
 *
 * `Intl.RelativeTimeFormat` is used here rather than a catalogue entry, and it
 * is the one prose-producing `Intl` API this layer allows. The reason it is
 * safe where `Intl.DisplayNames` is not: relative time is only ever rendered
 * client-side against a clock that has already moved between the server pass
 * and hydration, so the string is never expected to match across the boundary
 * and is not part of the hydration contract. Anything rendered on the server
 * uses `formatCalendarDate` or `formatDateTime` instead.
 *
 * `numeric: 'auto'` is what turns `1 day ago` into `yesterday` and `wczoraj`,
 * and it is also what makes the Polish output grammatical for all four plural
 * categories without the catalogue carrying them.
 */
export function formatRelativeTime(
  locale: Locale,
  fromEpochMs: number,
  nowEpochMs: number = Date.now(),
): string {
  let formatter = relativeFormatters.get(locale)
  if (formatter === undefined) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    relativeFormatters.set(locale, formatter)
  }
  const { value, unit } = relativeTimeParts(fromEpochMs, nowEpochMs)
  return formatter.format(value, unit)
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                    */
/* -------------------------------------------------------------------------- */

const numberFormatters = new Map<string, NumberFormatter>()

function numberFormatter(
  locale: Locale,
  options: Intl.NumberFormatOptions,
): NumberFormatter {
  const key = `${locale}|${JSON.stringify(options)}`
  const cached = numberFormatters.get(key)
  if (cached !== undefined) {
    return cached
  }
  const created = new NumberFormatter(locale, options)
  numberFormatters.set(key, created)
  return created
}

/**
 * A plain count — transactions in a period, members in a workspace.
 *
 * Not for money. An amount formatted here would be a major-unit float that has
 * bypassed the currency's `digits`, which is the exact defect `#/lib/money`
 * exists to prevent.
 */
export function formatNumber(
  locale: Locale,
  value: number,
  options: Intl.NumberFormatOptions = {},
): string {
  return numberFormatter(locale, options).format(value)
}

/**
 * A compact count for a dense tile: `1.2K`, `1,2 tys.`.
 *
 * Only ever a count. A compacted amount hides the digits a reader is checking.
 */
export function formatCompactNumber(locale: Locale, value: number): string {
  return numberFormatter(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

/**
 * A ratio as a percentage: `0.72` → `72%`.
 *
 * The input is a fraction, not a percentage — `ratioOfMinor` in `#/lib/money`
 * produces exactly this — so there is one convention and no call site
 * multiplying by a hundred on its own.
 */
export function formatPercent(
  locale: Locale,
  ratio: number,
  fractionDigits = 0,
): string {
  return numberFormatter(locale, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(ratio)
}

/**
 * A signed percentage change for a comparison row: `+12%`, `−4%`.
 *
 * The sign is `Intl`'s own, so the minus is the locale's minus rather than a
 * hyphen glued on by hand.
 */
export function formatPercentChange(
  locale: Locale,
  ratio: number,
  fractionDigits = 0,
): string {
  return numberFormatter(locale, {
    style: 'percent',
    signDisplay: 'exceptZero',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(ratio)
}

/**
 * Money formatting, re-exported so a screen has one import for "format things".
 * The implementation lives in `#/lib/money` because it is the module that knows
 * a currency's `digits`.
 */
export {
  formatMoney,
  formatMoneyPlain,
  formatRateE10,
  formatSignedMoney,
  parseMoney,
  toAmountInputValue,
} from '../money'
