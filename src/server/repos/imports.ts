/**
 * Import batches: the row, the object it points at, and the order the two are written in.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **The R2 key is composed here and nowhere else, and its second segment is the workspace.**
 *    `imports/<orgId>/<batchId>/<filename>`, fixed by `00-S12`. {@link importFileKey} is the only
 *    function that builds one, it takes the workspace id off the **scope** rather than off an
 *    argument, and nothing below accepts a key from a caller. A forged `organizationId` in a
 *    request body therefore cannot move an object into — or read one out of — another workspace's
 *    prefix, which is the case `tenant-isolation.test.ts` asserts.
 *
 * 2. **Object first, quota second, row third, compensating delete on throw.** The order `11-S3`
 *    established for attachments (`./attachments`), for the same reason and with the same
 *    asymmetry: a row pointing at nothing is a batch a person can see and cannot open, while an
 *    object with no row is invisible and waits for the orphaned-object sweep, which is planned and
 *    not yet built.
 *
 * 3. **Nothing that was parsed is stored.** There is no staging table and none is wanted: the
 *    preview recomputes from the bytes in R2 plus the confirmed mapping, and the commit runs that
 *    same parse over those same bytes, so the two cannot disagree about what will be written.
 *    `transactions.import_batch_id` is what makes undo exact, and it needs no second copy of the
 *    file to work. The only thing a parse persists is `import_row_errors`, which `19-S2` owns.
 *
 * 4. **A status is a move, not an assignment.** {@link ALLOWED_TRANSITIONS} is the whole graph and
 *    {@link advanceImportBatch} is the only door: `completed → mapping` is a {@link ConflictError},
 *    because a batch that has already written four hundred transactions must not be walked back to
 *    the mapping screen and run a second time.
 *
 * **Nothing here parses an amount, and nothing here reads one.** A batch row carries counts and
 * timestamps; the money lives in the transactions the commit writes, through the normal write
 * path, and `#/lib/money` is deliberately not imported by this file.
 */

import { gte } from 'drizzle-orm'
import { z } from 'zod'

import { serverToday } from '#/server/clock'
import { newId } from '#/server/db/ids'
import {
  IMPORT_SOURCES,
  IMPORT_STATUSES,
  importBatches,
} from '#/server/db/schema'
import { InvalidKeyError, assertKeyInOrg } from '#/server/files/keys'
import { safeFileName } from '#/server/files/upload'
import { IMPORT_MAX_BYTES } from '#/server/import/types'
import { createLogger } from '#/server/observability/logger'

import { assertWithinLimit, createTenantRepository } from './base'
import { ConflictError, NotFoundError } from './errors'
import { getAccount } from './accounts'

import type { ImportBatchRow, ImportStatus } from '#/server/db/schema'
import type { CursorPage, TenantScope } from './base'

/**
 * The `import_batches` table through the tenant-scoped base.
 *
 * Every read and write below goes through it, so `organization_id` is composed and stamped by one
 * function that cannot be handed a different value.
 */
const importBatchRepo = createTenantRepository(importBatches, 'import batch')

/** Where {@link readImportBatchFile} reports a refusal. No request context here, so the console sink and nothing else. */
const logger = createLogger({ context: { component: 'repo' } })

/** The metered resource. Named once so the meter and the count cannot drift apart. */
const IMPORT_QUOTA_METRIC = 'importsPerMonth'

/* -------------------------------------------------------------------------- */
/* Input schemas                                                               */
/* -------------------------------------------------------------------------- */

const idField = z.string().trim().min(1).max(64)

export const importBatchIdSchema = z.strictObject({ id: idField })

export type ImportBatchIdInput = z.input<typeof importBatchIdSchema>

/**
 * What an upload has to carry, over **measured** values.
 *
 * `byteSize` is the length of the body that was actually read, not a number a caller declared, and
 * it is bounded again here after `#/server/import/upload` bounded it — the second parse the
 * standard asks for, and the one that survives a caller who never comes through that module.
 *
 * `accountId` is validated for existence **inside this workspace** before a byte is written. An id
 * from another workspace is a `NotFoundError` and never a `ForbiddenError`: see `./errors`.
 */
export const createImportBatchSchema = z.strictObject({
  source: z.enum(IMPORT_SOURCES),
  accountId: idField,
  fileName: z.string().trim().min(1).max(255),
  byteSize: z.number().int().positive().max(IMPORT_MAX_BYTES),
})

export type CreateImportBatchInput = z.input<typeof createImportBatchSchema>

const countField = z.number().int().min(0)

/**
 * A move through the pipeline, with the counters that move with it.
 *
 * `mapping` is deliberately absent: the confirmed column map is `19-S2`'s write, and a stage that
 * could set it from here would be a second owner of the same concept.
 */
export const advanceImportBatchSchema = z.strictObject({
  id: idField,
  status: z.enum(IMPORT_STATUSES),
  rowCount: countField.optional(),
  importedCount: countField.optional(),
  skippedCount: countField.optional(),
  duplicateCount: countField.optional(),
  errorCount: countField.optional(),
})

export type AdvanceImportBatchInput = z.input<typeof advanceImportBatchSchema>

export const listImportBatchesSchema = z.strictObject({
  limit: z.number().int().positive().max(100).optional(),
  cursor: idField.nullable().optional(),
})

export type ListImportBatchesInput = z.input<typeof listImportBatchesSchema>

/* -------------------------------------------------------------------------- */
/* The key                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `imports/<orgId>/<batchId>/<filename>` — the layout `00-S12` fixed.
 *
 * Exported so a test can assert the shape against a real row rather than against a copy of this
 * string, and so a tenant sweep has one place to read the prefix from. The file name is passed
 * through `safeFileName` at the call site, not here, because the same cleaned name is stored.
 */
export function importFileKey(
  organizationId: string,
  batchId: string,
  fileName: string,
): string {
  return `imports/${organizationId}/${batchId}/${fileName}`
}

/**
 * Whether `key` is under this workspace's `imports` prefix: {@link assertKeyInOrg} in a form that
 * answers instead of throwing, so the reader and the DTO below apply one rule and not two copies.
 */
function isKeyInWorkspace(scope: TenantScope, key: string): boolean {
  try {
    assertKeyInOrg('imports', scope.ctx.organizationId, key)
    return true
  } catch (error) {
    if (!(error instanceof InvalidKeyError)) throw error
    return false
  }
}

/**
 * The batch's stored file, or `null` when the batch has no key or the bucket has no such object.
 *
 * **This is the only place a batch's file is fetched**, so the preview, the mapping step and any
 * later commit path share one check. `file_r2_key` is free text as far as the database is
 * concerned, and the scoped `SELECT` proves the *row* is the caller's, not that the *key* is: a
 * bug, a bad restore or a hand-edited row could point A's batch at B's object. A key outside this
 * workspace's `imports` prefix is therefore a {@link NotFoundError} for the batch, raised before the
 * bucket is touched and indistinguishable from a batch that does not exist; the warning carries the
 * batch id and never the key or the other workspace.
 *
 * What a `null` means to the caller — which sentence to show — stays the caller's decision.
 */
export async function readImportBatchFile(
  scope: TenantScope,
  bucket: R2Bucket,
  batch: ImportBatchRow,
): Promise<R2ObjectBody | null> {
  if (batch.fileR2Key === null) return null

  if (!isKeyInWorkspace(scope, batch.fileR2Key)) {
    logger.warn('import batch key is outside the workspace prefix', {
      batchId: batch.id,
    })
    throw new NotFoundError('import batch', batch.id)
  }
  return bucket.get(batch.fileR2Key)
}

/**
 * A batch as the browser may see it: the row without its storage key, and the file name the key
 * would have given.
 *
 * `fileName` is the last path segment of the key **only** when the key passes the same prefix check
 * as {@link readImportBatchFile}, and the batch id otherwise - a key outside this workspace, a
 * missing key, or one with no final segment. A name is therefore never derived from a key that
 * belongs to somebody else, and the other workspace's id never reaches a response.
 */
export type ImportBatchDto = Omit<ImportBatchRow, 'fileR2Key'> & {
  readonly fileName: string
}

/**
 * The only producer of {@link ImportBatchDto}.
 *
 * A pure mapping over a row the scoped repository already returned, so it runs no query and has no
 * case in `tenant-isolation.test.ts`. A foreign-key batch is mapped, not dropped: filtering it out
 * of a keyset page would break the page size and make the history disagree with
 * {@link importsThisMonth}, which counts it.
 */
export function toImportBatchDto(
  scope: TenantScope,
  batch: ImportBatchRow,
): ImportBatchDto {
  const { fileR2Key: key, ...rest } = batch
  const name =
    key !== null && isKeyInWorkspace(scope, key)
      ? key.slice(key.lastIndexOf('/') + 1)
      : ''
  return { ...rest, fileName: name === '' ? batch.id : name }
}

/* -------------------------------------------------------------------------- */
/* Status transitions                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Where a batch may go from where it is.
 *
 * The pipeline's four phases are each separately resumable, which is why `previewing → mapping`
 * exists: a person who sees the preview and realises the amount column is wrong goes back and
 * remaps, and nothing has been written yet. Everything after `running` is one-way — `completed`
 * may only be `reverted`, and `failed` and `reverted` are terminal, because a batch that has
 * touched the ledger is history rather than a work item.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<ImportStatus, ReadonlyArray<ImportStatus>>
> = {
  queued: ['parsing', 'failed'],
  parsing: ['mapping', 'failed'],
  mapping: ['previewing', 'failed'],
  previewing: ['mapping', 'running', 'failed'],
  running: ['completed', 'failed'],
  completed: ['reverted'],
  failed: [],
  reverted: [],
}

/** Whether a batch in `from` may move to `to`. Staying put is never a move. */
export function canTransition(from: ImportStatus, to: ImportStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** One batch, or {@link import('./errors').NotFoundError}. B's id is simply not found. */
export async function getImportBatch(
  scope: TenantScope,
  input: ImportBatchIdInput,
): Promise<ImportBatchRow> {
  const parsed = importBatchIdSchema.parse(input)
  return importBatchRepo.requireById(scope, parsed.id)
}

/** The import history, newest first — the keyset page the base repository composes. */
export async function listImportBatches(
  scope: TenantScope,
  input: ListImportBatchesInput = {},
): Promise<CursorPage<ImportBatchRow>> {
  const parsed = listImportBatchesSchema.parse(input)
  return importBatchRepo.page(scope, {
    limit: parsed.limit,
    cursor: parsed.cursor ?? null,
  })
}

/**
 * How many batches this workspace has created in the current calendar month.
 *
 * The figure `importsPerMonth` is asserted against. The month is **UTC**, which is what
 * `#/server/clock` defines a day as and what `booked_on` means (`docs/MONEY.md` §6.1); the plan
 * text says "the workspace time zone", and there is no such column in the schema — a per-workspace
 * zone is a product decision plan `00` has not made, and inventing one here would give this
 * counter a different idea of "this month" from every other date in the product.
 */
export async function importsThisMonth(scope: TenantScope): Promise<number> {
  const monthStart = new Date(`${serverToday().slice(0, 7)}-01T00:00:00.000Z`)
  return importBatchRepo.count(scope, gte(importBatches.createdAt, monthStart))
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Writes the file, meters the workspace, then writes the batch row.
 *
 * The sequence, and why each step is where it is:
 *
 * 1. **Parse.** The second parse the standard asks for. A body past the 5 MB ceiling never reaches
 *    R2, because {@link createImportBatchSchema} refuses it here.
 * 2. **`body.byteLength === byteSize`.** The number that was measured has to be the number of bytes
 *    actually written. A mismatch is a {@link ConflictError} rather than a silent correction.
 * 3. **The account, scoped.** Before the `put`, so an `accountId` from another workspace costs a
 *    `SELECT` and writes no object. This is the isolation case the key layout exists for, and the
 *    refusal is a not-found rather than a forbidden, which would confirm the id exists.
 * 4. **`put`, then `assertWithinLimit`, then `insert`, with a compensating delete on any throw.**
 *    Rule 2 of this module's docblock.
 *
 * `created_by_user_id` is the scope's user, never an argument: who uploaded a file is a fact about
 * the request, and a caller that could name somebody else could forge it.
 *
 * The batch is born `queued` — the schema's own default and the first of `IMPORT_STATUSES`. The
 * sniff that follows in the same request moves it on through {@link advanceImportBatch}.
 */
export async function createImportBatch(
  scope: TenantScope,
  bucket: R2Bucket,
  input: CreateImportBatchInput,
  body: Uint8Array,
): Promise<ImportBatchRow> {
  const parsed = createImportBatchSchema.parse(input)

  if (body.byteLength !== parsed.byteSize) {
    throw new ConflictError(
      `The upload declares ${parsed.byteSize} bytes and carries ${body.byteLength}.`,
    )
  }

  // Throws `NotFoundError` for an id this workspace does not own, before anything is written.
  await getAccount(scope, parsed.accountId)

  const id = newId()
  const fileName = safeFileName(parsed.fileName)
  const r2Key = importFileKey(scope.ctx.organizationId, id, fileName)

  await bucket.put(r2Key, body)

  try {
    await assertWithinLimit(
      scope,
      IMPORT_QUOTA_METRIC,
      (await importsThisMonth(scope)) + 1,
    )

    return await importBatchRepo.insert(scope, {
      id,
      source: parsed.source,
      status: 'queued',
      fileR2Key: r2Key,
      createdByUserId: scope.ctx.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  } catch (error) {
    // The compensating delete. Without it a refused quota check leaves an object nobody references
    // and the workspace is charged for bytes it has no way to find.
    await bucket.delete(r2Key)
    throw error
  }
}

/**
 * Moves a batch through the pipeline, or refuses the move.
 *
 * The three timestamps are written by the transition rather than by a caller, so "when did this
 * run" and "when was it undone" cannot disagree with the status they belong to. `started_at` is
 * set once: a batch that failed and was retried keeps the moment work first began on it.
 */
export async function advanceImportBatch(
  scope: TenantScope,
  input: AdvanceImportBatchInput,
): Promise<ImportBatchRow> {
  const parsed = advanceImportBatchSchema.parse(input)
  const current = await importBatchRepo.requireById(scope, parsed.id)

  const from = current.status as ImportStatus
  if (!canTransition(from, parsed.status)) {
    throw new ConflictError(
      `An import batch cannot move from ${from} to ${parsed.status}.`,
    )
  }

  const now = new Date()
  return importBatchRepo.requireUpdate(scope, parsed.id, {
    status: parsed.status,
    ...(parsed.rowCount === undefined ? {} : { rowCount: parsed.rowCount }),
    ...(parsed.importedCount === undefined
      ? {}
      : { importedCount: parsed.importedCount }),
    ...(parsed.skippedCount === undefined
      ? {}
      : { skippedCount: parsed.skippedCount }),
    ...(parsed.duplicateCount === undefined
      ? {}
      : { duplicateCount: parsed.duplicateCount }),
    ...(parsed.errorCount === undefined
      ? {}
      : { errorCount: parsed.errorCount }),
    ...(parsed.status === 'running' && current.startedAt === null
      ? { startedAt: now }
      : {}),
    ...(parsed.status === 'completed' || parsed.status === 'failed'
      ? { finishedAt: now }
      : {}),
    ...(parsed.status === 'reverted' ? { revertedAt: now } : {}),
    updatedAt: now,
  })
}
