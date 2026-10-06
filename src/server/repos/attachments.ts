/**
 * Receipt attachments — the rows, the objects, and the order the two are written in.
 *
 * ---------------------------------------------------------------------------
 * THE THREE RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **The R2 key is composed here and nowhere else, and its second segment is the workspace.**
 *    `attachments/<orgId>/<transactionId>/<attachmentId>`, fixed by `00-S12`. The workspace id is
 *    second so that sweeping a tenant — a deletion request, an export, an orphan hunt — is a prefix
 *    list rather than a scan with a join. {@link attachmentKey} is the only function that builds
 *    one, it takes the id off the scope rather than off an argument, and nothing below accepts a
 *    key from a caller.
 *
 * 2. **Object first, assert second, compensating delete on throw.** This is the order `00-S12` sets
 *    for every R2 write in the product and {@link createAttachment} is where it is established.
 *    Writing the object first means a quota refusal never leaves a row pointing at nothing — a
 *    broken download for a receipt somebody can see in a list. The compensating delete means it
 *    never leaves an object nobody references — a byte count charged to a workspace that has no way
 *    to find it. `assertWithinLimit` sits between the two, and everything after the `put` is inside
 *    the `try` whose `catch` removes the object again.
 *
 * 3. **A byte size is not an amount.** `byte_size` never goes through `#/lib/money`, and this
 *    module does not import it — a shared formatter would eventually apply a currency's `digits` to
 *    a file size and print `1 048 576,00` for a megabyte. The absence of that import is the
 *    guarantee, and `__tests__/attachments.test.ts` asserts it on this file and on the component
 *    that renders the number.
 *
 * **Nothing here moves money.** An attachment carries no amount, touches no account and changes no
 * balance, so there is no `touchLedgerAccount` call below and there should not be one.
 *
 * The refusals: a transaction from another workspace is a `NotFoundError` before any object is
 * written or read, a file past the per-file ceiling does not parse, and a workspace past its
 * `storageBytes` allowance gets its object taken back.
 */

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { newId } from '#/server/db/ids'
import { attachments } from '#/server/db/schema'
import { InvalidKeyError, assertKeyInOrg, orgPrefix } from '#/server/files/keys'
import {
  MAX_ORIGINAL_NAME_LENGTH,
  uploadMetadataSchema,
} from '#/server/files/upload'
import { createLogger } from '#/server/observability/logger'

import { asc, assertWithinLimit, createTenantRepository } from './base'
import { ConflictError, NotFoundError } from './errors'
import { getTransaction } from './transactions'

import type { AttachmentRow } from '#/server/db/schema'
import type { TenantScope } from './base'
import type { TransactionPolicies } from './transactions'

/**
 * The `attachments` table through the tenant-scoped base.
 *
 * Every read and write below goes through it, so `organization_id` is composed and stamped by one
 * function that cannot be handed a different value.
 */
const attachmentRepo = createTenantRepository(attachments, 'attachment')

/** Where {@link requireOwnKey} reports a refusal. No request context here, so the console sink and nothing else. */
const logger = createLogger({ context: { component: 'repo' } })

/**
 * All four policies `include`, for the reason `repos/splits` gives: this is a panel on a row
 * somebody already has an id for. A planned entry, a balance correction and a transfer leg all have
 * a detail screen, and hiding any of them here would turn "attach the receipt for the row I am
 * looking at" into a not-found. Unlike a split, an attachment has no rule that refuses a transfer
 * leg — a bank's transfer confirmation is exactly the sort of thing somebody keeps.
 */
const ATTACHMENT_POLICIES: TransactionPolicies = {
  planned: 'include',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
}

/** The metered resource. Named once so the meter and the sum cannot drift apart. */
const STORAGE_METRIC = 'storageBytes'

/* -------------------------------------------------------------------------- */
/* Input schemas                                                               */
/* -------------------------------------------------------------------------- */

const idField = z.string().trim().min(1).max(64)

export const transactionIdSchema = z.strictObject({ transactionId: idField })

export type TransactionIdInput = z.input<typeof transactionIdSchema>

export const attachmentIdSchema = z.strictObject({ id: idField })

export type AttachmentIdInput = z.input<typeof attachmentIdSchema>

/**
 * `11-S3`'s metadata triple plus the name to show for it.
 *
 * It extends the schema `files/upload` already parsed rather than restating it, so the allow-list
 * and the 10 MB ceiling have one definition. This is the **second** parse the standard asks for:
 * the importer and any future queue handler will reach {@link createAttachment} without going
 * through `fns/attachments`, and both doors lead to the same room.
 */
export const createAttachmentSchema = uploadMetadataSchema.extend({
  originalName: z.string().trim().min(1).max(MAX_ORIGINAL_NAME_LENGTH),
})

export type CreateAttachmentInput = z.input<typeof createAttachmentSchema>

/* -------------------------------------------------------------------------- */
/* The key                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `attachments/<orgId>/` — the prefix every key of this workspace starts with.
 *
 * The write side ({@link attachmentKey}) and the read side ({@link requireOwnKey}) both spell it
 * through `files/keys`, so the two cannot drift apart.
 */
export function attachmentKeyPrefix(organizationId: string): string {
  return orgPrefix('attachments', organizationId)
}

/**
 * `attachments/<orgId>/<transactionId>/<attachmentId>` — the layout `00-S12` fixed.
 *
 * Exported so a test can assert the shape against a real row rather than against a copy of this
 * string, and so the planned orphan sweep will have one place to read the prefix from.
 */
export function attachmentKey(
  organizationId: string,
  transactionId: string,
  attachmentId: string,
): string {
  return `${attachmentKeyPrefix(organizationId)}${transactionId}/${attachmentId}`
}

/**
 * Whether the row's stored key is under this workspace's own prefix, warning when it is not.
 *
 * The scoped `SELECT` already proves the *row* is the caller's. The *key* is a second fact the
 * write path guarantees and nothing else checks: a bug, a bad restore or a hand-edited row could
 * point A's row at B's object, and the next read or delete would serve or destroy it. The warning
 * carries the attachment id and never the key or the other workspace.
 */
function hasOwnKey(scope: TenantScope, row: AttachmentRow): boolean {
  try {
    assertKeyInOrg('attachments', scope.ctx.organizationId, row.r2Key)
    return true
  } catch (error) {
    if (!(error instanceof InvalidKeyError)) throw error
    logger.warn('attachment key is outside the workspace prefix', {
      attachmentId: row.id,
    })
    return false
  }
}

/**
 * Hands the row back only when its stored key is under this workspace's own prefix (see
 * {@link hasOwnKey}).
 *
 * A foreign key is the same {@link NotFoundError} as an id that does not exist, so the two are
 * indistinguishable to a caller.
 */
function requireOwnKey(scope: TenantScope, row: AttachmentRow): AttachmentRow {
  if (!hasOwnKey(scope, row)) throw new NotFoundError('attachment', row.id)
  return row
}

/**
 * What leaves the server about an attachment: the row without its R2 key.
 *
 * The key is an address into the bucket, and the one thing a browser needs to open a receipt is the
 * id, which `/api/files/$id` resolves back to a key under a scoped read. Nothing in the UI reads
 * `r2Key`, so it does not go on the wire — every server function and loader that returns an
 * attachment returns this, and only {@link getAttachmentForRead}, which the file route calls, hands
 * out the full row.
 */
export type AttachmentDto = Omit<AttachmentRow, 'r2Key'>

/** The row as {@link AttachmentDto}. The one place the key is taken off. */
export function toAttachmentDto(row: AttachmentRow): AttachmentDto {
  const { r2Key: _r2Key, ...dto } = row
  return dto
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One transaction's attachments, oldest first.
 *
 * The parent is loaded first, through the scoped read, so an id from another workspace is a
 * `NotFoundError` before a single attachment row is looked at. Without that, "no receipts" and
 * "not your transaction" would be the same answer, and one of them is an oracle.
 *
 * The order is the creation-sortable primary key ascending. That is upload order for any two
 * uploads that did not land in the same millisecond, which two HTTP requests never do — within one
 * millisecond `newId()`'s random half decides, and the repository promises only that the order is
 * ascending by `id` and the same on every read.
 *
 * A row whose stored key is outside the workspace's prefix is left out (and logged, see
 * {@link hasOwnKey}) rather than failing the list: one bad row must not take the whole detail
 * screen down, and the row would not be openable or deletable anyway. No item carries the key.
 */
export async function listAttachments(
  scope: TenantScope,
  input: TransactionIdInput,
): Promise<ReadonlyArray<AttachmentDto>> {
  const parsed = transactionIdSchema.parse(input)
  await getTransaction({
    scope,
    policies: ATTACHMENT_POLICIES,
    id: parsed.transactionId,
  })

  const rows = await attachmentRepo.findMany(scope, {
    where: eq(attachments.transactionId, parsed.transactionId),
    orderBy: [asc(attachments.id)],
  })
  return rows.filter((row) => hasOwnKey(scope, row)).map(toAttachmentDto)
}

/**
 * The row `/api/files/$id` streams, or a `NotFoundError`.
 *
 * This is the whole authorisation decision for a download, and it is a scoped `SELECT`: an id
 * belonging to another workspace does not come back, so the route never learns a key it could
 * fetch. Named `…ForRead` rather than `getAttachment` because the name is the reminder that its
 * caller is about to move bytes on the strength of it.
 *
 * A row whose stored key is not under the caller's own prefix is refused the same way: see
 * {@link requireOwnKey}. The check lives here, in the one place `GET` and `HEAD` both pass through.
 */
export async function getAttachmentForRead(
  scope: TenantScope,
  input: AttachmentIdInput,
): Promise<AttachmentRow> {
  const parsed = attachmentIdSchema.parse(input)
  return requireOwnKey(
    scope,
    await attachmentRepo.requireById(scope, parsed.id),
  )
}

/** What the workspace is currently storing, in bytes. The figure the quota is asserted against. */
export async function storedBytes(scope: TenantScope): Promise<number> {
  return attachmentRepo.sumOf(scope, attachments.byteSize)
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Writes the object, meters the workspace, then writes the row.
 *
 * The sequence, and why each step is where it is:
 *
 * 1. **Parse.** The second parse the standard asks for. A body past the ceiling or a type outside
 *    the allow-list never reaches R2, because `createAttachmentSchema` refuses it here.
 * 2. **`body.byteLength === byteSize`.** The number that is metered, stored and later served as
 *    `Content-Length` has to be the number of bytes actually written. A mismatch is a
 *    `ConflictError` rather than a silent correction, because either the caller measured something
 *    else or the body changed underneath it, and both are worth hearing about.
 * 3. **The parent, scoped.** Before the `put`, so a transaction id from another workspace costs a
 *    `SELECT` and writes no object. This is the isolation case the key layout exists for.
 * 4. **`put`, then `assertWithinLimit`, then `insert`, with a compensating delete on any throw.**
 *    Rule 2 of this module's docblock.
 *
 * `uploaded_by_user_id` is the scope's user, never an argument: who uploaded a file is a fact about
 * the request, and a caller that could name somebody else could forge it.
 */
export async function createAttachment(
  scope: TenantScope,
  bucket: R2Bucket,
  input: CreateAttachmentInput,
  body: Uint8Array,
): Promise<AttachmentRow> {
  const parsed = createAttachmentSchema.parse(input)

  if (body.byteLength !== parsed.byteSize) {
    throw new ConflictError(
      `The upload declares ${parsed.byteSize} bytes and carries ${body.byteLength}.`,
    )
  }

  const parent = await getTransaction({
    scope,
    policies: ATTACHMENT_POLICIES,
    id: parsed.transactionId,
  })

  const id = newId()
  const r2Key = attachmentKey(scope.ctx.organizationId, parent.id, id)

  await bucket.put(r2Key, body, {
    httpMetadata: { contentType: parsed.contentType },
  })

  try {
    const current = await storedBytes(scope)
    await assertWithinLimit(scope, STORAGE_METRIC, current + parsed.byteSize)

    return await attachmentRepo.insert(scope, {
      id,
      transactionId: parent.id,
      r2Key,
      contentType: parsed.contentType,
      byteSize: parsed.byteSize,
      originalName: parsed.originalName,
      uploadedByUserId: scope.ctx.userId,
      createdAt: new Date(),
    })
  } catch (error) {
    // The compensating delete. Without it a refused quota check leaves an object nobody references
    // and every future `storedBytes` under-reports what the bucket actually holds.
    await bucket.delete(r2Key)
    throw error
  }
}

/**
 * Removes an attachment: the row first, then the object.
 *
 * **That order is deliberate and it is the reverse of the write.** The two failure modes are not
 * symmetric: a row without an object is a receipt somebody can see and cannot open, which is a bug
 * they will report; an object without a row is invisible and costs storage until the orphaned-object
 * sweep, which is planned and not yet built, takes it. Given that one of the two has to be possible,
 * the harmless one is chosen.
 *
 * The row is loaded through the scoped read first, so B's id is a `NotFoundError` before
 * `bucket.delete` is reached with a key this workspace does not own. The key itself is checked
 * before the row is removed: a poisoned row must not be a way to delete another workspace's object.
 */
export async function deleteAttachment(
  scope: TenantScope,
  bucket: R2Bucket,
  input: AttachmentIdInput,
): Promise<AttachmentRow> {
  const parsed = attachmentIdSchema.parse(input)
  const row = requireOwnKey(
    scope,
    await attachmentRepo.requireById(scope, parsed.id),
  )

  await attachmentRepo.requireRemove(scope, row.id)
  await bucket.delete(row.r2Key)

  return row
}
