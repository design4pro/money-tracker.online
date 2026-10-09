import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'

import { describeImportBatchFor } from './describe-batch-data'

import type { FileSniff, ImportWarning } from '#/server/import/types'
import type { ImportBatchDto } from '#/server/repos/imports'

/**
 * A stored batch, read back into the shape the mapping step draws itself from.
 *
 * ## Why this exists
 *
 * `uploadImport` answers once with the header row and ten sample rows, and the tab holds that
 * answer for as long as it lives. A reload, or opening `/import/$batchId` in a second tab, used to
 * land on a dead end that asked the person to upload the statement again — and this product has no
 * bank connectors by `docs/adr/0008-no-bank-connectors.md`, so import is not one way in, it is
 * **the** way in. A dead end sitting on the only path into the product is not an edge case.
 *
 * Nothing new is stored to fix it. The bytes are already in R2, under a key composed from the
 * session's organisation, and this reads them back under the tenant scope — which is strictly
 * better for the person than putting a sample of their bank statement in a browser store, where it
 * would outlive the tab and the session both.
 *
 * ## Route-local, and why that is the right home
 *
 * It composes a repository, the bucket and the parser registry, and owns no SQL. That is the shape
 * `routes/_app/transactions/-server/list.ts` documents for this directory, and it is what the two
 * neighbours here already do. Nothing outside this screen wants a re-parse of a stored file.
 *
 * ## What it can and cannot recover
 *
 * The file, entirely: the columns, the samples, the row count and every warning the parse raised,
 * because all of that is a function of the bytes. **Not the account** — a batch row has no account
 * column, the account lives inside the confirmed mapping, and before that mapping exists nobody has
 * written it down anywhere. So `accountId` comes back `null` for a batch that has not been mapped
 * yet, and the mapping step asks for it rather than guessing. Guessing would post rows to the
 * wrong ledger.
 */

export const describeImportBatchSchema = z.strictObject({
  id: z.string().min(1).max(64),
})

/** The batch's file, re-read. The same members `ImportUploadResult` carries, minus the upload. */
export interface ImportBatchDescription {
  readonly batch: ImportBatchDto
  /** The account the confirmed mapping names, or `null` when nothing has been confirmed yet. */
  readonly accountId: string | null
  readonly sniff: FileSniff
  readonly headers: ReadonlyArray<string>
  readonly sampleRows: ReadonlyArray<ReadonlyArray<string>>
  readonly rowCount: number
  readonly truncated: boolean
  readonly warnings: ReadonlyArray<ImportWarning>
}

/** Re-reads a stored batch's file. What it does, and why, is in {@link describeImportBatchFor}. */
export const describeImportBatch = createServerFn({ method: 'GET' })
  .inputValidator(describeImportBatchSchema)
  .handler(async ({ data }): Promise<ImportBatchDescription> => {
    const scope = await requireOrg()
    const { env } = await import('cloudflare:workers')
    return describeImportBatchFor(scope, env.FILES, data)
  })
