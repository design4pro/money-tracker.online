import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import { resolveParser } from '#/server/import/registry'
import { IMPORT_MAX_ROWS } from '#/server/import/types'
import { getImportBatch, readImportBatchFile } from '#/server/repos/imports'

import type { ImportBatchRow } from '#/server/db/schema'
import type { FileSniff, ImportWarning } from '#/server/import/types'

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
  readonly batch: ImportBatchRow
  /** The account the confirmed mapping names, or `null` when nothing has been confirmed yet. */
  readonly accountId: string | null
  readonly sniff: FileSniff
  readonly headers: ReadonlyArray<string>
  readonly sampleRows: ReadonlyArray<ReadonlyArray<string>>
  readonly rowCount: number
  readonly truncated: boolean
  readonly warnings: ReadonlyArray<ImportWarning>
}

/** How many parsed rows come back, matching what `uploadImport` sends for the same screen. */
const SAMPLE_ROWS = 10

/**
 * The account id a stored mapping names, if the JSON is a mapping and names one.
 *
 * The column is free text as far as the database is concerned, so this reads defensively rather
 * than trusting it: a row written by an older shape of the mapping, or by hand, yields `null` and
 * the screen asks the question again. It deliberately does not run `mappingSchema` — a mapping that
 * no longer validates should still let a person see their columns and remap.
 */
function accountIdOf(mapping: string | null): string | null {
  if (mapping === null) return null
  try {
    const parsed: unknown = JSON.parse(mapping)
    if (typeof parsed !== 'object' || parsed === null) return null
    const value = (parsed as Record<string, unknown>).accountId
    return typeof value === 'string' && value !== '' ? value : null
  } catch {
    return null
  }
}

export const describeImportBatch = createServerFn({ method: 'GET' })
  .inputValidator(describeImportBatchSchema)
  .handler(async ({ data }): Promise<ImportBatchDescription> => {
    const scope = await requireOrg()
    // Tenant-scoped: a batch id belonging to another workspace is not found, which is the same
    // answer an id that never existed gets.
    const batch = await getImportBatch(scope, { id: data.id })

    if (batch.fileR2Key === null) {
      throw new Error('This import has no stored file.')
    }

    const { env } = await import('cloudflare:workers')
    const object = await readImportBatchFile(scope, env.FILES, batch)
    if (object === null) {
      throw new Error('The stored file for this import is gone.')
    }

    const parser = await resolveParser(batch.source)
    const bytes = new Uint8Array(await object.arrayBuffer())
    const sniff = parser.sniff(bytes)
    const parsed = parser.parse(bytes, sniff, { maxRows: IMPORT_MAX_ROWS })

    return {
      batch,
      accountId: accountIdOf(batch.mapping),
      sniff,
      headers: parsed.headers,
      sampleRows: parsed.rows.slice(0, SAMPLE_ROWS),
      rowCount: parsed.rows.length,
      truncated: parsed.truncated,
      warnings: parsed.warnings,
    }
  })
