/**
 * Where a recurring series falls on the calendar.
 *
 * **Calendar arithmetic, never millisecond arithmetic, and never `Date`.** Every step below goes
 * through `@internationalized/date` on `YYYY-MM-DD` strings — the representation
 * `recurring_periods.period_start` stores and `transactions.booked_on` compares against. Adding
 * thirty days is not adding a month; adding `30 * 86_400_000` milliseconds across a daylight-saving
 * boundary is not even adding thirty days, and a weekly bill in Europe/Warsaw that quietly moves
 * from Sunday to Saturday on the last weekend of March is the bug this module exists not to have.
 *
 * ## The month-end rule, which is the whole reason this is not two lines
 *
 * An occurrence's day is **clamped from the anchor, never carried from the previous occurrence**.
 * A series anchored on the 31st is due on the 30th in April and on the 28th in February — and on
 * the **31st again in May**, because each occurrence is computed as
 * `anchor month + n × step, day = min(anchor_day, days in that month)` rather than by adding a
 * month to whatever the last one clamped to. Deriving forward from the clamped date is how a
 * month-end series drifts to the 28th and stays there for the rest of its life.
 *
 * ## `biweekly` counts from `start_date`
 *
 * Fourteen days from the day the series started, forever. Not "every other calendar week", which
 * is a different sequence the moment a year has 53 weeks, and not a weekday anchor — `anchor_day`
 * is ignored for `biweekly` and this is the only frequency for which that is true.
 *
 * ## Nothing here reads a clock, a database or a timezone
 *
 * `from` and `through` are parameters. That is what makes every case below testable at a pinned
 * date, and it is why the two termination rules — `end_date` and `max_occurrences`, at most one of
 * which a series may carry — are honoured here rather than by whoever calls it.
 */

import { getDayOfWeek, parseDate } from '@internationalized/date'

import type { CalendarDate } from '@internationalized/date'
import type { RecurringFrequency } from '#/server/db/schema'

/** The calendar columns of a series, and nothing else. */
export interface RecurringSchedule {
  readonly frequency: RecurringFrequency
  /** Day of the month (1–31) for a month-based frequency, ISO day of the week (1–7) for `weekly`. */
  readonly anchorDay: number | null
  /** `recurring_series.start_date`. The anchor every occurrence is measured from. */
  readonly startDate: string
  /** Inclusive last day, or `null`. Never set together with {@link maxOccurrences}. */
  readonly endDate?: string | null
  /** Inclusive count of occurrences, or `null`. Never set together with {@link endDate}. */
  readonly maxOccurrences?: number | null
}

/** One occurrence: the interval it opens, and the day the money is expected to move. */
export interface RecurringOccurrence {
  /** Zero-based position in the series. What `max_occurrences` counts. */
  readonly index: number
  /** `recurring_periods.period_start` — the first day of the interval this occurrence covers. */
  readonly periodStart: string
  /** `recurring_periods.due_on` — the day it is expected to be paid. */
  readonly dueOn: string
}

/**
 * How far apart two occurrences are.
 *
 * Two units rather than one number, because a month is not a number of days and pretending
 * otherwise is the defect at the top of this file.
 */
const STEP: Readonly<
  Record<RecurringFrequency, { days: number } | { months: number }>
> = {
  weekly: { days: 7 },
  biweekly: { days: 14 },
  monthly: { months: 1 },
  quarterly: { months: 3 },
  semi_annual: { months: 6 },
  annual: { months: 12 },
}

/**
 * A safety rail on the enumeration loop, not a product limit.
 *
 * A weekly series with no termination asked for its next four occurrences walks four steps; a
 * caller who asks for occurrences starting a century after `start_date` walks about five thousand.
 * The cap is what stops a malformed `from` from turning a loop into a hang, and it is high enough
 * that no honest call reaches it.
 */
const MAX_STEPS = 20_000

/** Mon = 1 … Sun = 7, fixed to one locale so the number never depends on the reader's. */
function isoDayOfWeek(date: CalendarDate): number {
  // `getDayOfWeek` is locale-relative — `en-US` weeks start on Sunday, so its 0 is Sunday.
  return ((getDayOfWeek(date, 'en-US') + 6) % 7) + 1
}

/** The months one step covers, or `null` for a day-based frequency. */
function stepMonths(frequency: RecurringFrequency): number | null {
  const step = STEP[frequency]
  return 'months' in step ? step.months : null
}

/** The days one step covers, or `null` for a month-based frequency. */
function stepDays(frequency: RecurringFrequency): number | null {
  const step = STEP[frequency]
  return 'days' in step ? step.days : null
}

/**
 * The day-based origin: `start_date`, moved forward to the anchored weekday when there is one.
 *
 * Forward and never backward, so an occurrence can never precede the day the series began.
 * `biweekly` ignores the anchor entirely — see the module docblock.
 */
function dayOrigin(
  schedule: RecurringSchedule,
  start: CalendarDate,
): CalendarDate {
  if (schedule.frequency !== 'weekly') return start
  const anchor = schedule.anchorDay
  if (anchor === null || anchor < 1 || anchor > 7) return start
  const shift = (anchor - isoDayOfWeek(start) + 7) % 7
  return start.add({ days: shift })
}

/**
 * The month-based origin: the first month whose anchored day is on or after `start_date`.
 *
 * A series that starts on the 20th and is anchored on the 5th has its first occurrence on the 5th
 * of the **next** month, not on a 5th that has already gone by.
 */
function monthOrigin(
  schedule: RecurringSchedule,
  start: CalendarDate,
): CalendarDate {
  const months = stepMonths(schedule.frequency) ?? 1
  const first = clampToMonth(start, anchorDayOf(schedule, start))
  if (first.compare(start) >= 0) return first
  const next = start.add({ months })
  return clampToMonth(next, anchorDayOf(schedule, start))
}

/** The day of the month a month-based series is anchored on: its column, or `start_date`'s day. */
function anchorDayOf(schedule: RecurringSchedule, start: CalendarDate): number {
  const anchor = schedule.anchorDay
  if (anchor === null || anchor < 1 || anchor > 31) return start.day
  return anchor
}

/** `day` inside `month`'s own length: the 31st of April is the 30th, of February the 28th or 29th. */
function clampToMonth(month: CalendarDate, day: number): CalendarDate {
  const lastDay = month.calendar.getDaysInMonth(month)
  return month.set({ day: Math.min(day, lastDay) })
}

/**
 * Occurrence `index`, computed from the origin every time.
 *
 * The clamp is applied to a month reached from the origin, never to a date reached from the
 * previous occurrence, which is what makes the 31st come back in March after February took it to
 * the 28th.
 */
function occurrenceAt(
  schedule: RecurringSchedule,
  origin: CalendarDate,
  anchorDay: number,
  index: number,
): CalendarDate {
  const days = stepDays(schedule.frequency)
  if (days !== null) return origin.add({ days: days * index })

  const months = stepMonths(schedule.frequency) ?? 1
  // `set({ day: 1 })` before the month arithmetic, so a February origin cannot clamp *twice*: the
  // 29th plus one month is the 29th of March, but the 1st plus one month is always the 1st.
  const month = origin.set({ day: 1 }).add({ months: months * index })
  return clampToMonth(month, anchorDay)
}

/** What a period's first day is, per frequency. See {@link RecurringOccurrence}. */
function periodStartFor(
  schedule: RecurringSchedule,
  due: CalendarDate,
): string {
  // A month-based occurrence opens the calendar month it is due in — which is what makes
  // `(series_id, period_start)` name "the March bill" rather than "the bill due on 14 March", and
  // is the shape the demo fixture writes. A day-based one has no wider interval to name, so its
  // period starts on the day it is due.
  if (stepMonths(schedule.frequency) === null) return due.toString()
  return due.set({ day: 1 }).toString()
}

export interface OccurrenceWindow {
  /** Stop after this many occurrences have been collected. */
  readonly count?: number
  /** Ignore occurrences due before this day. Defaults to the series' own start. */
  readonly from?: string
  /** Ignore occurrences due after this day. Inclusive. */
  readonly through?: string
}

/**
 * The occurrences of a series inside a window, oldest first.
 *
 * Terminates on whichever of `end_date`, `max_occurrences`, `through` and `count` comes first.
 * Both stored terminations are **inclusive**: a series with `max_occurrences = 3` has a third
 * occurrence, and one ending on the 1st is due on the 1st.
 */
export function occurrences(
  schedule: RecurringSchedule,
  window: OccurrenceWindow = {},
): ReadonlyArray<RecurringOccurrence> {
  const start = parseDate(schedule.startDate)
  const isMonthly = stepMonths(schedule.frequency) !== null
  const anchorDay = anchorDayOf(schedule, start)
  const origin = isMonthly
    ? monthOrigin(schedule, start)
    : dayOrigin(schedule, start)

  const from = window.from === undefined ? null : parseDate(window.from)
  const through =
    window.through === undefined ? null : parseDate(window.through)
  const endDate =
    schedule.endDate === undefined || schedule.endDate === null
      ? null
      : parseDate(schedule.endDate)
  const limit = schedule.maxOccurrences ?? null
  const wanted = window.count ?? Number.POSITIVE_INFINITY
  // Asking for none returns none. The loop below tests its cap *after* a push, so without this a
  // `count: 0` window would hand back exactly one occurrence — which is how a materialiser told to
  // look zero periods ahead ends up writing one.
  if (wanted <= 0) return []

  const collected: Array<RecurringOccurrence> = []
  for (let index = 0; index < MAX_STEPS; index += 1) {
    if (limit !== null && index >= limit) break
    const due = occurrenceAt(schedule, origin, anchorDay, index)
    if (endDate !== null && due.compare(endDate) > 0) break
    if (through !== null && due.compare(through) > 0) break
    if (from === null || due.compare(from) >= 0) {
      collected.push({
        index,
        periodStart: periodStartFor(schedule, due),
        dueOn: due.toString(),
      })
      if (collected.length >= wanted) break
    }
  }
  return collected
}

export interface NextDueDatesInput extends RecurringSchedule, OccurrenceWindow {
  /** How many dates to return. */
  readonly count: number
}

/**
 * The next `count` due dates of a series, as `YYYY-MM-DD` strings.
 *
 * The named pure function of `13-S1`: no scope, no database, no clock. Everything the period
 * materialiser and the series card need to know about the calendar comes from here, so there is
 * exactly one implementation of "when is this next due" in the product.
 */
export function nextDueDates(input: NextDueDatesInput): ReadonlyArray<string> {
  return occurrences(input, {
    count: input.count,
    ...(input.from === undefined ? {} : { from: input.from }),
    ...(input.through === undefined ? {} : { through: input.through }),
  }).map((occurrence) => occurrence.dueOn)
}
