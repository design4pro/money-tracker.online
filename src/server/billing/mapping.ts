/**
 * The provider's vocabulary, translated into this product's — once, here.
 *
 * Everything downstream of a webhook reads {@link SubscriptionState}, so the translation happens at
 * exactly one place and every rule about it is in one file. Two of those rules are worth stating
 * where they are applied:
 *
 * **The workspace comes from `metadata.workspaceId`, never from an email.** The id is set when the
 * checkout is created and travels back on the subscription. Matching a customer's address against
 * a workspace owner's would let anybody claim a workspace by paying with its owner's email.
 *
 * **The plan comes from the product id first.** `planForProductId` reads the same build-time ids
 * the checkout was opened against, so what the customer is being billed for decides what they are
 * entitled to. The checkout's `metadata.planId` is a fallback for a product this build does not
 * know — a sandbox id in a production build, say — and `free` is the answer when neither resolves,
 * because an entitlement nobody can trace to a product is not an entitlement.
 */

import { isPlanId, planForProductId } from '#/lib/plans'
import { SUBSCRIPTION_STATUSES } from '#/server/db/schema'

import type {
  BillingInterval,
  PlanId,
  SubscriptionStatus,
} from '#/server/db/schema'
import type { SubscriptionState } from '#/server/repos/subscriptions'
import type { PolarSubscription } from './polar-types'

/**
 * The event types this product acts on.
 *
 * Everything else is stored with `status = 'ignored'` and acknowledged — see
 * `#/server/repos/billing-events` for why an unknown type may not be answered with a 4xx.
 */
export const HANDLED_EVENT_TYPES: ReadonlyArray<string> = [
  'subscription.created',
  'subscription.updated',
  'subscription.active',
  'subscription.canceled',
  'subscription.uncanceled',
  'subscription.revoked',
]

export function isHandledEventType(type: string): boolean {
  return HANDLED_EVENT_TYPES.includes(type)
}

/** The workspace a payload names, or `null` when it names none we can use. */
export function workspaceIdFrom(
  metadata: Readonly<Record<string, unknown>>,
): string | null {
  const value = metadata.workspaceId
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** The plan the checkout said it was for, when the product id could not be resolved. */
function planFromMetadata(
  metadata: Readonly<Record<string, unknown>>,
): PlanId | null {
  const value = metadata.planId
  return isPlanId(value) ? value : null
}

function statusOf(value: string): SubscriptionStatus {
  // Polar's lifecycle names are a subset of the column's `CHECK`, so the mapping is identity for
  // every value the provider actually sends. An unrecognised one is `incomplete` rather than a
  // throw: an unknown status must not entitle, and `incomplete` is the non-entitling default the
  // resolver already understands.
  return (SUBSCRIPTION_STATUSES as ReadonlyArray<string>).includes(value)
    ? (value as SubscriptionStatus)
    : 'incomplete'
}

function intervalOf(value: 'month' | 'year' | null): BillingInterval | null {
  if (value === 'month') return 'monthly'
  if (value === 'year') return 'yearly'
  return null
}

/**
 * One provider subscription as a row-shaped state.
 *
 * `seats` is 1 because this product sells a household plan by its member ceiling rather than by
 * per-seat pricing: the ceiling is `plans.ts`'s `members` limit, and `subscriptions.seat_limit`
 * stays null unless an operator grandfathers a workspace above it.
 *
 * No arithmetic happens here. `amount` and `currency` are carried across verbatim, in the
 * provider's own minor units — see `./polar-types`.
 */
export function subscriptionStateFrom(
  subscription: PolarSubscription,
): SubscriptionState {
  const planId =
    planForProductId(subscription.product_id)?.planId ??
    planFromMetadata(subscription.metadata) ??
    'free'

  return {
    plan: planId,
    status: statusOf(subscription.status),
    providerCustomerId: subscription.customer_id,
    providerSubscriptionId: subscription.id,
    providerProductId: subscription.product_id,
    seats: 1,
    currency: subscription.currency,
    unitAmountMinor: subscription.amount,
    interval: intervalOf(subscription.recurring_interval),
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at,
    // Polar reports a trial through the status and the period, not through a separate instant.
    // Inventing one here would put a date on the billing screen the provider never stated.
    trialEndsAt: null,
    modifiedAt: subscription.modified_at ?? subscription.created_at,
  }
}
