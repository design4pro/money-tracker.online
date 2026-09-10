/**
 * The three producers' events, turned into notifications for the people in the workspace.
 *
 * ---------------------------------------------------------------------------
 * ONE EVENT IS NOT ONE NOTIFICATION
 * ---------------------------------------------------------------------------
 *
 * A crossing happens to a *budget*, which belongs to a household; a notification happens to a
 * *person*. Fanning out over `listMembers` is where that turns from one into several, and it is why
 * `dedupe_key` is scoped to `(organization, user, key)` rather than to the workspace: two members
 * both get told, once each.
 *
 * The membership list is read once per call rather than once per recipient-event. A five-member
 * household with twenty crossings is one list and twenty × five dispatches, not a hundred lists.
 *
 * ---------------------------------------------------------------------------
 * WHO ESCALATES, AND WHO DOES NOT
 * ---------------------------------------------------------------------------
 *
 * The two cron adapters throw on `'failed'`. `notify` deliberately never throws, which means a
 * permanently broken channel would otherwise be a sweep that reports success forever; the throw
 * lands in the cron's own `catch`, which is the nearest place that has a logger and a workspace to
 * name, and it becomes one `failures` count the run summary already carries.
 *
 * The goals adapter wraps its **entire body** and throws nothing. It runs inside
 * `#/server/fns/goals`, after a contribution has committed: a notification that cannot be written
 * must not turn a saved contribution into an error on the person's screen. That asymmetry is
 * deliberate and it is the reason the two are separate functions rather than one with a flag.
 *
 * Silent toward the person is not silent toward the operator, though. `#/server/goals/reached`
 * says of its own seam that swallowing a failure "would make a permanently broken channel
 * invisible, which is the one outcome worse than a loud one", and the goals path has no cron
 * summary to land in. {@link logGoalDispatchFailure} is where it lands instead.
 */

import { subtractMinor } from '#/lib/money'
import {
  BUDGET_EXCEEDED_EVENT,
  BUDGET_THRESHOLD_EVENT,
  crossingMarkerKey,
} from '#/server/budgets/thresholds'
import { GOAL_REACHED_EVENT } from '#/server/goals/reached'
import { loggerFromEnv } from '#/server/observability/logger'
import { reminderMarkerKey } from '#/server/recurring/markers'
import { listMembers } from '#/server/repos/members'

import { goalReachedDedupeKey } from './dedupe'
import { notify } from './dispatch'

import type {
  BudgetAlertDispatcher,
  ThresholdCrossing,
} from '#/server/budgets/thresholds'
import type { GoalReachedDispatcher } from '#/server/goals/reached'
import type { RecurringReminderDispatcher } from '#/server/recurring/reminders'
import type { TenantScope } from '#/server/repos/scope'
import type { NotifyOutcome } from './dispatch'

type Outcomes = ReadonlyArray<{
  readonly kind: string
  readonly outcome: NotifyOutcome
}>

/**
 * How many dispatches failed and of what, or `null` when none did.
 *
 * The sentence carries counts and kinds, never a `userId`: it ends up in a log line either way, and
 * who did not get told is not a fact a log needs in order to say that something is broken. It is
 * built here rather than at each of the three call sites so the cron's escalation and the goals
 * path's log line are the same sentence.
 */
function describeFailures(outcomes: Outcomes): string | null {
  const failed = outcomes.filter((entry) => entry.outcome === 'failed')
  if (failed.length === 0) return null

  const kinds = [...new Set(failed.map((entry) => entry.kind))].sort()
  return `${failed.length} notification dispatch(es) failed for ${kinds.join(', ')}`
}

/** Throws {@link describeFailures} when there is one. What the two cron adapters do with it. */
function escalate(outcomes: Outcomes): void {
  const message = describeFailures(outcomes)
  if (message !== null) throw new Error(message)
}

/** What both budget kinds carry. The exceeded one adds `overspentMinor` on top. */
function crossingBase(crossing: ThresholdCrossing) {
  return {
    v: 1,
    budgetId: crossing.budgetId,
    budgetName: crossing.budgetName,
    periodStart: crossing.periodStart,
    threshold: crossing.threshold,
    spentMinor: crossing.spentMinor,
    availableMinor: crossing.availableMinor,
    currencyCode: crossing.currencyCode,
  } as const
}

/**
 * One crossing, for one person.
 *
 * The two arms are spelled out rather than folded into one call with a cast: the registry types
 * `payload` from `kind`, so a `budget.exceeded` without `overspentMinor` is a compile error — and
 * that is the entire value of the registry. A single `as never` would give it all back.
 */
async function notifyCrossing(
  scope: TenantScope,
  userId: string,
  crossing: ThresholdCrossing,
  dedupeKey: string,
): Promise<NotifyOutcome> {
  if (crossing.event === BUDGET_THRESHOLD_EVENT) {
    return notify(scope, {
      userId,
      kind: BUDGET_THRESHOLD_EVENT,
      payload: crossingBase(crossing),
      dedupeKey,
    })
  }

  return notify(scope, {
    userId,
    kind: BUDGET_EXCEEDED_EVENT,
    payload: {
      ...crossingBase(crossing),
      // `subtractMinor` and not a bare `-`: it is the same quantity and the same name
      // `#/server/budgets/utilisation` ships, and the helper keeps it integer at every scale.
      overspentMinor: subtractMinor(
        crossing.spentMinor,
        crossing.availableMinor,
      ),
    },
    dedupeKey,
  })
}

export const notifyBudgetAlerts: BudgetAlertDispatcher = async (
  scope,
  crossings,
) => {
  if (crossings.length === 0) return

  const members = await listMembers(scope)
  const outcomes: Array<{ kind: string; outcome: NotifyOutcome }> = []

  for (const crossing of crossings) {
    // Reused verbatim, so the KV marker the sweep writes and the row this writes name the same
    // occasion. Two similar-looking template strings would be one rename away from disagreeing.
    const dedupeKey = crossingMarkerKey(crossing)
    for (const member of members) {
      outcomes.push({
        kind: crossing.event,
        outcome: await notifyCrossing(
          scope,
          member.userId,
          crossing,
          dedupeKey,
        ),
      })
    }
  }

  escalate(outcomes)
}

export const notifyRecurringReminders: RecurringReminderDispatcher = async (
  scope,
  reminders,
) => {
  if (reminders.length === 0) return

  const members = await listMembers(scope)
  const outcomes: Array<{ kind: string; outcome: NotifyOutcome }> = []

  for (const reminder of reminders) {
    const dedupeKey = reminderMarkerKey(reminder)
    const payload = {
      v: 1,
      seriesId: reminder.seriesId,
      seriesName: reminder.seriesName,
      periodStart: reminder.periodStart,
      dueOn: reminder.dueOn,
      expectedAmountMinor: reminder.expectedAmountMinor,
      expectedCurrencyCode: reminder.expectedCurrencyCode,
      offset: reminder.offset,
    } as const

    for (const member of members) {
      outcomes.push({
        kind: reminder.event,
        outcome: await notify(scope, {
          userId: member.userId,
          kind: reminder.event,
          payload,
          dedupeKey,
          // The series' own flag, as a one-way lever: a series with reminders switched off cannot
          // email, and a series with them on still cannot override a person's preference.
          suppressEmail: !reminder.notifyEmail,
        }),
      })
    }
  }

  escalate(outcomes)
}

/**
 * The operator's copy of a failure the person is deliberately not shown.
 *
 * The two cron adapters escalate, and the sweep's own `catch` has both a {@link Logger} and a
 * workspace to name. The goals path has neither: it ends in a handler that must not rethrow. So it
 * reaches the binding itself, which is what `#/server/fns/members` does for the same reason — the
 * import is dynamic because `cloudflare:workers` does not resolve in the `server` test project, and
 * `vitest.config.ts` forbids it in that graph.
 *
 * The whole thing is guarded. An adapter whose contract is "never throws" must not acquire a new
 * way to throw in the act of acquiring a way to be seen.
 */
async function logGoalDispatchFailure(
  scope: TenantScope,
  message: string,
  error?: unknown,
): Promise<void> {
  try {
    const { env } = await import('cloudflare:workers')
    loggerFromEnv(env, {
      context: {
        component: 'worker',
        route: GOAL_REACHED_EVENT,
        orgId: scope.ctx.organizationId,
      },
    }).error(message, error)
  } catch {
    // No Worker environment — a plain Node test run, or a sink that itself failed. The caller's
    // contract is unchanged either way.
  }
}

/**
 * Announces one reached goal to everybody in the household.
 *
 * The whole body is wrapped: this runs inside the request that recorded the contribution, and the
 * contribution is the thing that mattered. Even `listMembers` throwing is swallowed — a database
 * that cannot answer who lives here is not a reason to tell somebody their money did not save.
 */
export const notifyGoalReached: GoalReachedDispatcher = async (
  scope,
  event,
) => {
  try {
    const members = await listMembers(scope)
    const dedupeKey = goalReachedDedupeKey({ goalId: event.goalId })
    const outcomes: Array<{ kind: string; outcome: NotifyOutcome }> = []

    for (const member of members) {
      outcomes.push({
        kind: GOAL_REACHED_EVENT,
        outcome: await notify(scope, {
          userId: member.userId,
          kind: GOAL_REACHED_EVENT,
          payload: {
            v: 1,
            goalId: event.goalId,
            name: event.name,
            targetMinor: event.targetMinor,
            contributedMinor: event.contributedMinor,
            currencyCode: event.currencyCode,
            transactionId: event.transactionId,
          },
          dedupeKey,
        }),
      })
    }

    // Where the cron adapters throw, this one logs: the same sentence, a different destination.
    const failures = describeFailures(outcomes)
    if (failures !== null) await logGoalDispatchFailure(scope, failures)
  } catch (error) {
    // Silent to the caller — a saved contribution must not report itself as an error — and loud in
    // the log, which is the whole point of the distinction.
    await logGoalDispatchFailure(
      scope,
      'goal reached notification dispatch failed',
      error,
    )
  }
}
