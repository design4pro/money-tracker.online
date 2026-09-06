/**
 * The billing server functions: what the screen reads, and the two writes it can make.
 *
 * The rule the whole area is built on is restated here because this file is where it would be
 * broken: **entitlement is derived from stored subscription state, never from a UI claim.** Nothing
 * below grants anything. `loadBilling` reads; `cancelSubscription` and `resumeSubscription` ask the
 * *provider* to change the subscription and then mirror the provider's own answer, which is the
 * same authority the webhook carries — an authenticated response to a request we made, not a body
 * a browser sent.
 *
 * Both writes require **owner or admin**: spending or stopping a household's money is not a
 * member's decision. The refusal is `ForbiddenError` from `assertRole`, and the screen derives its
 * buttons from the same role, so an action a person can see is an action they can perform.
 */

import { createServerFn } from '@tanstack/react-start'

import { requireOrg } from '#/server/auth/guards'
import { isBillingConfigured, requirePolarClient } from '#/server/billing/env'
import { subscriptionStateFrom } from '#/server/billing/mapping'
import { resolveLimits } from '#/server/billing/resolve-limits'
import { assertRole } from '#/server/repos/scope'
import {
  applySubscriptionState,
  getSubscription,
} from '#/server/repos/subscriptions'

import type { PlanId, PlanLimits, QuotaMetric } from '#/lib/plans'
import type { EntitlementState } from '#/server/billing/resolve-limits'
import type { BillingInterval, SubscriptionStatus } from '#/server/db/schema'
import type { WorkspaceRole } from '#/components/app/shell'
import type { WorkspaceUsage } from '#/server/repos/usage'

/**
 * The subscription, reduced to what a screen may render.
 *
 * The provider's ids are **not** in it: a customer id on a page is an identifier that has no reason
 * to leave the server, and the two actions that need one read it from the row themselves.
 */
export interface BillingSubscriptionView {
  readonly status: SubscriptionStatus
  readonly interval: BillingInterval | null
  /** The price **as billed** — the provider's minor units, in the provider's currency. */
  readonly unitAmountMinor: number | null
  readonly currency: string | null
  readonly currentPeriodEnd: Date | null
  readonly cancelAtPeriodEnd: boolean
  readonly graceEndsAt: Date | null
}

export interface BillingView {
  readonly planId: PlanId
  readonly state: EntitlementState
  readonly limits: PlanLimits
  readonly usage: WorkspaceUsage
  readonly exceeded: ReadonlyArray<QuotaMetric>
  readonly subscription: BillingSubscriptionView | null
  /** The caller's workspace role, so the screen renders the actions it will actually be allowed. */
  readonly role: WorkspaceRole
  /** `false` on a deployment with no Polar credentials: the screen says so instead of offering. */
  readonly configured: boolean
}

/** The plan, the ceilings, the counts and the subscription — one call, one set of numbers. */
export const loadBilling = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BillingView> => {
    const scope = await requireOrg()
    const effective = await resolveLimits(scope)
    const row = effective.subscription

    return {
      planId: effective.entitlement.planId,
      state: effective.entitlement.state,
      limits: effective.limits,
      usage: effective.usage,
      exceeded: effective.exceeded,
      subscription: row
        ? {
            status: row.status as SubscriptionStatus,
            interval: row.interval as BillingInterval | null,
            unitAmountMinor: row.unitAmountMinor,
            currency: row.currency,
            currentPeriodEnd: row.currentPeriodEnd,
            cancelAtPeriodEnd: row.cancelAtPeriodEnd,
            graceEndsAt: effective.entitlement.graceEndsAt,
          }
        : null,
      role: scope.ctx.role,
      configured: isBillingConfigured(),
    }
  },
)

/**
 * Ends the subscription at the end of the period that has already been paid for.
 *
 * Never immediately, and the copy says so: somebody who has paid for March keeps March. The
 * provider's response is mirrored into the row so the screen shows the pending cancellation without
 * waiting for the webhook — the webhook still arrives and still wins, because both write through
 * the same ordering rule in `applySubscriptionState`.
 */
export const cancelSubscription = createServerFn({ method: 'POST' }).handler(
  async (): Promise<BillingSubscriptionView | null> => {
    return changeSubscription('cancel')
  },
)

/** Undoes a pending cancellation while the paid-for period is still running. */
export const resumeSubscription = createServerFn({ method: 'POST' }).handler(
  async (): Promise<BillingSubscriptionView | null> => {
    return changeSubscription('resume')
  },
)

async function changeSubscription(
  action: 'cancel' | 'resume',
): Promise<BillingSubscriptionView | null> {
  const scope = await requireOrg()
  assertRole(scope, `${action} the subscription`, 'admin')

  const row = await getSubscription(scope)
  if (!row?.providerSubscriptionId) return null

  const client = requirePolarClient()
  const updated =
    action === 'cancel'
      ? await client.cancelSubscription(row.providerSubscriptionId)
      : await client.resumeSubscription(row.providerSubscriptionId)

  const applied = await applySubscriptionState(
    scope,
    subscriptionStateFrom(updated),
  )
  const next = applied.applied ? applied.row : row

  return {
    status: next.status as SubscriptionStatus,
    interval: next.interval as BillingInterval | null,
    unitAmountMinor: next.unitAmountMinor,
    currency: next.currency,
    currentPeriodEnd: next.currentPeriodEnd,
    cancelAtPeriodEnd: next.cancelAtPeriodEnd,
    graceEndsAt: null,
  }
}
