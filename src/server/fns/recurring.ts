/**
 * The recurring server functions: the only door between a route and the recurring repositories.
 *
 * The same three jobs as `fns/budgets`, for the same reasons.
 *
 * **Zod at the boundary**, with the very schemas the repository re-parses with. The second parse
 * is not ceremony: the cron, the matcher and the seed reach those repositories without passing
 * through this file, so the repository cannot rely on anything here having happened.
 *
 * **`requireOrg()` inside every handler**, never in a `beforeLoad`. A route guard is UX; a series
 * id in a URL is not an authorised id until a tenant-scoped query has failed to find it elsewhere.
 *
 * **No `runWithLedgerBatch` anywhere in this file, and that is a statement.** A series is a plan,
 * a period is an expectation and a link is a pointer — none of the three is money, none of them
 * moves a day of an account's balance history. The one path in this feature that *does* write a
 * transaction is `recurring/auto-record`, which opens its own batch, and it runs from the cron.
 * If `runWithLedgerBatch` ever appears here, either a screen started minting transactions or
 * somebody added it defensively; both are worth catching in review.
 *
 * **`today` is decided here, once per call.** Every module below takes the day as a parameter and
 * reads no clock, which is what makes a due date, an overdue derivation and a reminder testable at
 * a pinned date. It is the UTC calendar day, matching `booked_on`'s definition in `docs/MONEY.md`
 * §6.1; the reader's timezone is applied at render and only there.
 *
 * Reads are `GET` so the router can cache and prefetch them; every write is `POST`.
 */

import { parseDate } from '@internationalized/date'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import { confidenceBand, detectCandidates } from '#/server/recurring/detect'
import { materializeSeries } from '#/server/recurring/materialize'
import {
  acceptCandidate as acceptCandidateRow,
  candidateSchema,
  createSeries as createSeriesRow,
  createSeriesSchema,
  completeSeries as completeSeriesRow,
  deleteSeries as deleteSeriesRow,
  dismissCandidate as dismissCandidateRow,
  getSeries as getSeriesRow,
  getUpcoming as getUpcomingRow,
  listCandidates as listCandidatesRow,
  listDetectionRows,
  listPeriods as listPeriodsRow,
  listSeries as listSeriesRow,
  listSeriesLinkDetails,
  listSeriesLinks,
  markPaid as markPaidRow,
  markPaidSchema,
  markSkipped as markSkippedRow,
  pauseSeries as pauseSeriesRow,
  periodKeySchema,
  replacePendingCandidates,
  resumeSeries as resumeSeriesRow,
  revertPeriod as revertPeriodRow,
  terminationOf,
  unlinkTransaction as unlinkTransactionRow,
  updateSeries as updateSeriesRow,
  updateSeriesSchema,
} from '#/server/repos/recurring'

import type {
  PeriodView,
  SeriesLink,
  UpcomingPeriod,
} from '#/server/repos/recurring'
import type { RecurringCandidate, RecurringSeries } from '#/server/db/types'
import type { WeakestSignal } from '#/server/recurring/detect'

const seriesIdSchema = z.strictObject({
  seriesId: z.string().trim().min(1).max(64),
})

const listInputSchema = z.strictObject({
  includeInactive: z.boolean().default(false),
})

/** How far ahead the list and the detail screen materialise. Three periods is one screen's worth. */
const AHEAD = 3

/** How far back the detector reads. Eighteen months is enough for an annual series to show thrice. */
const DETECTION_MONTHS = 18

/** The UTC calendar day. See the module docblock for why it is decided here and only here. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** One row of the series list: the series, plus the one period the card is actually about. */
export interface SeriesListRow {
  readonly series: RecurringSeries
  /** The oldest unsettled period, or `null` for a series with nothing outstanding. */
  readonly next: PeriodView | null
  /** How many unsettled periods are already past their due date. Drives the "overdue" wording. */
  readonly overdueCount: number
}

export interface RecurringOverview {
  readonly rows: ReadonlyArray<SeriesListRow>
  /** What is due within the next month plus everything already late, across every series. */
  readonly upcoming: ReadonlyArray<UpcomingPeriod>
  readonly pendingCandidates: number
  /** The day the derivation was made on, so the screen labels "overdue" against the same date. */
  readonly today: string
}

/**
 * Everything `/recurring` draws, in one round trip.
 *
 * The materialisation happens on read rather than only in the cron, and on purpose: a series
 * created a minute ago must show its first due date immediately, and "wait until seven past the
 * hour" is not an acceptable answer to *where is my bill*. `insertMissingPeriods` is idempotent,
 * so a second reader in the same minute writes nothing.
 */
export const loadRecurring = createServerFn({ method: 'GET' })
  .inputValidator(listInputSchema)
  .handler(async ({ data }): Promise<RecurringOverview> => {
    const scope = await requireOrg()
    const today = todayUtc()

    const series = await listSeriesRow(scope, {
      includeInactive: data.includeInactive,
    })
    for (const one of series) {
      if (one.isActive) {
        await materializeSeries(scope, {
          seriesId: one.id,
          today,
          ahead: AHEAD,
        })
      }
    }

    const [upcoming, candidates] = await Promise.all([
      getUpcomingRow(scope, { today, within: 30, limit: 50 }),
      listCandidatesRow(scope, 'pending'),
    ])

    const rows = await Promise.all(
      series.map(async (one): Promise<SeriesListRow> => {
        const periods = await listPeriodsRow(scope, one.id, today)
        const open = periods.filter(
          (period) =>
            period.derivedStatus === 'upcoming' ||
            period.derivedStatus === 'overdue',
        )
        return {
          series: one,
          next: open.at(0) ?? null,
          overdueCount: open.filter(
            (period) => period.derivedStatus === 'overdue',
          ).length,
        }
      }),
    )

    return {
      rows,
      upcoming,
      pendingCandidates: candidates.length,
      today,
    }
  })

/** What the detail screen draws: the series, its whole period history and its adopted rows. */
export interface SeriesDetail {
  readonly series: RecurringSeries
  readonly periods: ReadonlyArray<PeriodView>
  readonly links: ReadonlyArray<SeriesLink>
  readonly today: string
}

export const loadSeriesDetail = createServerFn({ method: 'GET' })
  .inputValidator(seriesIdSchema)
  .handler(async ({ data }): Promise<SeriesDetail> => {
    const scope = await requireOrg()
    const today = todayUtc()
    const series = await getSeriesRow(scope, data.seriesId)
    if (series.isActive) {
      await materializeSeries(scope, {
        seriesId: series.id,
        today,
        ahead: AHEAD,
      })
    }
    const [periods, links] = await Promise.all([
      listPeriodsRow(scope, series.id, today),
      listSeriesLinkDetails(scope, series.id),
    ])
    return { series, periods, links, today }
  })

/**
 * One proposal as the card renders it: the row, plus the **word** for its confidence.
 *
 * The band is computed here rather than in the browser so `confidenceBand` stays the one place
 * the two thresholds live. A component cannot import it: `recurring/detect` reaches
 * `#/server/db/schema` for its frequency list, and a value import of that would pull Drizzle's
 * table builder into the client bundle.
 *
 * `weakestSignal` is **not** here, and cannot be: `recurring_candidates` has no column for it, and
 * adding one means a migration under `drizzle/`. The detector still reports it -
 * {@link DetectionReport} carries it for the run that produced the proposals - so the candidates
 * screen can show the reason for a fresh run and shows the band alone for an older one. See the
 * handover note.
 */
export interface CandidateRow {
  readonly candidate: RecurringCandidate
  readonly band: 'high' | 'medium' | 'low'
}

/** The proposals waiting for a decision, best first. */
export const loadCandidates = createServerFn({ method: 'GET' })
  .inputValidator(z.strictObject({}))
  .handler(async (): Promise<ReadonlyArray<CandidateRow>> => {
    const scope = await requireOrg()
    const rows = await listCandidatesRow(scope, 'pending')
    return rows.map((candidate) => ({
      candidate,
      band: confidenceBand(candidate.confidence),
    }))
  })

/* -------------------------------------------------------------------------- */
/* Writes — series                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Creates a series and materialises the periods it should already have.
 *
 * The materialisation is a *product* decision, exactly as it is for a budget: a series backdated
 * to January should show January through today the moment it is saved, and making the first thing
 * a person sees after saving be an empty screen is not a defensible default.
 */
export const createSeries = createServerFn({ method: 'POST' })
  .inputValidator(createSeriesSchema)
  .handler(async ({ data }): Promise<{ readonly seriesId: string }> => {
    const scope = await requireOrg()
    const series = await createSeriesRow(scope, data)
    await materializeSeries(scope, {
      seriesId: series.id,
      today: todayUtc(),
      ahead: AHEAD,
    })
    return { seriesId: series.id }
  })

const updateInputSchema = z.strictObject({
  seriesId: z.string().trim().min(1).max(64),
  patch: updateSeriesSchema,
})

/**
 * Edits a series, then materialises against the new schedule.
 *
 * Periods already settled are untouched: `insertMissingPeriods` only ever inserts. A frequency
 * change therefore adds the dates the new schedule implies and leaves the paid history alone,
 * which is the auditable behaviour — rewriting a settled period to fit a schedule invented
 * afterwards would make the history a function of the current settings rather than of what
 * happened.
 */
export const updateSeries = createServerFn({ method: 'POST' })
  .inputValidator(updateInputSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await updateSeriesRow(scope, data.seriesId, data.patch)
    await materializeSeries(scope, {
      seriesId: data.seriesId,
      today: todayUtc(),
      ahead: AHEAD,
    })
  })

/** Stops the cron acting on a series. Its history stays, and so do its unpaid periods. */
export const pauseSeries = createServerFn({ method: 'POST' })
  .inputValidator(seriesIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await pauseSeriesRow(scope, data.seriesId)
  })

/** Restarts a paused series and catches its schedule up to today. */
export const resumeSeries = createServerFn({ method: 'POST' })
  .inputValidator(seriesIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await resumeSeriesRow(scope, data.seriesId)
    await materializeSeries(scope, {
      seriesId: data.seriesId,
      today: todayUtc(),
      ahead: AHEAD,
    })
  })

/** Ends a series for good. Distinct from pausing: nothing further is ever materialised. */
export const completeSeries = createServerFn({ method: 'POST' })
  .inputValidator(seriesIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await completeSeriesRow(scope, data.seriesId)
  })

/** Deletes a series that never settled a period. The repository refuses — with the count — if it did. */
export const deleteSeries = createServerFn({ method: 'POST' })
  .inputValidator(seriesIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await deleteSeriesRow(scope, data.seriesId)
  })

/* -------------------------------------------------------------------------- */
/* Writes — periods                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Links an existing transaction to a period.
 *
 * **It never creates one.** The transaction is chosen from rows that already exist, because a
 * "mark paid" that mints money would let a mis-click add a payment nobody made and would put a
 * balance rebuild behind a button whose label says nothing about money moving.
 */
export const markPeriodPaid = createServerFn({ method: 'POST' })
  .inputValidator(markPaidSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await markPaidRow(scope, data)
  })

/** Records that a period was deliberately not paid. */
export const skipPeriod = createServerFn({ method: 'POST' })
  .inputValidator(periodKeySchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await markSkippedRow(scope, data)
  })

/** Undoes a mark-paid or a skip. The link is retired, never deleted. */
export const revertPeriod = createServerFn({ method: 'POST' })
  .inputValidator(periodKeySchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await revertPeriodRow(scope, data)
  })

/** Detaches a transaction a matcher adopted. The transaction itself is not touched. */
export const unlinkTransaction = createServerFn({ method: 'POST' })
  .inputValidator(
    z.strictObject({
      seriesId: z.string().trim().min(1).max(64),
      transactionId: z.string().trim().min(1).max(64),
    }),
  )
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await unlinkTransactionRow(scope, data)
  })

/* -------------------------------------------------------------------------- */
/* Writes — candidates                                                         */
/* -------------------------------------------------------------------------- */

/** What one detection run found, and which signal held each proposal back. */
export interface DetectionReport {
  readonly found: number
  readonly weakest: ReadonlyArray<{
    readonly suggestedName: string
    readonly weakestSignal: WeakestSignal
  }>
}

/**
 * Re-runs detection over the last eighteen months and replaces the pending proposals.
 *
 * Only the pending ones: a dismissal is remembered so the same suggestion is not made again next
 * month, and an acceptance is history. That is what makes this safe to put behind a button.
 */
export const detectRecurring = createServerFn({ method: 'POST' })
  .inputValidator(z.strictObject({}))
  .handler(async (): Promise<DetectionReport> => {
    const scope = await requireOrg()
    const today = todayUtc()
    const from = monthsBefore(today, DETECTION_MONTHS)

    const [rows, series, dismissed] = await Promise.all([
      listDetectionRows(scope, { from, to: today }),
      listSeriesRow(scope, { includeInactive: true }),
      listCandidatesRow(scope, 'dismissed'),
    ])

    const linked: Array<string> = []
    for (const one of series) {
      for (const link of await listSeriesLinks(scope, one.id)) {
        if (link.status === 'active') linked.push(link.transactionId)
      }
    }

    const detected = detectCandidates(rows, {
      linkedTransactionIds: linked,
      excludedPayeeIds: [
        ...series.flatMap((one) => (one.payeeId === null ? [] : [one.payeeId])),
        ...dismissed.flatMap((one) =>
          one.payeeId === null ? [] : [one.payeeId],
        ),
      ],
    })

    await replacePendingCandidates(
      scope,
      detected.map((one) =>
        candidateSchema.parse({
          suggestedName: one.suggestedName,
          payeeId: one.payeeId,
          expectedAmountMinor: one.expectedAmountMinor,
          expectedCurrencyCode: one.expectedCurrencyCode,
          frequency: one.frequency,
          confidence: one.confidence,
          sampleTransactionIds: one.sampleTransactionIds,
        }),
      ),
    )

    return {
      found: detected.length,
      weakest: detected.map((one) => ({
        suggestedName: one.suggestedName,
        weakestSignal: one.weakestSignal,
      })),
    }
  })

/** Refuses a proposal, permanently. The detector will not make it again. */
export const dismissCandidate = createServerFn({ method: 'POST' })
  .inputValidator(
    z.strictObject({ candidateId: z.string().trim().min(1).max(64) }),
  )
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await dismissCandidateRow(scope, data.candidateId)
  })

/**
 * Turns a proposal into a series, then materialises it.
 *
 * The payload is a full series input rather than the candidate's own columns, so every field can
 * be adjusted in the form before it becomes something the cron acts on. Nothing here writes a
 * transaction: the samples that produced the proposal stay exactly as they are.
 */
export const acceptCandidate = createServerFn({ method: 'POST' })
  .inputValidator(
    z.strictObject({
      candidateId: z.string().trim().min(1).max(64),
      series: createSeriesSchema,
    }),
  )
  .handler(async ({ data }): Promise<{ readonly seriesId: string }> => {
    const scope = await requireOrg()
    const series = await acceptCandidateRow(scope, {
      candidateId: data.candidateId,
      series: data.series,
    })
    await materializeSeries(scope, {
      seriesId: series.id,
      today: todayUtc(),
      ahead: AHEAD,
    })
    return { seriesId: series.id }
  })

/** The termination a stored series carries, in the shape the form speaks. Re-exported for routes. */
export { terminationOf }

/** `YYYY-MM-DD`, `months` earlier, on the calendar. Never `Date` arithmetic. */
function monthsBefore(day: string, months: number): string {
  return parseDate(day).subtract({ months }).toString()
}
