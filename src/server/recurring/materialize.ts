/**
 * Turning a series' schedule into rows.
 *
 * A period is materialised rather than computed on read for the same reason a budget period is:
 * *"was the March bill paid"* must have an auditable answer that does not change when somebody
 * edits the series in April. The schedule is the plan; these rows are the record.
 *
 * **Idempotent per `(series_id, period_start)` on the ordinary path.** That is the table's own
 * primary key, and this module respects it rather than the other way round: it reads what exists,
 * writes only what does not, and never rewrites a row it finds. A period that has already been
 * paid keeps the `expected_amount_minor` it was created with — what was expected in March is part
 * of March's record, and an edit in April does not get to rewrite it.
 *
 * **An anchor edit is the exception.** `realignOpen` rebuilds unpaid open periods (`upcoming` /
 * `overdue`) against the new schedule so the grid and the forecast name the same dates. Paid and
 * skipped rows stay put; they occupy their occurrence slot so a settled year is not opened twice.
 *
 * Runs from `writeSeries` after a series change and from `catchUpSeries` on a read or the hourly
 * `RECURRING_CRON` branch. Both call the same function with the same arguments, so there is one
 * answer to "which periods exist".
 */

import { parseDate } from '@internationalized/date'
import { z } from 'zod'

import {
  getSeries,
  insertMissingPeriods,
  listPeriodRows,
  removeUnpaidOpenPeriods,
} from '#/server/repos/recurring'

import { occurrences } from './schedule'

import type { RecurringFrequency } from '#/server/db/schema'
import type { TenantScope } from '#/server/repos/base'

export const materializeSchema = z.strictObject({
  seriesId: z.string().trim().min(1).max(64),
  /** The day the run is happening on. A parameter, never a clock read inside this module. */
  today: z.iso.date(),
  /**
   * How many occurrences past today to write.
   *
   * Three is the widget's horizon: enough for *"what is coming"* to mean something on a monthly
   * series without materialising a decade of a weekly one. History is not governed by this — every
   * occurrence from `start_date` up to today is written, because a period a person can mark paid
   * has to exist first.
   */
  ahead: z.number().int().min(0).max(24).default(3),
  /**
   * When true, unpaid open periods are rebuilt against this schedule. Paid and
   * skipped history is left unchanged. Ordinary materialisation leaves this off.
   */
  realignOpen: z.boolean().default(false),
})
export type MaterializeInput = z.input<typeof materializeSchema>

/**
 * The most rows one call will write.
 *
 * A weekly series started six years ago is about 310 occurrences, and writing them is correct.
 * The cap is what stops a `start_date` typo of `1926-01-01` from turning one cron tick into five
 * thousand inserts; the oldest occurrences are the ones dropped, because the recent ones are the
 * ones a person acts on.
 */
const MAX_ROWS_PER_RUN = 400

export interface MaterializeResult {
  readonly seriesId: string
  /** How many rows this call actually inserted. Zero on a second run — that is the whole point. */
  readonly created: number
}

/**
 * Writes the periods of one series that do not exist yet.
 *
 * Paused and completed series are materialised too when asked for directly — the caller decides,
 * and the cron only asks about active ones. That keeps *"stop creating new periods"* a property of
 * the cron's query rather than a rule hidden two modules deep.
 */
export async function materializeSeries(
  scope: TenantScope,
  input: MaterializeInput,
): Promise<MaterializeResult> {
  const parsed = materializeSchema.parse(input)
  const series = await getSeries(scope, parsed.seriesId)

  // At most one of the two terminations is ever set — `createSeries` maps a discriminated union
  // onto the columns, so the pair cannot both be non-null — and the scheduler honours whichever is.
  const schedule = {
    frequency: series.frequency as RecurringFrequency,
    anchorDay: series.anchorDay,
    anchorMonth: series.anchorMonth,
    startDate: series.startDate,
    endDate: series.endDate,
    maxOccurrences: series.maxOccurrences,
  }

  // Everything up to today, then `ahead` more. Two windows rather than one horizon date because
  // "three more occurrences" is a count on a calendar the frequency owns: three more months and
  // three more weeks are different distances, and only the scheduler knows which this is.
  const history = occurrences(schedule, { through: parsed.today })
  const upcoming = occurrences(schedule, {
    from: nextDayOf(parsed.today),
    count: parsed.ahead,
  })

  const wanted = [...history, ...upcoming]
    .slice(-MAX_ROWS_PER_RUN)
    .map((occurrence) => ({
      periodStart: occurrence.periodStart,
      dueOn: occurrence.dueOn,
      // The expectation is copied onto the period at the moment it is created, and is never
      // refreshed. A later edit of the series changes what future periods will say and leaves
      // every existing one exactly as it was.
      expectedAmountMinor: series.expectedAmountMinor,
      expectedCurrencyCode: series.expectedCurrencyCode,
    }))

  const existing = parsed.realignOpen
    ? await listPeriodRows(scope, series.id)
    : []
  const occupied = parsed.realignOpen
    ? wantedStartsOccupiedBySettled(existing, wanted)
    : new Set<string>()
  if (parsed.realignOpen) {
    await removeUnpaidOpenPeriods(scope, series.id)
  }

  const created = await insertMissingPeriods(
    scope,
    series.id,
    wanted.filter((row) => !occupied.has(row.periodStart)),
  )
  return { seriesId: series.id, created }
}

function isSettledStatus(status: string): boolean {
  return status === 'paid' || status === 'skipped'
}

/**
 * Occurrence slots already taken by paid or skipped history, keyed by the new
 * schedule's `period_start`. Index pairing is by due date: the nth stored row
 * is the nth occurrence, even when the anchor moved the calendar day.
 */
function wantedStartsOccupiedBySettled(
  existing: ReadonlyArray<{
    readonly periodStart: string
    readonly dueOn: string
    readonly status: string
  }>,
  wanted: ReadonlyArray<{ readonly periodStart: string }>,
): Set<string> {
  const ordered = [...existing].sort((left, right) => {
    if (left.dueOn !== right.dueOn) return left.dueOn < right.dueOn ? -1 : 1
    return left.periodStart < right.periodStart
      ? -1
      : left.periodStart > right.periodStart
        ? 1
        : 0
  })
  const occupied = new Set<string>()
  for (
    let index = 0;
    index < ordered.length && index < wanted.length;
    index += 1
  ) {
    const row = ordered.at(index)
    const occurrence = wanted.at(index)
    if (row === undefined || occurrence === undefined) break
    if (isSettledStatus(row.status)) {
      occupied.add(occurrence.periodStart)
    }
  }
  return occupied
}

/** The day after `day`, on the calendar. Never `Date` arithmetic — see `./schedule`. */
function nextDayOf(day: string): string {
  return parseDate(day).add({ days: 1 }).toString()
}
