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
