/**
 * `resolveLimits()` — the single authority on what a workspace may hold (`docs/SPEC.md` §5.4).
 *
 * The precedence, in order, and nothing else decides it:
 *
 * 1. an **entitling status** (`active`, `trialing`) selects the subscription's plan;
 * 2. `past_due` keeps the paid plan through a **grace window** ({@link GRACE_DAYS} past
 *    `current_period_end`), then falls back to free — a failed card is dunning, not a lockout, and
 *    taking a household's ledger away on the first retry is indefensible;
 * 3. any other status, and no row at all, is the free plan;
 * 4. the **catalogue** (`#/lib/plans`) supplies the numbers for the resolved plan;
 * 5. **row ceilings win** — `subscriptions.quota_overrides`, `seat_limit` and
 *    `storage_limit_bytes` override the catalogue in **either** direction, which is what makes
 *    grandfathering an existing customer possible without inventing a plan for them.
 *
 * Two properties this module keeps:
 *
 * **The published number is the enforced number.** Nothing here invents a limit; every figure comes
 * from the catalogue or from an override row. `resolve-limits.test.ts` enumerates every metric the
 * catalogue declares and fails when one has no resolution, so a new quota cannot ship unresolved.
 *
 * **Downgrade is never destructive.** Falling to a lower plan while over a limit leaves every row
 * readable, exportable and deletable; only *creating more* of the exceeded resource is refused, by
 * `assertWithinLimit` at the repository boundary. Deleting somebody's transactions because they
 * stopped paying is not a product decision this codebase is willing to express.
 *
 * Binding-free: the plan comes from a row, the row comes from a scope, and the clock arrives as an
 * argument. That is what makes the grace window testable at day 6 and day 8.
 */

import {
  DEFAULT_PLAN_ID,
  PLANS,
  QUOTA_METRICS,
  UNLIMITED,
  isPlanId,
  isQuotaMetric,
  planForProductId,
} from '#/lib/plans'
import { getSubscription } from '#/server/repos/subscriptions'
import { countUsage } from '#/server/repos/usage'

import type { PlanId, PlanLimits, QuotaMetric } from '#/lib/plans'
import type { TenantScope } from '#/server/repos/base'
import type { SubscriptionRow } from '#/server/db/schema'
import type { WorkspaceUsage } from '#/server/repos/usage'

/** Statuses that entitle outright. Everything else is decided by the ladder below. */
const ENTITLING_STATUSES = new Set(['active', 'trialing'])

/**
 * How long a paid plan survives a failed payment past the end of the period it covered.
 *
 * Seven days: long enough for a card to be replaced over a weekend, short enough that an
 * abandoned subscription does not entitle indefinitely.
 */
export const GRACE_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/** Why the workspace is on the plan it is on. Rendered by the billing screen, verbatim. */
export type EntitlementState =
  'no-subscription' | 'entitled' | 'grace' | 'lapsed'

export interface Entitlement {
  readonly planId: PlanId
  readonly state: EntitlementState
  /** The instant grace ends, when {@link state} is `grace`. `null` otherwise. */
  readonly graceEndsAt: Date | null
}

/**
 * Which plan a stored row entitles to, at an instant. Pure, and the whole of rules 1–3.
 *
 * The **product id outranks the cached `plan` column**: the column is a convenience written by the
 * processor, and the product is what the customer is actually being billed for. They disagree only
 * when a mapping changed under a live subscription, and the money is the tiebreak.
 */
export function entitlementOf(
  row: SubscriptionRow | null,
  now: Date,
): Entitlement {
  if (!row)
    return {
      planId: DEFAULT_PLAN_ID,
      state: 'no-subscription',
      graceEndsAt: null,
    }

  const fromProduct = planForProductId(row.providerProductId)?.planId ?? null
  const planId =
    fromProduct ?? (isPlanId(row.plan) ? row.plan : DEFAULT_PLAN_ID)

  if (ENTITLING_STATUSES.has(row.status)) {
    return { planId, state: 'entitled', graceEndsAt: null }
  }

  if (row.status === 'past_due') {
    // No period end means no window to measure, so the grace is measured from the row's own last
    // update instead — a subscription that went past due without a period is still past due.
    const from = row.currentPeriodEnd ?? row.updatedAt
    const graceEndsAt = new Date(from.getTime() + GRACE_DAYS * DAY_MS)
    if (now.getTime() <= graceEndsAt.getTime()) {
      return { planId, state: 'grace', graceEndsAt }
    }
    return { planId: DEFAULT_PLAN_ID, state: 'lapsed', graceEndsAt: null }
  }

  return { planId: DEFAULT_PLAN_ID, state: 'lapsed', graceEndsAt: null }
}

/**
 * The per-workspace ceilings stored on the row, parsed defensively.
 *
 * `quota_overrides` is operator-written JSON (plan 24's console). A malformed value is ignored
 * rather than fatal: an unreadable override must not take a paying workspace's product away, and
 * the catalogue underneath it is always a valid answer. Unknown metric names and non-integer
 * values are dropped for the same reason.
 */
export function parseOverrides(
  row: SubscriptionRow | null,
): Partial<Record<QuotaMetric, number>> {
  if (!row) return {}

  const overrides: Partial<Record<QuotaMetric, number>> = {}

  if (row.seatLimit !== null) overrides.members = row.seatLimit
  if (row.storageLimitBytes !== null) {
    overrides.storageBytes = row.storageLimitBytes
  }

  if (row.quotaOverrides !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.quotaOverrides)
    } catch {
      parsed = null
    }
    if (parsed !== null && typeof parsed === 'object') {
      for (const [key, value] of Object.entries(parsed)) {
        if (!isQuotaMetric(key)) continue
        if (value === null) {
          overrides[key] = UNLIMITED
        } else if (
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= 0
        ) {
          overrides[key] = value
        }
      }
    }
  }

  return overrides
}

/** Rules 4 and 5 together: the catalogue, then the row's ceilings on top of it. */
export function limitsFor(
  planId: PlanId,
  overrides: Partial<Record<QuotaMetric, number>>,
): PlanLimits {
  const catalogue = PLANS[planId].limits
  const resolved = {} as Record<QuotaMetric, number>
  for (const metric of QUOTA_METRICS) {
    resolved[metric] = overrides[metric] ?? catalogue[metric]
  }
  return resolved
}

/**
 * Everything a screen or a guard needs about entitlement, in one read.
 *
 * `limits` **and** `usage`, so "42 of 50 accounts" comes from one call rather than a second round
 * of counting that could disagree with the first.
 */
export interface EffectiveLimits {
  readonly entitlement: Entitlement
  readonly limits: PlanLimits
  readonly usage: WorkspaceUsage
  /** Metrics whose current holding is already past the ceiling. Empty in the ordinary case. */
  readonly exceeded: ReadonlyArray<QuotaMetric>
  readonly subscription: SubscriptionRow | null
}

export async function resolveLimits(
  scope: TenantScope,
  now: Date = new Date(),
): Promise<EffectiveLimits> {
  const row = await getSubscription(scope)
  const entitlement = entitlementOf(row, now)
  const limits = limitsFor(entitlement.planId, parseOverrides(row))
  const usage = await countUsage(scope)

  return {
    entitlement,
    limits,
    usage,
    exceeded: QUOTA_METRICS.filter((metric) => usage[metric] > limits[metric]),
    subscription: row,
  }
}

/**
 * The ceiling for one metric — the function `assertWithinLimit` calls before every metered write.
 *
 * One row read and no counting: the count is the caller's, and it already has it. An unknown metric
 * name resolves to {@link UNLIMITED} rather than to zero, because a typo at a call site must not
 * silently refuse every write; the exhaustive test in `resolve-limits.test.ts` is what catches the
 * typo instead.
 */
export async function resolveLimit(
  scope: TenantScope,
  metric: string,
  now: Date = new Date(),
): Promise<number> {
  if (!isQuotaMetric(metric)) return UNLIMITED
  const row = await getSubscription(scope)
  const entitlement = entitlementOf(row, now)
  return limitsFor(entitlement.planId, parseOverrides(row))[metric]
}
