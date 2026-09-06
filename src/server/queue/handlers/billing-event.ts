/**
 * Applies one verified Polar delivery to this product's subscription state.
 *
 * The endpoint verifies, stores and enqueues; **this** is where entitlement actually changes. The
 * split is not tidiness: a provider whose delivery takes too long retries it, and a retry that
 * arrives while the first attempt is still writing is how one event is applied twice.
 *
 * Four rules govern what happens here, and each has a failure it prevents:
 *
 * 1. **The workspace comes from the payload's `metadata.workspaceId`.** Never from an email, never
 *    from a customer lookup. See `#/server/billing/mapping`.
 * 2. **Older events are applied to nothing.** `applySubscriptionState` compares the provider's
 *    `modified_at` against the stored `updated_at`; a stale event is marked `processed` and
 *    changes no row.
 * 3. **A logical failure is terminal, not retried.** A payload naming a workspace that does not
 *    exist will name it just as hard on the fifth attempt, so it is recorded with a code and
 *    acknowledged. Only an *infrastructure* failure — a database that did not answer — is rethrown
 *    for the queue to retry.
 * 4. **Nothing here touches money.** No transaction, no balance, no `ref_amount_minor`. Asserted by
 *    the import-graph case in `billing-event.test.ts`.
 */

import {
  isHandledEventType,
  subscriptionStateFrom,
  workspaceIdFrom,
} from '#/server/billing/mapping'
import { polarSubscriptionSchema } from '#/server/billing/polar-types'
import { completeEvent, getEvent } from '#/server/repos/billing-events'
import {
  applySubscriptionState,
  ownerScopeFor,
} from '#/server/repos/subscriptions'

import type { Database } from '#/server/repos/base'
import type { Logger } from '#/server/observability/logger'

/** Why a delivery could not be applied. Stored on the row, and the vocabulary support reads. */
export type BillingEventFailure =
  | 'event-missing'
  | 'payload-unreadable'
  | 'payload-shape'
  | 'workspace-unknown'
  | 'workspace-not-found'

export type BillingEventOutcome =
  'applied' | 'stale' | 'ignored' | 'already-processed' | BillingEventFailure

export interface BillingEventArgs {
  readonly db: Database
  readonly eventId: string
  readonly now: Date
  readonly logger: Logger
}

export async function handleBillingEvent(
  args: BillingEventArgs,
): Promise<BillingEventOutcome> {
  const row = await getEvent(args.db, args.eventId)
  if (!row) {
    args.logger.warn('billing event vanished before processing', {
      eventId: args.eventId,
    })
    return 'event-missing'
  }

  // A redelivery whose first attempt already succeeded. Re-applying it would be harmless thanks to
  // rule 2, and doing nothing is cheaper and clearer than proving that again.
  if (row.status !== 'received') return 'already-processed'

  if (!isHandledEventType(row.type)) {
    await fail(args, 'ignored', null, null)
    return 'ignored'
  }

  let payload: unknown
  try {
    payload = JSON.parse(row.payloadJson)
  } catch {
    await fail(args, 'failed', 'payload-unreadable', null)
    return 'payload-unreadable'
  }

  const parsed = polarSubscriptionSchema.safeParse(
    (payload as { data?: unknown } | null)?.data,
  )
  if (!parsed.success) {
    await fail(args, 'failed', 'payload-shape', null)
    return 'payload-shape'
  }

  const workspaceId = workspaceIdFrom(parsed.data.metadata)
  if (!workspaceId) {
    await fail(args, 'failed', 'workspace-unknown', null)
    return 'workspace-unknown'
  }

  const scope = await ownerScopeFor(args.db, workspaceId)
  if (!scope) {
    // Recorded without the workspace id: `billing_events.organization_id` is a foreign key, and
    // the whole reason this branch was reached is that the id names no live workspace. The error
    // code is what makes the row answerable; the payload beside it still holds the id verbatim.
    await fail(args, 'failed', 'workspace-not-found', null)
    return 'workspace-not-found'
  }

  const result = await applySubscriptionState(
    scope,
    subscriptionStateFrom(parsed.data),
  )

  await completeEvent(args.db, {
    id: row.id,
    status: 'processed',
    organizationId: workspaceId,
    processedAt: args.now,
  })

  args.logger.info('billing event processed', {
    eventId: row.id,
    type: row.type,
    applied: result.applied,
  })

  return result.applied ? 'applied' : 'stale'
}

/** Closes a delivery out without applying it, and says why in the row rather than only in a log. */
async function fail(
  args: BillingEventArgs,
  status: 'failed' | 'ignored',
  errorCode: BillingEventFailure | null,
  organizationId: string | null,
): Promise<void> {
  await completeEvent(args.db, {
    id: args.eventId,
    status,
    errorCode,
    organizationId,
    processedAt: args.now,
  })
  if (errorCode !== null) {
    args.logger.warn('billing event could not be applied', {
      eventId: args.eventId,
      errorCode,
    })
  }
}
