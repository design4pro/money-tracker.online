/**
 * The email seam: where `21-S2` (#210) attaches, and nothing happens until it does.
 *
 * The arrangement is deliberately identical to the three it sits beside —
 * `NOOP_ALERT_DISPATCHER` in `#/server/budgets/thresholds`, `NOOP_REMINDER_DISPATCHER` in
 * `#/server/recurring/reminders`, `NOOP_GOAL_REACHED_DISPATCHER` in `#/server/goals/reached`. A
 * named no-op rather than an empty body, so "nothing is being emailed yet" is greppable;
 * {@link isNotificationEmailEnqueuerInstalled} so the gap is visible in production rather than
 * inferred; and `null` restores the no-op, which is what lets a test put the module back.
 *
 * **It enqueues, it does not send.** The argument is a `notificationId` and a payload, not a
 * rendered message: composing the email needs templates, a locale and a person's address, all of
 * which are `21-S2`'s, and doing any of it on the cron's tick would put an HTTP call inside a sweep
 * that already has every workspace to get through.
 */

import type { NotificationKind } from '#/lib/enums'
import type { TenantScope } from '#/server/repos/scope'

export interface NotificationEmailArgs {
  readonly userId: string
  /** The row already written by `notify`. The email is about a notification that exists. */
  readonly notificationId: string
  readonly kind: NotificationKind
  /** The kind's payload, as stored. `21-S2` parses it with the kind's own schema. */
  readonly payload: unknown
}

export type NotificationEmailEnqueuer = (
  scope: TenantScope,
  args: NotificationEmailArgs,
) => Promise<void>

/** The placeholder: it does nothing, on purpose, and is named so that saying so is greppable. */
export const NOOP_EMAIL_ENQUEUER: NotificationEmailEnqueuer = async () => {}

let enqueuer: NotificationEmailEnqueuer = NOOP_EMAIL_ENQUEUER

/** Installs the real enqueuer (`21-S2`). `null` restores the no-op. */
export function setNotificationEmailEnqueuer(
  next: NotificationEmailEnqueuer | null,
): void {
  enqueuer = next ?? NOOP_EMAIL_ENQUEUER
}

/** True once something is actually being enqueued. */
export function isNotificationEmailEnqueuerInstalled(): boolean {
  return enqueuer !== NOOP_EMAIL_ENQUEUER
}

/**
 * Hands one notification to whatever is installed.
 *
 * It does not catch: `notify` owns the decision that a failed email must not lose the in-app row,
 * and burying the throw here would take that decision away from the one place that can make it.
 */
export async function enqueueNotificationEmail(
  scope: TenantScope,
  args: NotificationEmailArgs,
): Promise<void> {
  await enqueuer(scope, args)
}
