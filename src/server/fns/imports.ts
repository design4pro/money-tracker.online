/**
 * The import server functions: the only door between the import screens and `repos/imports`.
 *
 * Three things happen here and nothing else does.
 *
 * **The caller is authorised with `requireOrg()`**, inside every handler. The scope it returns is
 * what composes the R2 key, so the object a request writes is decided by the session and not by
 * anything in the body — a forged `organizationId` in a form field is not read by any line below.
 *
 * **The input is validated**, and for the upload that means what it means in `fns/attachments`:
 * the body is a multipart stream rather than a JSON object, so `readImportUpload` reads it and
 * hands back a value `uploadSchema` has already parsed over **measured** numbers — and
 * `repos/imports` parses it again with `createImportBatchSchema`.
 *
 * **The file is sniffed and parsed in the same request that stored it**, and the result is
 * returned rather than written. This is the shape the whole area is built on: there is no staging
 * table, the preview recomputes from the same bytes and the same parser, and the only things that
 * survive this call are the R2 object and the batch row. What comes back is what the mapping
 * screen needs to draw itself — the columns, a handful of sample rows, and what the sniffer
 * decided — and the person may correct any of it before anything is written.
 *
 * **No write here is batched.** An import batch carries no amount and touches no account balance;
 * the transactions it eventually creates go through the normal write path in `19-S3`, which is
 * where `runWithLedgerBatch` belongs and where it will be.
 *
 * The `FILES` binding is reached with a **dynamic** import, for the reason `auth/guards.ts` gives
 * at length: `cloudflare:workers` must not be in the module graph a client component pulls when it
 * imports the callable half of a server function.
 */

import { createServerFn } from '@tanstack/react-start'

import { requireOrg } from '#/server/auth/guards'
import {
  importBatchIdSchema,
  listImportBatchesSchema,
} from '#/server/repos/imports'

import { getImportFor, listImportsFor, uploadImportFor } from './imports-data'

import type { FileSniff, ImportWarning } from '#/server/import/types'
import type { CursorPage } from '#/server/repos/base'
import type { ImportBatchDto } from '#/server/repos/imports'

/** The import bucket for the request in flight. The same `FILES` binding receipts live in. */
async function filesBucket(): Promise<R2Bucket> {
  const { env } = await import('cloudflare:workers')
  return env.FILES
}

/** What an upload answers with: the batch that was created, and what the file turned out to be. */
export interface ImportUploadResult {
  readonly batch: ImportBatchDto
  /** The account the person chose. Confirmed as theirs, and carried into the mapping step. */
  readonly accountId: string
  readonly sniff: FileSniff
  readonly headers: ReadonlyArray<string>
  /** The first {@link SAMPLE_ROWS} data rows. The whole file is never sent to the browser. */
  readonly sampleRows: ReadonlyArray<ReadonlyArray<string>>
  readonly rowCount: number
  /** Whether the file has more rows than one batch may take. */
  readonly truncated: boolean
  readonly warnings: ReadonlyArray<ImportWarning>
}

/** Stores one file and answers with what it is. The whole of it is {@link uploadImportFor}. */
export const uploadImport = createServerFn({ method: 'POST' })
  .inputValidator((data: FormData) => data)
  .handler(async ({ data }): Promise<ImportUploadResult> => {
    const scope = await requireOrg()
    return uploadImportFor(scope, await filesBucket(), data)
  })

/** The import history, newest first. */
export const listImports = createServerFn({ method: 'GET' })
  .inputValidator(listImportBatchesSchema)
  .handler(async ({ data }): Promise<CursorPage<ImportBatchDto>> => {
    const scope = await requireOrg()
    return listImportsFor(scope, data)
  })

/** One batch, or a not-found. */
export const getImport = createServerFn({ method: 'GET' })
  .inputValidator(importBatchIdSchema)
  .handler(async ({ data }): Promise<ImportBatchDto> => {
    const scope = await requireOrg()
    return getImportFor(scope, data)
  })
