/**
 * The two recurring cron branches, as one module the Worker can call and a test can drive.
 *
 * - the hourly `RECURRING_CRON` → {@link runRecurringHourly}: materialise the periods every active series is owed,
 *   then post the ones an `auto_record` series has let come due.
 * - the quarter-hourly `REMINDER_CRON` → {@link runRecurringReminderSweep}: work out which reminders are due today and
 *   hand them to plan `21`'s dispatcher, which is a **named no-op** until `21-S1` lands.
 *
 * **Per workspace, per scope, and the scope is a real one.** `listCronScopes` builds one scope per
 * workspace with its owner as the principal, so every row the cron touches goes through the same
 * tenant predicate a request would. There is no "cron super-user" that can see across workspaces,
 * which is what makes the isolation test over this path meaningful rather than decorative.
 *
 * **A failing workspace does not stop the sweep.** One workspace's missing exchange rate must not
 * mean nobody else's bills are posted, so each is wrapped and its failure is logged with the
 * workspace named. The alternative — a sweep that dies on the first bad row — fails silently for
 * everybody after it, which is the worst of both.
 *
 * Nothing here reads a clock except {@link cronToday}, once, at the top: every module below takes
 * the day as a parameter, which is what makes the whole path testable at a pinned date.
 */

import { parseDate } from '@internationalized/date'

import { runAutoRecord } from '#/server/recurring/auto-record'
import { materializeSeries } from '#/server/recurring/materialize'
import {
  dispatchReminders,
  dueReminders,
  isRecurringReminderDispatcherInstalled,
} from '#/server/recurring/reminders'
import {
  listDuePeriodRows,
  listSeries,
  readRemindBefore,
} from '#/server/repos/recurring'

import { reminderMarkerKey } from '#/server/recurring/markers'

import type { MarkerStore } from '#/server/recurring/markers'
import type { ReminderSubject } from '#/server/recurring/reminders'
import type { Logger } from '#/server/observability/logger'
import type { TenantScope } from '#/server/repos/base'

/**
 * The UTC calendar day, decided once per invocation.
 *
 * UTC because that is `booked_on`'s and `due_on`'s own definition (`docs/MONEY.md` §6.1). A cron
 * that used the Worker's local idea of "today" would post a bill on the wrong calendar day for
 * every workspace east of it.
 */
export function cronToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export interface RecurringCronArgs {
  readonly scopes: ReadonlyArray<TenantScope>
  readonly markers: MarkerStore
  readonly today: string
  readonly logger: Logger
  /** How far ahead to materialise. The widget's horizon; see `recurring/materialize`. */
  readonly ahead?: number
}

export interface RecurringCronReport {
  readonly workspaces: number
  readonly periodsCreated: number
  readonly transactionsPosted: number
  readonly failures: number
}

/**
 * The the hourly `RECURRING_CRON` branch: materialise, then auto-record.
 *
 * In that order and never the other way round, because a period that has not been materialised
 * cannot be posted — a series created between two ticks would otherwise wait a full hour for its
 * first bill and there would be no way to tell that from a broken auto-record.
 */
export async function runRecurringHourly(
  args: RecurringCronArgs,
): Promise<RecurringCronReport> {
  let periodsCreated = 0
  let transactionsPosted = 0
  let failures = 0

  for (const scope of args.scopes) {
    try {
      for (const series of await listSeries(scope, {})) {
        const result = await materializeSeries(scope, {
          seriesId: series.id,
          today: args.today,
          ...(args.ahead === undefined ? {} : { ahead: args.ahead }),
        })
        periodsCreated += result.created
      }

      const posted = await runAutoRecord({
        scope,
        markers: args.markers,
        today: args.today,
        onRefusal: (outcome) => {
          args.logger.warn('recurring auto-record declined a period', {
            organizationId: scope.ctx.organizationId,
            seriesId: outcome.seriesId,
            periodStart: outcome.periodStart,
            reason: outcome.skipped ?? 'unknown',
          })
        },
      })
      transactionsPosted += posted.posted
    } catch (error) {
      failures += 1
      // The error goes in the error slot, not in the fields: `logger.error` serialises it there,
      // and a caught error passed as fields loses its message and its stack.
      args.logger.error(
        'recurring hourly sweep failed for a workspace',
        error,
        {
          organizationId: scope.ctx.organizationId,
        },
      )
    }
  }

  return {
    workspaces: args.scopes.length,
    periodsCreated,
    transactionsPosted,
    failures,
  }
}

export interface ReminderSweepReport {
  readonly workspaces: number
  readonly dispatched: number
  readonly failures: number
  /** False until `21-S1` installs a dispatcher. Logged, so the gap is visible in production. */
  readonly dispatcherInstalled: boolean
}

/**
 * The the quarter-hourly `REMINDER_CRON` branch: which reminders are due today, deduped, handed onward.
 *
 * The marker is written **after** the dispatch, so a failed delivery is retried on the next tick
 * rather than swallowed. Fifteen minutes is the resolution; a reminder is per day, so at most one
 * of the ninety-six ticks in a day actually sends anything for a given period.
 */
export async function runRecurringReminderSweep(
  args: RecurringCronArgs,
): Promise<ReminderSweepReport> {
  let dispatched = 0
  let failures = 0

  for (const scope of args.scopes) {
    try {
      const subjects = await reminderSubjectsFor(scope, args.today)
      const due = dueReminders(subjects, args.today)

      const fresh = []
      for (const reminder of due) {
        const key = reminderMarkerKey(reminder)
        if (await args.markers.seen(key)) continue
        fresh.push({ reminder, key })
      }
      if (fresh.length === 0) continue

      await dispatchReminders(
        scope,
        fresh.map((entry) => entry.reminder),
      )
      for (const entry of fresh) await args.markers.remember(entry.key)
      dispatched += fresh.length
    } catch (error) {
      failures += 1
      args.logger.error(
        'recurring reminder sweep failed for a workspace',
        error,
        { organizationId: scope.ctx.organizationId },
      )
    }
  }

  return {
    workspaces: args.scopes.length,
    dispatched,
    failures,
    dispatcherInstalled: isRecurringReminderDispatcherInstalled(),
  }
}

/**
 * The unpaid periods of one workspace that a reminder could be about, with their series' settings.
 *
 * The horizon is a month out — the longest `remind_before` offset — so a sweep reads the smallest
 * set that can possibly produce a dispatch rather than every period the workspace holds.
 */
async function reminderSubjectsFor(
  scope: TenantScope,
  today: string,
): Promise<ReadonlyArray<ReminderSubject>> {
  const horizon = monthAhead(today)
  const rows = await listDuePeriodRows(scope, horizon)
  return rows.map(({ period, series }) => ({
    seriesId: series.id,
    seriesName: series.name,
    notifyEmail: series.notifyEmail,
    remindBefore: readRemindBefore(series.remindBefore),
    periodStart: period.periodStart,
    dueOn: period.dueOn,
    expectedAmountMinor: period.expectedAmountMinor,
    expectedCurrencyCode: period.expectedCurrencyCode,
  }))
}

/** One calendar month past `today`. The furthest a `remind_before` offset can reach. */
function monthAhead(today: string): string {
  return parseDate(today).add({ months: 1 }).toString()
}
