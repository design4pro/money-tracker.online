/**
 * The latest calendar day on Earth, kept apart from the clock on purpose.
 *
 * `#/server/clock` imports a server-only entry of the framework to read the development pin, so
 * anything that imports it is barred from the client graph. The booking rule
 * (`#/server/booking-rule`) is reached from `repos/rules`, which a route module imports by value
 * through `rules/integrity`, so the cutoff lives here, with no dependencies at all.
 */

/** The furthest ahead of UTC any civil clock runs (Line Islands, Kiribati: UTC+14). */
const MAX_UTC_OFFSET_MS = 14 * 60 * 60 * 1000

/**
 * The workspace civil timezone until a household picks another.
 *
 * Due, overdue and cron "today" use this zone (`docs/MONEY.md` §6.4). Report buckets and
 * `booked_on` do not: those stay timezone-free calendar dates (§6.1, §6.2).
 */
export const DEFAULT_WORKSPACE_TIMEZONE = 'Europe/Warsaw'

/** True when `value` is an IANA zone `Intl` will accept in this isolate. */
export function isIanaTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/**
 * The calendar day `now` falls on in `timeZone`, as `YYYY-MM-DD`.
 *
 * UTC `toISOString().slice(0, 10)` is the wrong "today" for a Warsaw household around midnight:
 * 22:30 UTC in July is already 00:30 the next civil day in `Europe/Warsaw`. Cron due/overdue
 * uses this, never the UTC date.
 */
export function civilDayInTimeZone(now: Date, timeZone: string): string {
  const zone = isIanaTimeZone(timeZone) ? timeZone : DEFAULT_WORKSPACE_TIMEZONE
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (year === undefined || month === undefined || day === undefined) {
    return now.toISOString().slice(0, 10)
  }
  return `${year}-${month}-${day}`
}

/**
 * The latest calendar date it is, anywhere on Earth, at `now`.
 *
 * The ceiling for a booking date the server will accept. It is **not** `serverToday` (`#/server/clock`) plus a
 * day: `serverToday()` carries no hour, so "+1 day" would accept a date that has begun nowhere on
 * Earth for about ten hours of every UTC day. And it is not `serverToday()` itself, which would
 * refuse the own-today of a person in UTC+13 or UTC+14 for the hours their date is ahead of UTC's.
 *
 * Pure in `now`; the wall clock is read only by the default argument, so it is read when a schema
 * parses and never when the module loads. It ignores the development pins on purpose: a pinned
 * day moves a comparison, and this guard exists to refuse a date the real world has not reached.
 */
export function latestCalendarDayOnEarth(now: Date = new Date()): string {
  return new Date(now.getTime() + MAX_UTC_OFFSET_MS).toISOString().slice(0, 10)
}
