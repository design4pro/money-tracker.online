/**
 * The webhook ledger: every delivery Polar has made, keyed by the provider's own event id.
 *
 * **Platform data, not tenant data — the one billing carve-out from `docs/SPEC.md` §5.2.** A
 * delivery arrives before we know which workspace it belongs to, so the table's `organization_id`
 * is nullable and there is no scope to write it under. `docs/plans/22-billing.md` stage `22-S1`
 * names this file and this exemption; it is the same shape as `src/server/catalog`'s, and like
 * that one it is narrow by construction rather than by promise:
 *
 * - the two writes below take a bare {@link Database} and are reachable only from the webhook
 *   endpoint and the queue handler that drains it — never from a server function;
 * - the one **read** a workspace can reach ({@link listWorkspaceEvents}) is tenant-scoped through
 *   the base like every other read in this directory, so the billing screen cannot see another
 *   household's invoices.
 *
 * `id` being the provider's event id **is** the idempotency strategy: a redelivery is an insert
 * conflict, answered 200 and dropped, rather than a second application of one state change.
 */

import { desc, eq, inArray } from 'drizzle-orm'

import { billingEvents } from '#/server/db/schema'

import { tenantFilter } from './base'

import type { BillingEventRow, BillingEventStatus } from '#/server/db/schema'
import type { Database, TenantScope } from './base'

export interface RecordEventInput {
  /** The `webhook-id` header. The delivery's identity, and this row's primary key. */
  readonly id: string
  readonly type: string
  readonly payloadJson: string
  readonly signatureTs: Date | null
  readonly organizationId: string | null
  readonly status: BillingEventStatus
  readonly receivedAt: Date
}

/**
 * Stores one verified delivery, or reports that it was already stored.
 *
 * `false` is the ordinary answer to a redelivery and not an error: the caller acknowledges with a
 * 200 and enqueues nothing. `onConflictDoNothing` keeps that decision in one statement, so two
 * concurrent deliveries of the same event cannot both win a read-then-write race.
 */
export async function recordEvent(
  db: Database,
  input: RecordEventInput,
): Promise<boolean> {
  const inserted = await db
    .insert(billingEvents)
    .values({
      id: input.id,
      type: input.type,
      organizationId: input.organizationId,
      payloadJson: input.payloadJson,
      signatureTs: input.signatureTs,
      status: input.status,
      errorCode: null,
      receivedAt: input.receivedAt,
      processedAt: input.status === 'received' ? null : input.receivedAt,
    })
    .onConflictDoNothing({ target: billingEvents.id })
    .returning({ id: billingEvents.id })

  return inserted.length > 0
}

/** One delivery as stored, for the handler that is about to process it. */
export async function getEvent(
  db: Database,
  id: string,
): Promise<BillingEventRow | null> {
  const rows = await db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.id, id))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Closes out a delivery: what happened to it, when, and — when it failed — why.
 *
 * The workspace is written here rather than at insert time because it is only known once the
 * payload has been mapped, and a `failed` row that still names its workspace is what makes a
 * support question answerable.
 */
export async function completeEvent(
  db: Database,
  input: {
    readonly id: string
    readonly status: BillingEventStatus
    readonly organizationId?: string | null
    readonly errorCode?: string | null
    readonly processedAt: Date
  },
): Promise<void> {
  await db
    .update(billingEvents)
    .set({
      status: input.status,
      processedAt: input.processedAt,
      errorCode: input.errorCode ?? null,
      ...(input.organizationId === undefined
        ? {}
        : { organizationId: input.organizationId }),
    })
    .where(eq(billingEvents.id, input.id))
}

/**
 * The workspace's own recent billing activity, newest first.
 *
 * Scoped through the base, so this read carries the tenant predicate that the two writes above
 * cannot have. `types` narrows it to the events a person has any use for — the screen shows
 * subscription changes, not the provider's internal chatter.
 */
export async function listWorkspaceEvents(
  scope: TenantScope,
  input: { readonly types: ReadonlyArray<string>; readonly limit: number },
): Promise<Array<BillingEventRow>> {
  if (input.types.length === 0) return []
  return scope.db
    .select()
    .from(billingEvents)
    .where(
      tenantFilter(
        scope,
        billingEvents,
        inArray(billingEvents.type, [...input.types]),
      ),
    )
    .orderBy(desc(billingEvents.receivedAt))
    .limit(input.limit)
}
