/**
 * Threshold detection: which envelopes crossed a line since the last sweep.
 *
 * ---------------------------------------------------------------------------
 * THIS STAGE DETECTS; PLAN 21 DELIVERS
 * ---------------------------------------------------------------------------
 *
 * The split is deliberate and it is why {@link NOOP_ALERT_DISPATCHER} exists. Notification
 * channels — email, push, the in-app inbox, the quiet hours — are one module and belong in one
 * place (`21-S1`). What belongs *here* is the arithmetic that decides a line was crossed, because
 * that arithmetic has to agree with the meter on the budget screen down to the minor unit, and the
 * only way to guarantee that is to read the same stored integer the screen reads.
 *
 * {@link setBudgetAlertDispatcher} is the seam. Until `21-S1` installs the real dispatcher every
 * crossing goes to a no-op — and `__tests__/thresholds.test.ts` asserts both halves: that the
 * default really is the no-op, and that an installed dispatcher really does receive every crossing
 * the sweep found. A permanent no-op nobody notices is a silent feature failure; a seam with a
 * test on both sides of it is not.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES
 * ---------------------------------------------------------------------------
 *
 * 1. **The comparison is integer, and the multiplication comes first.**
 *    `spent × 100 ≥ available × threshold`, through {@link hasReachedThreshold}, so no
 *    intermediate value is ever rounded and a threshold cannot fire at 79.999%.
 *
 * 2. **The crossing is evaluated against the period's stored `spent_minor`**, not a live
 *    recomputation. The alert and the screen therefore cannot disagree — and if they ever do, the
 *    bug is that the period was not recomputed, which is visible, rather than that two code paths
 *    computed two numbers, which is not.
 *
 * 3. **One notification per threshold per period.** The marker is the guard, and it is written
 *    **after** dispatch so a failed dispatch retries on the next sweep instead of being swallowed.
 *    A refund that brings spend back under a threshold does **not** re-arm it inside the same
 *    period: the marker stays, because re-arming means notifying somebody twice about one
 *    overspend.
 *
 * 4. **Per workspace, per scope.** {@link sweepBudgetThresholds} takes one {@link TenantScope} and
 *    never runs as a cross-tenant query, so one workspace's markers can never suppress another's
 *    identical crossing — the marker key carries the budget id, and budget ids do not cross
 *    workspaces because nothing here can read a budget from another one.
 */

import { asMinor } from '#/lib/money'
import { getCurrentPeriod } from '#/server/repos/budget-periods'
import { listBudgets } from '#/server/repos/budgets'

import { availableMinor } from './rollover'
import { hasReachedThreshold, parseAlertThresholds } from './utilisation'

import type { Minor } from '#/lib/money'
import type { TenantScope } from '#/server/repos/base'

/** The two events `21-S1` delivers. Named here because this module decides which one applies. */
export const BUDGET_THRESHOLD_EVENT = 'budget.threshold_crossed'
export const BUDGET_EXCEEDED_EVENT = 'budget.exceeded'

export type BudgetAlertEvent =
  typeof BUDGET_THRESHOLD_EVENT | typeof BUDGET_EXCEEDED_EVENT

/** One line, crossed once, in one period of one budget. */
export interface ThresholdCrossing {
  readonly budgetId: string
  readonly budgetName: string
  readonly periodStart: string
  /** The configured percentage that was reached. `100` and above mean the envelope is spent. */
  readonly threshold: number
  readonly spentMinor: Minor
  /** `limit + carriedIn`, floored at zero — what the percentage is a percentage *of*. */
  readonly availableMinor: Minor
  readonly currencyCode: string
  /** `budget.exceeded` from 100 up, `budget.threshold_crossed` below it. */
  readonly event: BudgetAlertEvent
}

/**
 * The dedupe marker, exactly as `12-S3` specifies it.
 *
 * Versioned (`v1`) because changing what a crossing means later must re-arm every budget rather
 * than silently inheriting markers written under the old rule.
 *
 * Since `21-S1` the marker is no longer the *only* record that a notification was sent — the
 * `notifications` row is, and `#/server/notify/adapters` reuses this exact key as its `dedupe_key`
 * so the two name the same occasion. The marker still decides whether the sweep dispatches at all,
 * and it is written after a successful dispatch so a transient failure retries; the row's scoped
 * unique index is what makes that retry harmless.
 */
export function crossingMarkerKey(crossing: {
  readonly budgetId: string
  readonly periodStart: string
  readonly threshold: number
}): string {
  return `budget:threshold:v1:${crossing.budgetId}:${crossing.periodStart}:${crossing.threshold}`
}

/**
 * Where the markers live.
 *
 * An interface rather than a KV binding, because the sweep's logic is worth testing without a
 * Cloudflare runtime and because `21-S1` may well want to record the same fact somewhere it can
 * show the reader. The production implementation is one KV `get` and one KV `put`.
 */
export interface ThresholdMarkerStore {
  readonly seen: (key: string) => Promise<boolean>
  readonly remember: (key: string) => Promise<void>
}

/** An in-memory store, for tests and for a dry run. Not exported to the Worker. */
export function createMemoryMarkerStore(
  initial: Iterable<string> = [],
): ThresholdMarkerStore & { readonly keys: ReadonlySet<string> } {
  const keys = new Set(initial)
  return {
    keys,
    seen: async (key) => keys.has(key),
    remember: async (key) => {
      keys.add(key)
    },
  }
}

/** What `21-S1` installs. Takes the crossings of **one** workspace, already deduped. */
export type BudgetAlertDispatcher = (
  scope: TenantScope,
  crossings: ReadonlyArray<ThresholdCrossing>,
) => Promise<void>

/**
 * The placeholder dispatcher: it does nothing, on purpose, and it is named so that "nothing is
 * being sent yet" is greppable rather than inferred from an empty function body somewhere.
 */
export const NOOP_ALERT_DISPATCHER: BudgetAlertDispatcher = async () => {}

let dispatcher: BudgetAlertDispatcher = NOOP_ALERT_DISPATCHER

/** Installs the real dispatcher (`21-S1`). `null` restores the no-op. */
export function setBudgetAlertDispatcher(
  next: BudgetAlertDispatcher | null,
): void {
  dispatcher = next ?? NOOP_ALERT_DISPATCHER
}

/** True while nothing is being delivered. The cron logs it, so the gap is visible in production. */
export function isBudgetAlertDispatcherInstalled(): boolean {
  return dispatcher !== NOOP_ALERT_DISPATCHER
}

export interface FindCrossingsArgs {
  readonly scope: TenantScope
  /** The day the sweep is running on. A parameter, never a clock read inside the query. */
  readonly today: string
  readonly markers: ThresholdMarkerStore
}

/**
 * Every threshold newly crossed in this workspace, newest budget order, markers not yet written.
 *
 * Only **active** budgets are swept: a closed or archived envelope stopped accruing, and notifying
 * about one is notifying about a decision the person already made. Only the **current** period is
 * read, and only when it has been materialised — a budget whose cron has not run yet has nothing
 * stored to compare against, and inventing a figure here would be exactly the live recomputation
 * rule 2 forbids.
 */
export async function findCrossings(
  args: FindCrossingsArgs,
): Promise<ReadonlyArray<ThresholdCrossing>> {
  const budgets = await listBudgets(args.scope, { status: 'active' })
  const crossings: Array<ThresholdCrossing> = []

  for (const budget of budgets) {
    const period = await getCurrentPeriod(args.scope, budget.id, args.today)
    if (period === null) continue

    const spentMinor = asMinor(period.spentMinor)
    const available = availableMinor(
      asMinor(period.limitMinor),
      asMinor(period.carriedInMinor),
    )

    for (const threshold of parseAlertThresholds(budget.alertThresholds)) {
      if (!hasReachedThreshold(spentMinor, available, threshold)) continue

      const key = crossingMarkerKey({
        budgetId: budget.id,
        periodStart: period.periodStart,
        threshold,
      })
      if (await args.markers.seen(key)) continue

      crossings.push({
        budgetId: budget.id,
        budgetName: budget.name,
        periodStart: period.periodStart,
        threshold,
        spentMinor,
        availableMinor: available,
        currencyCode: period.currencyCode,
        event:
          threshold >= 100 ? BUDGET_EXCEEDED_EVENT : BUDGET_THRESHOLD_EVENT,
      })
    }
  }

  return crossings
}

/**
 * Detect, dispatch, then mark — in that order, and the order is the point.
 *
 * Writing the marker before dispatch would turn a transient failure into a notification nobody
 * ever gets, with no record that it was owed. Writing it after means the worst case is a repeat on
 * the next sweep, which a reader can ignore, rather than a silence they cannot detect.
 */
export async function sweepBudgetThresholds(
  args: FindCrossingsArgs,
): Promise<ReadonlyArray<ThresholdCrossing>> {
  const crossings = await findCrossings(args)
  if (crossings.length === 0) return crossings

  await dispatcher(args.scope, crossings)

  for (const crossing of crossings) {
    await args.markers.remember(crossingMarkerKey(crossing))
  }
  return crossings
}
