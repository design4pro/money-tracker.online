/**
 * The attachment server functions: the only door between the transaction detail screen and
 * `repos/attachments`.
 *
 * The same three things happen here as in `fns/splits`, and nothing else does.
 *
 * **The caller is authorised with `requireOrg()`**, inside every handler. It is called again in
 * `/api/files/$id`, because that route is reached directly by the browser and an authorisation
 * performed in this file would not be on that request.
 *
 * **The input is validated**, and for the upload that means something different from the other two:
 * the body is a multipart stream rather than a JSON object, so `readAttachmentUpload` reads it,
 * sniffs the bytes and hands back a metadata object that `uploadMetadataSchema` has already parsed
 * — and `repos/attachments` parses again with `createAttachmentSchema`. The declared `Content-Type`
 * of the part is never consulted by any of the three.
 *
 * **No write here is batched.** An attachment carries no amount and touches no account balance, so
 * nothing it does can move a day of an account's history — `runWithLedgerBatch` has no business
 * wrapping these handlers, and saying so here is what stops somebody adding it later on the theory
 * that a transaction was written to.
 *
 * The `FILES` binding is reached with a **dynamic** import, for the reason `auth/guards.ts` gives
 * at length: `cloudflare:workers` must not be in the module graph a client component pulls when it
 * imports the callable half of a server function.
 */

import { createServerFn } from '@tanstack/react-start'

import { requireOrg } from '#/server/auth/guards'
import { readAttachmentUpload } from '#/server/files/upload'
import {
  attachmentIdSchema,
  createAttachment,
  deleteAttachment as deleteAttachmentRow,
  listAttachments as listAttachmentRows,
  transactionIdSchema,
} from '#/server/repos/attachments'

import type { AttachmentRow } from '#/server/db/schema'

/** The receipt bucket for the request in flight. */
async function filesBucket(): Promise<R2Bucket> {
  const { env } = await import('cloudflare:workers')
  return env.FILES
}

/** A transaction's receipts in upload order, empty when it has none. */
export const listAttachments = createServerFn({ method: 'GET' })
  .inputValidator(transactionIdSchema)
  .handler(async ({ data }): Promise<ReadonlyArray<AttachmentRow>> => {
    const scope = await requireOrg()
    return listAttachmentRows(scope, data)
  })

/**
 * Takes one file and returns the row it became.
 *
 * One file per call, deliberately: the surface reports progress and failure **per file**, and a
 * handler that took several would have to answer "three of your five were stored" with a single
 * status code. The dropzone posts as many times as somebody dropped files.
 */
export const uploadAttachment = createServerFn({ method: 'POST' })
  .inputValidator((data: FormData) => data)
  .handler(async ({ data }): Promise<AttachmentRow> => {
    const scope = await requireOrg()
    const upload = await readAttachmentUpload(data)
    return createAttachment(
      scope,
      await filesBucket(),
      { ...upload.metadata, originalName: upload.originalName },
      upload.body,
    )
  })

/** Removes one receipt: the row, then the object. Returns the row that went. */
export const deleteAttachment = createServerFn({ method: 'POST' })
  .inputValidator(attachmentIdSchema)
  .handler(async ({ data }): Promise<AttachmentRow> => {
    const scope = await requireOrg()
    return deleteAttachmentRow(scope, await filesBucket(), data)
  })
