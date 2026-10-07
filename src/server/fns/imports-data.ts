/**
 * What the import server functions compose, over a scope and a bucket they are handed.
 *
 * **Why this is not in `./imports`.** That module is reached from the import screens and is
 * therefore in the client module graph; the Start plugin strips a `createServerFn` handler's body
 * and drops the imports that go with it, and a plain exported function beside it would not be
 * stripped. The repositories reach `@tanstack/react-start/server`, which the client environment
 * denies outright. So the composition sits here and is imported only from inside the handlers, the
 * split `dashboard/-server/dashboard-data.ts` makes for the same reason - and, as there, it is also
 * what makes the output callable from a unit test, which a `createServerFn` value is not.
 *
 * **Every function returns an `ImportBatchDto`, never the row.** The raw row stays on this side
 * because the guarded reader needs it; the mapping happens at the response boundary.
 */

import { readImportUpload } from '#/server/import/upload'
import { resolveParser } from '#/server/import/registry'
import { IMPORT_MAX_ROWS } from '#/server/import/types'
import { rethrowAsNotFound } from '#/server/fns/not-found'
import {
  advanceImportBatch,
  createImportBatch,
  getImportBatch,
  listImportBatches as listImportBatchRows,
  toImportBatchDto,
} from '#/server/repos/imports'

import type { CursorPage, TenantScope } from '#/server/repos/base'
import type {
  ImportBatchDto,
  ImportBatchIdInput,
  ListImportBatchesInput,
} from '#/server/repos/imports'
import type { ImportUploadResult } from './imports'

/** How many parsed rows come back with the upload, for the mapping screen to draw. */
const SAMPLE_ROWS = 10

/**
 * Takes one file, stores it, and answers with what it is.
 *
 * One file per call, deliberately: a batch is one file by definition — it has one `file_r2_key`,
 * one mapping and one undo — and a handler that took several would have to answer "two of your
 * three are importable" with a single status code.
 *
 * Every handler in this file hands the browser an {@link ImportBatchDto}, never the row: the raw
 * row stays on this side because the guarded reader needs it, and the mapping happens here, at the
 * response boundary. Each handler delegates to a `...For` function that takes the scope and the
 * bucket as arguments, because a server function cannot be called without a request and its output
 * is exactly what a test has to read.
 */
export async function uploadImportFor(
  scope: TenantScope,
  bucket: R2Bucket,
  form: FormData,
): Promise<ImportUploadResult> {
  const upload = await readImportUpload(form)
  // Before anything is stored: a format with no module in this build must not leave a batch row
  // behind, and `registry.ts` refuses it rather than reading the file as CSV.
  const parser = await resolveParser(upload.source)

  const batch = await createImportBatch(
    scope,
    bucket,
    {
      source: upload.source,
      accountId: upload.accountId,
      fileName: upload.fileName,
      byteSize: upload.byteSize,
    },
    upload.body,
  )

  const sniff = parser.sniff(upload.body)
  const parsed = parser.parse(upload.body, sniff, {
    maxRows: IMPORT_MAX_ROWS,
  })

  // `queued → parsing → mapping`: the two moves the sniff actually made, rather than one jump
  // that would leave the history unable to say a parse had happened.
  await advanceImportBatch(scope, { id: batch.id, status: 'parsing' })
  const mapping = await advanceImportBatch(scope, {
    id: batch.id,
    status: 'mapping',
    rowCount: parsed.rows.length,
  })

  return {
    batch: toImportBatchDto(scope, mapping),
    accountId: upload.accountId,
    sniff,
    headers: parsed.headers,
    sampleRows: parsed.rows.slice(0, SAMPLE_ROWS),
    rowCount: parsed.rows.length,
    truncated: parsed.truncated,
    warnings: parsed.warnings,
  }
}

/** The import history, newest first. A batch with a key outside the workspace is listed, not dropped. */
export async function listImportsFor(
  scope: TenantScope,
  input: ListImportBatchesInput,
): Promise<CursorPage<ImportBatchDto>> {
  const page = await listImportBatchRows(scope, input)
  return {
    ...page,
    items: page.items.map((batch) => toImportBatchDto(scope, batch)),
  }
}

/** One batch, or a not-found. An id from another workspace does not exist here. */
export async function getImportFor(
  scope: TenantScope,
  input: ImportBatchIdInput,
): Promise<ImportBatchDto> {
  const batch = await getImportBatch(scope, input).catch(rethrowAsNotFound)
  return toImportBatchDto(scope, batch)
}
