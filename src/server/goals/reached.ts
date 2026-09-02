/**
 * `goal.reached` — the seam, and nothing behind it yet.
 *
 * ---------------------------------------------------------------------------
 * THIS STAGE DETECTS; PLAN 21 DELIVERS
 * ---------------------------------------------------------------------------
 *
 * The split is the same one `src/server/budgets/thresholds.ts` makes and it is made for the same
 * reason: notification channels — email, push, the in-app inbox, the quiet hours — are one module
 * and belong in one place (`21-S1`). What belongs *here* is nothing but the event's shape and the
 * hook that will carry it, so that the day the dispatcher lands, no goal code is edited.
 *
 * ## Why the moment is detected in the repository and delivered from a server function
 *
 * `reached` is written **in the same statement** as `contributed_minor`, inside
 * `src/server/repos/goals.ts` — the cache and the status cannot disagree, because one `UPDATE`
 * sets both. What that write cannot honestly do is send a notification: a repository that talks to
 * an email provider is a repository that fails a request because a queue was slow, and the write
 * it just committed is not undone by that.
 *
 * So the repository *reports* the transition (`becameReached`) and `src/server/fns/goals.ts`
 * dispatches it. `__tests__/goals.test.ts` asserts the report; the two halves of the seam —
 * "the default really is the no-op" and "an installed dispatcher really does receive the event" —
 * are asserted here.
 *
 * A permanent no-op nobody notices is a silent feature failure. {@link isGoalReachedDispatcherInstalled}
 * exists so the gap is greppable and loggable rather than inferred from an empty function body.
 */

import type { Minor } from '#/lib/money'
import type { TenantScope } from '#/server/repos/base'

/** The event `21-S1` delivers. Named here because this is the module that decides it happened. */
export const GOAL_REACHED_EVENT = 'goal.reached'

/**
 * One goal, at the moment it crossed its own target.
 *
 * The amounts travel with it rather than being re-read later: the notification says *"you reached
 * 3 000,00 $"*, and re-reading the goal when the queue drains would print whatever it says then,
 * which is a different sentence about a different moment.
 */
export interface GoalReachedEvent {
  readonly goalId: string
  readonly name: string
  readonly targetMinor: Minor
  readonly contributedMinor: Minor
  /** The goal's own currency. Progress is never restated in the base currency here. */
  readonly currencyCode: string
  /** The transaction whose link crossed the line, so the notification can point at it. */
  readonly transactionId: string
}

/** What `21-S1` installs. Takes one workspace's event; never a cross-tenant batch. */
export type GoalReachedDispatcher = (
  scope: TenantScope,
  event: GoalReachedEvent,
) => Promise<void>

/**
 * The placeholder dispatcher: it does nothing, on purpose, and it is named so that "nothing is
 * being sent yet" is greppable rather than inferred from an empty function body somewhere.
 */
export const NOOP_GOAL_REACHED_DISPATCHER: GoalReachedDispatcher =
  async () => {}

let dispatcher: GoalReachedDispatcher = NOOP_GOAL_REACHED_DISPATCHER

/** Installs the real dispatcher (`21-S1`). `null` restores the no-op. */
export function setGoalReachedDispatcher(
  next: GoalReachedDispatcher | null,
): void {
  dispatcher = next ?? NOOP_GOAL_REACHED_DISPATCHER
}

/** True while nothing is being delivered, so the gap can be logged in production. */
export function isGoalReachedDispatcherInstalled(): boolean {
  return dispatcher !== NOOP_GOAL_REACHED_DISPATCHER
}

/**
 * Hands one crossing to whatever is installed.
 *
 * Called **after** the contribution and the status have committed, so a dispatcher that throws
 * loses a notification rather than a write. Retries and channel failures belong to `21-S1`'s
 * dispatcher; swallowing them here would make a permanently broken channel invisible, which is
 * the one outcome worse than a loud one.
 */
export async function dispatchGoalReached(
  scope: TenantScope,
  event: GoalReachedEvent,
): Promise<void> {
  await dispatcher(scope, event)
}
