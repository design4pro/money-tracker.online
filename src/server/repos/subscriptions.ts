/**
 * The subscription mirror: one row per workspace, written only by the webhook processor.
 *
 * Polar decides what has been paid for. This row exists so that *"may this workspace do this"* has
 * a **local, synchronous** answer — a quota check on a write path cannot make a network call to a
 * billing provider, and one that could would fail a person's transaction because a billing API was
 * slow.
 *
 * Two boundaries are deliberate:
 *
 * **No workspace-facing server function writes here.** {@link applySubscriptionState} exists for
 * the queue handler that processes verified webhooks and for nothing else. Entitlement derived
 * from anything a browser said — a checkout redirect included — is entitlement anybody can claim.
 *
 * **Writes are conditional on the provider's own clock.** Webhooks arrive out of order; a delayed
 * `subscription.created` applied after a `subscription.canceled` is how somebody keeps a plan they
 * cancelled. Every write compares the event's `modified_at` against the stored `updated_at` and
 * applies nothing when it is older, reporting that rather than failing.
 */

import { and, asc, eq } from 'drizzle-orm'

import { member } from '#/server/db/auth-schema'
import { subscriptions } from '#/server/db/schema'

import { createScope, createTenantTableAccess } from './base'

import type {
  BillingInterval,
  PlanId,
  SubscriptionRow,
  SubscriptionStatus,
} from '#/server/db/schema'
import type { Database, TenantScope } from './base'

const subscriptionAccess = createTenantTableAccess(
  subscriptions,
  'subscription',
)

/** The workspace's subscription, or `null` when it has never had one. */
export async function getSubscription(
  scope: TenantScope,
): Promise<SubscriptionRow | null> {
  // `findMany` rather than `findOne`: the unique index already guarantees at most one row per
  // workspace, so there is no second predicate to write and inventing one would only be noise.
  const rows = await subscriptionAccess.findMany(scope, { limit: 1 })
  return rows[0] ?? null
}

/**
 * What one verified provider event says the subscription now is.
 *
 * Every field is the provider's, mapped in `#/server/billing/mapping` and never computed here.
 * `modifiedAt` is the ordering key described in the file docblock.
 */
export interface SubscriptionState {
  readonly plan: PlanId
  readonly status: SubscriptionStatus
  readonly providerCustomerId: string | null
  readonly providerSubscriptionId: string | null
  readonly providerProductId: string | null
  readonly seats: number
  readonly currency: string | null
  readonly unitAmountMinor: number | null
  readonly interval: BillingInterval | null
  readonly currentPeriodStart: Date | null
  readonly currentPeriodEnd: Date | null
  readonly cancelAtPeriodEnd: boolean
  readonly canceledAt: Date | null
  readonly trialEndsAt: Date | null
  /** The provider's `modified_at`, or its `created_at` when the event carries no other. */
  readonly modifiedAt: Date
}

export type ApplyOutcome =
  | { readonly applied: true; readonly row: SubscriptionRow }
  | { readonly applied: false; readonly reason: 'stale-event' }

/**
 * Writes the state, unless a newer one is already stored.
 *
 * The row's own `id` is generated from the workspace id rather than randomly: the table's unique
 * index already forbids a second subscription per workspace, and a deterministic key makes the
 * insert-or-update decision one read rather than a conflict to catch.
 */
export async function applySubscriptionState(
  scope: TenantScope,
  state: SubscriptionState,
): Promise<ApplyOutcome> {
  const existing = await getSubscription(scope)

  if (existing && existing.updatedAt > state.modifiedAt) {
    return { applied: false, reason: 'stale-event' }
  }

  const values = {
    plan: state.plan,
    status: state.status,
    providerCustomerId: state.providerCustomerId,
    providerSubscriptionId: state.providerSubscriptionId,
    providerProductId: state.providerProductId,
    seats: state.seats,
    currency: state.currency,
    unitAmountMinor: state.unitAmountMinor,
    interval: state.interval,
    currentPeriodStart: state.currentPeriodStart,
    currentPeriodEnd: state.currentPeriodEnd,
    cancelAtPeriodEnd: state.cancelAtPeriodEnd,
    canceledAt: state.canceledAt,
    trialEndsAt: state.trialEndsAt,
    updatedAt: state.modifiedAt,
  }

  if (existing) {
    const rows = await subscriptionAccess.updateWhere(
      scope,
      eq(subscriptions.id, existing.id),
      values,
    )
    const row = rows.at(0)
    // The row was read through this very scope one statement ago, so an empty result means the
    // predicate stopped matching it — which is a tenancy fault, not an ordinary miss.
    if (!row) return { applied: false, reason: 'stale-event' }
    return { applied: true, row }
  }

  const row = await subscriptionAccess.insert(scope, {
    ...values,
    id: `sub_${scope.ctx.organizationId}`,
    createdAt: state.modifiedAt,
  })
  return { applied: true, row }
}

/**
 * A scope for a workspace the **queue** must act on, with its owner as the principal.
 *
 * *"Which workspace does this webhook belong to"* cannot be asked from inside a workspace, so this
 * one function takes a bare {@link Database} — the same necessity, and the same shape, as
 * `listCronScopes` in `./recurring`. It returns a scope and no data, so every row the processor
 * then touches goes through the tenant predicate exactly as a request's would.
 *
 * `null` when the workspace has no owner: the id in the webhook's metadata names something that is
 * not a live workspace, and the processor records that rather than inventing a principal.
 */
export async function ownerScopeFor(
  db: Database,
  organizationId: string,
): Promise<TenantScope | null> {
  const rows = await db
    .select({ userId: member.userId })
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.role, 'owner')),
    )
    .orderBy(asc(member.createdAt))
    .limit(1)

  const owner = rows.at(0)
  if (!owner) return null

  return createScope(db, {
    userId: owner.userId,
    organizationId,
    role: 'owner',
  })
}
