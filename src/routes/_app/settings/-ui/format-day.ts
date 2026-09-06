/**
 * An instant, reduced to the calendar day it falls on in UTC.
 *
 * Renewal dates, grace ends and invitation expiries are **days** to a reader, not instants: "renews
 * on 12 March" is the sentence, and printing a time beside it invites the question of whose clock
 * it is in. UTC is the frame `docs/MONEY.md` §6.1 already defines a calendar day in, so the two
 * halves of the product answer "which day is this" the same way.
 *
 * The output is the `YYYY-MM-DD` form every calendar-date column in this product uses, which is
 * exactly what `formatCalendarDate` takes.
 */
export function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10)
}
