/**
 * The notification-email delivery store: one row per attempted send, tenant-scoped.
 *
 * {@link insertDelivery} is the enqueue path (Phase 4 installs the caller). {@link claimDelivery}
 * is the `queued → sending` conditional update that makes a redelivery a no-op at the provider.
 * {@link markDelivery} records the outcome. Nothing here sends mail, and nothing here stores an
 * address — only a salted hash, written by the handler at send time.
 */

import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { z } from 'zod'

import { EMAIL_DELIVERY_KINDS, EMAIL_DELIVERY_STATUSES } from '#/lib/enums'
import { newId } from '#/server/db/ids'
import { emailDeliveries } from '#/server/db/schema'

import { allOf, createTenantRepository } from './base'

import type { EmailDeliveryKind, EmailDeliveryStatus } from '#/lib/enums'
import type { EmailDeliveryRow } from '#/server/db/schema'
import type { TenantScope } from './base'

const deliveryRepo = createTenantRepository(emailDeliveries, 'email delivery')

const idSchema = z.string().trim().min(1).max(64)
const userIdSchema = z.string().trim().min(1).max(64)
const kindSchema = z.enum(EMAIL_DELIVERY_KINDS)
const statusSchema = z.enum(EMAIL_DELIVERY_STATUSES)
const sinceSchema = z.date()

const insertSchema = z.strictObject({
  userId: userIdSchema,
  kind: kindSchema,
  notificationId: z.string().trim().min(1).max(64).nullable().optional(),
  dedupeKey: z.string().trim().min(1).max(200),
  status: statusSchema.optional(),
})
export type InsertDeliveryInput = z.infer<typeof insertSchema>

const markSchema = z.strictObject({
  status: statusSchema,
  toHash: z.string().trim().min(1).max(128).nullable().optional(),
  providerMessageId: z.string().trim().min(1).max(200).nullable().optional(),
  errorCode: z.string().trim().min(1).max(64).nullable().optional(),
  sentAt: z.date().nullable().optional(),
})
export type MarkDeliveryInput = z.infer<typeof markSchema>

const STALE_STATUSES: ReadonlyArray<EmailDeliveryStatus> = ['queued', 'sending']

/**
 * Writes one delivery, or `null` when this workspace already queued this person this key.
 *
 * The unique index is the idempotency: a second enqueue of one notification, or a second digest
 * on the same day, is dropped rather than sent twice.
 */
export async function insertDelivery(
  scope: TenantScope,
  input: InsertDeliveryInput,
  now: Date,
): Promise<EmailDeliveryRow | null> {
  const parsed = insertSchema.parse(input)
  return deliveryRepo.insertOnConflictDoNothing(
    scope,
    {
      id: newId(),
      userId: parsed.userId,
      kind: parsed.kind,
      notificationId: parsed.notificationId ?? null,
      dedupeKey: parsed.dedupeKey,
      toHash: null,
      providerMessageId: null,
      status: parsed.status ?? 'queued',
      errorCode: null,
      createdAt: now,
      sentAt: null,
    },
    [
      emailDeliveries.organizationId,
      emailDeliveries.userId,
      emailDeliveries.dedupeKey,
    ],
  )
}

/** The row in this workspace, or `null`. A row in another workspace does not exist here. */
export async function getDelivery(
  scope: TenantScope,
  id: string,
): Promise<EmailDeliveryRow | null> {
  return deliveryRepo.findById(scope, idSchema.parse(id))
}

/**
 * Claims a queued row for sending. `null` means another delivery already handled it (or it was
 * never queued), so the message is acknowledged and nothing is sent.
 */
export async function claimDelivery(
  scope: TenantScope,
  id: string,
): Promise<EmailDeliveryRow | null> {
  const parsed = idSchema.parse(id)
  const rows = await deliveryRepo.updateWhere(
    scope,
    allOf(eq(emailDeliveries.id, parsed), eq(emailDeliveries.status, 'queued')),
    { status: 'sending' },
  )
  return rows[0] ?? null
}

/**
 * Records the outcome. Scoped: a patch aimed at another workspace's id matches nothing.
 *
 * `onlyStatus`, when set, is the same conditional the claim uses — `queued → failed` for a
 * member who has left, so a concurrent claim cannot send after we have already given up.
 */
export async function markDelivery(
  scope: TenantScope,
  id: string,
  patch: MarkDeliveryInput,
  onlyStatus?: EmailDeliveryStatus,
): Promise<EmailDeliveryRow | null> {
  const parsedId = idSchema.parse(id)
  const parsed = markSchema.parse(patch)
  const rows = await deliveryRepo.updateWhere(
    scope,
    onlyStatus === undefined
      ? eq(emailDeliveries.id, parsedId)
      : allOf(
          eq(emailDeliveries.id, parsedId),
          eq(emailDeliveries.status, onlyStatus),
        ),
    {
      status: parsed.status,
      ...(parsed.toHash === undefined ? {} : { toHash: parsed.toHash }),
      ...(parsed.providerMessageId === undefined
        ? {}
        : { providerMessageId: parsed.providerMessageId }),
      ...(parsed.errorCode === undefined
        ? {}
        : { errorCode: parsed.errorCode }),
      ...(parsed.sentAt === undefined ? {} : { sentAt: parsed.sentAt }),
    },
  )
  return rows[0] ?? null
}

/** How many deliveries this workspace wrote at or after `since`. The daily cap counts this. */
export async function countSince(
  scope: TenantScope,
  since: Date,
): Promise<number> {
  const parsed = sinceSchema.parse(since)
  return deliveryRepo.count(scope, gte(emailDeliveries.createdAt, parsed))
}

/**
 * `queued` / `sending` rows older than `olderThan` and not older than `notOlderThan`.
 *
 * The recovery sweep (Phase 4) re-enqueues the 15-minute-to-23-hour window and expires anything
 * older; this is the select that window is.
 */
export async function listStale(
  scope: TenantScope,
  olderThan: Date,
  notOlderThan: Date,
): Promise<ReadonlyArray<EmailDeliveryRow>> {
  return deliveryRepo.findMany(scope, {
    where: and(
      inArray(emailDeliveries.status, [...STALE_STATUSES]),
      lte(emailDeliveries.createdAt, sinceSchema.parse(olderThan)),
      gte(emailDeliveries.createdAt, sinceSchema.parse(notOlderThan)),
    ),
  })
}

/** `deferred` rows written at or after `since`. The digest (Phase 5) drains these. */
export async function listDeferredSince(
  scope: TenantScope,
  since: Date,
): Promise<ReadonlyArray<EmailDeliveryRow>> {
  return deliveryRepo.findMany(scope, {
    where: allOf(
      eq(emailDeliveries.status, 'deferred'),
      gte(emailDeliveries.createdAt, sinceSchema.parse(since)),
    ),
  })
}

export type { EmailDeliveryKind, EmailDeliveryStatus }
