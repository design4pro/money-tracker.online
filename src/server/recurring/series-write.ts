/**
 * Writing a series, then materialising its periods: the one place that rule lives.
 *
 * *"After any change to a series, write the periods it should have"* used to be four hand-written
 * `materializeSeries` calls in the server-function file, and a fifth series-writing handler that
 * forgot the call passed every test. The server functions now hand the change to {@link writeSeries}
 * and keep what is theirs: the guard, the input validation and the day. The structural guard in
 * `fns/__tests__/recurring-writes.test.ts` keeps the repository's four series writers out of that
 * file, so a new one can only reach them through here.
 *
 * **It lives in `recurring/`, not in a repository,** because {@link materializeSeries} imports the
 * repositories. A repository that called it would be a cycle.
 *
 * **It derives nothing.** The scope arrives already built (a tenant is authorised by the caller, not
 * decided here) and `today` arrives as a parameter, so a test pins the day and the module reads no
 * clock.
 *
 * **Write, then materialise: two sequential calls, not one transaction.** A write that succeeds
 * and a materialisation that throws leaves the series written and its periods missing, and the next
 * read or the hourly sweep fills them in - `insertMissingPeriods` is idempotent. An error from
 * either call reaches the caller unchanged.
 *
 * **Pause, complete and delete are not here, and that is a statement:** none of them adds a period.
 * Nor are the period writes, which settle a row that exists. Update and resume materialise whatever
 * the series' active state; the cron, which asks only about active series, owns "stop creating new
 * periods".
 */

import {
  acceptCandidate,
  createSeries,
  resumeSeries,
  updateSeries,
} from '#/server/repos/recurring'

import { materializeSeries } from './materialize'

import type { TenantScope } from '#/server/repos/base'
import type {
  CreateSeriesInput,
  UpdateSeriesInput,
} from '#/server/repos/recurring'

/** How far ahead the list and the detail screen materialise. Three periods is one screen's worth. */
export const SERIES_AHEAD = 3

/** The four edits to a series that must leave its periods written. */
export type SeriesChange =
  | { readonly kind: 'create'; readonly input: CreateSeriesInput }
  | {
      readonly kind: 'update'
      readonly seriesId: string
      readonly patch: UpdateSeriesInput
    }
  | { readonly kind: 'resume'; readonly seriesId: string }
  | {
      readonly kind: 'accept'
      readonly candidateId: string
      readonly series: CreateSeriesInput
    }

export interface WriteSeriesInput {
  /** The day the write is happening on. A parameter, never a clock read inside this module. */
  readonly today: string
  /** How many occurrences past today to write; {@link SERIES_AHEAD} for the screens. */
  readonly ahead: number
  readonly change: SeriesChange
}

/** Applies one change to a series, materialises that series and returns its id. */
export async function writeSeries(
  scope: TenantScope,
  { today, ahead, change }: WriteSeriesInput,
): Promise<{ readonly seriesId: string }> {
  const series = await applyChange(scope, change)
  await materializeSeries(scope, { seriesId: series.id, today, ahead })
  return { seriesId: series.id }
}

function applyChange(scope: TenantScope, change: SeriesChange) {
  switch (change.kind) {
    case 'create':
      return createSeries(scope, change.input)
    case 'update':
      return updateSeries(scope, change.seriesId, change.patch)
    case 'resume':
      return resumeSeries(scope, change.seriesId)
    case 'accept':
      return acceptCandidate(scope, {
        candidateId: change.candidateId,
        series: change.series,
      })
  }
}
