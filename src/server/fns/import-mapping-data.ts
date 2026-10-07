/**
 * What the mapping step and the preview compose, over a scope and a bucket they are handed.
 *
 * **Why this is not in `./import-mapping`.** That module is reached from the import screens and is
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

import type { z } from 'zod'

import { assertWithinLimit } from '#/server/repos/base'
import { ConflictError, QuotaExceededError } from '#/server/repos/errors'
import {
  DEDUPE_WINDOW_DAYS,
  importSourceHashes,
  scoreImportRows,
} from '#/server/import/dedupe'
import { mapRows, mappingSchema } from '#/server/import/map'
import { resolveParser } from '#/server/import/registry'
import { IMPORT_MAX_ROWS } from '#/server/import/types'
import { getAccount } from '#/server/repos/accounts'
import {
  countWorkspaceTransactions,
  loadDedupeCandidates,
  replaceImportRowErrors,
  setImportBatchMapping,
} from '#/server/repos/import-preview'
import {
  fingerprintHeaders,
  saveImportPreset,
} from '#/server/repos/import-presets'
import {
  advanceImportBatch,
  getImportBatch,
  readImportBatchFile,
  toImportBatchDto,
} from '#/server/repos/imports'

import { netAmountMinor } from './import-mapping'

import type { ImportBatchRow } from '#/server/db/schema'
import type { ImportMapping } from '#/server/import/map'
import type { TenantScope } from '#/server/repos/base'
import type { ImportBatchDto } from '#/server/repos/imports'
import type {
  ImportPreviewError,
  ImportPreviewResult,
  ImportPreviewRow,
  ImportPreviewSummary,
  ImportQuotaWarning,
  confirmMappingSchema,
  previewImportSchema,
} from './import-mapping'

/** The transactions metric. Named once so the warning and `19-S3`'s enforcement cannot drift. */
const TRANSACTION_QUOTA_METRIC = 'transactions'

/**
 * Stores the column map the person confirmed.
 *
 * Two things happen besides the write, and both are about the batch being **resumable**:
 *
 * - The account named in the mapping is read through the scope, so an id from another workspace is
 *   a not-found here rather than a foreign account discovered at commit.
 * - A batch already in `previewing` is moved **back** to `mapping`. That is the graph `19-S1`
 *   declared — `previewing → mapping` exists exactly so somebody who sees the preview and realises
 *   the amount column is wrong can go back — and it is also what lets the next preview move
 *   forward again and rewrite the counters.
 *
 * If the caller sent the file's header row, the confirmed mapping is also **remembered** under that
 * row's fingerprint. Remembering happens at confirmation and nowhere else, because confirmation is
 * the only moment a person has said this mapping is right. It is deliberately the last thing the
 * handler does: the batch is already usable when it runs.
 */
export async function confirmImportMappingFor(
  scope: TenantScope,
  data: z.infer<typeof confirmMappingSchema>,
): Promise<ImportBatchDto> {
  const batch = await getImportBatch(scope, { id: data.id })
  // Throws `NotFoundError` for an account this workspace does not own.
  await getAccount(scope, data.mapping.accountId)

  if (batch.status === 'previewing') {
    await advanceImportBatch(scope, { id: data.id, status: 'mapping' })
  }

  const serialised = JSON.stringify(data.mapping)
  const stored = await setImportBatchMapping(scope, {
    id: data.id,
    mapping: serialised,
  })

  if (data.headers !== undefined) {
    await saveImportPreset(scope, {
      fingerprint: await fingerprintHeaders(data.headers),
      mapping: serialised,
      ...(data.presetLabel === undefined ? {} : { label: data.presetLabel }),
    })
  }

  return toImportBatchDto(scope, stored)
}

/** `'2026-01-02'` shifted by whole days, staying a calendar date throughout. */
function shiftDate(bookedOn: string, days: number): string {
  const [year, month, day] = bookedOn.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10)
}

/** The confirmed mapping off the batch row, parsed a second time before anything reads it. */
function mappingOf(batch: ImportBatchRow): ImportMapping {
  if (batch.mapping === null) {
    throw new ConflictError(
      'This import has no confirmed mapping yet, so there is nothing to preview.',
    )
  }
  return mappingSchema.parse(JSON.parse(batch.mapping))
}

/**
 * Everything the mapping would create, everything it would skip and everything it refused.
 *
 * The order of the steps is the order of their authority. The batch and the account are read
 * through the scope first, so a batch or an account from another workspace is a not-found **before
 * a byte is fetched**. Then the bytes, then the parser the registry resolved from the batch's own
 * `source`, then the mapping, then the deduper. Nothing below re-decides anything above it.
 *
 * **On the counters and a repeat preview.** The batch's counters are written on the move
 * `mapping → previewing`, which is the only legal moment for them. A second preview with the same
 * mapping re-reads the ledger and answers from that read; the parse is deterministic over the same
 * bytes so the row-level numbers are identical, and a duplicate count that moved did so because
 * somebody added a transaction, which the commit re-scores against anyway.
 */
export async function previewImportBatchFor(
  scope: TenantScope,
  bucket: R2Bucket,
  data: z.infer<typeof previewImportSchema>,
): Promise<ImportPreviewResult> {
  const batch = await getImportBatch(scope, { id: data.id })
  const mapping = mappingOf(batch)
  const account = await getAccount(scope, mapping.accountId)

  // `file_r2_key` is nullable in the schema, so a batch whose object was never written is a
  // stated refusal rather than a `get(null)`; the reader also refuses a key that is not this
  // workspace's before the bucket is asked.
  const object = await readImportBatchFile(scope, bucket, batch)
  if (object === null) {
    throw new ConflictError(
      'The uploaded file for this import is no longer stored.',
    )
  }
  const bytes = new Uint8Array(await object.arrayBuffer())

  const parser = await resolveParser(batch.source)
  const sniff = parser.sniff(bytes)
  const parsed = parser.parse(bytes, sniff, { maxRows: IMPORT_MAX_ROWS })
  const mapped = mapRows(parsed, mapping, {
    currencyCode: account.currencyCode,
  })

  // The hashes are taken **before** the ledger is read, because the source-reference probe is an
  // indexed `IN` over the file's own hashes rather than a scan the isolate filters afterwards.
  const dates = mapped.rows.map((row) => row.bookedOn).sort()
  const hashes = await importSourceHashes(batch.source, mapped.rows)
  const scored = scoreImportRows({
    rows: mapped.rows,
    hashes,
    existing:
      dates.length === 0
        ? []
        : await loadDedupeCandidates(scope, {
            accountId: mapping.accountId,
            from: shiftDate(dates[0], -DEDUPE_WINDOW_DAYS),
            to: shiftDate(dates[dates.length - 1], DEDUPE_WINDOW_DAYS),
            sourceHashes: [...hashes.probeHashes],
          }),
  })

  const rows: ReadonlyArray<ImportPreviewRow> = mapped.rows.map((row, at) => ({
    rowIndex: row.rowIndex,
    bookedOn: row.bookedOn,
    direction: row.direction,
    amountMinor: row.amountMinor,
    description: row.description,
    payee: row.payee,
    category: row.category,
    reference: row.reference,
    notes: row.notes,
    decision: scored.verdicts[at].decision,
    confidence: scored.verdicts[at].confidence,
    reason: scored.verdicts[at].reason,
    flagged: scored.verdicts[at].flagged,
    matchedTransactionId: scored.verdicts[at].matchedTransactionId,
    matchedRowIndex: scored.verdicts[at].matchedRowIndex,
    importSourceHash: scored.verdicts[at].importSourceHash,
  }))

  const errors: ReadonlyArray<ImportPreviewError> = mapped.errors.map(
    (error) => ({
      rowIndex: error.rowIndex,
      code: error.code,
      // The key, not a sentence: the row outlives this request and is read back in whatever
      // language the person is using then.
      message: `import.error.${error.code}`,
      raw: error.raw,
    }),
  )

  const creating = rows.filter((row) => row.decision === 'create')
  const summary: ImportPreviewSummary = {
    total: parsed.rows.length,
    toCreate: creating.length,
    duplicates: rows.length - creating.length,
    invalid: errors.length,
    flagged: rows.filter((row) => row.flagged).length,
    createAmountMinor: netAmountMinor(creating),
  }

  await replaceImportRowErrors(scope, {
    batchId: batch.id,
    errors: errors.map((error) => ({
      rowIndex: error.rowIndex,
      code: error.code,
      message: error.message,
      raw: [...error.raw],
    })),
  })

  // `mapping → previewing` is the one legal move that carries the counters. A repeat preview is
  // already in `previewing` and does not move; see the docblock.
  const advanced =
    batch.status === 'mapping'
      ? await advanceImportBatch(scope, {
          id: batch.id,
          status: 'previewing',
          rowCount: summary.total,
          duplicateCount: summary.duplicates,
          skippedCount: summary.duplicates + summary.invalid,
          errorCount: summary.invalid,
        })
      : batch

  return {
    batch: toImportBatchDto(scope, advanced),
    accountId: mapping.accountId,
    currencyCode: account.currencyCode,
    summary,
    rows,
    errors,
    warnings: parsed.warnings,
    truncated: parsed.truncated,
    sourceRefUsed: scored.sourceRefUsed,
    quota: await quotaWarning(scope, summary.toCreate),
  }
}

/**
 * The plan ceiling, asked as a question rather than enforced.
 *
 * Enforcement is `19-S3`'s, per chunk, inside the write path. Here it is a **warning**, because
 * telling somebody they are over their plan after they have mapped thirty columns is hostile, and
 * because the preview writes nothing there is nothing for a refusal to protect.
 */
async function quotaWarning(
  scope: TenantScope,
  toCreate: number,
): Promise<ImportQuotaWarning | null> {
  const current = await countWorkspaceTransactions(scope)
  try {
    await assertWithinLimit(scope, TRANSACTION_QUOTA_METRIC, current + toCreate)
    return null
  } catch (error) {
    if (!(error instanceof QuotaExceededError)) throw error
    return {
      metric: error.metric,
      limit: error.limit,
      current,
      excess: current + toCreate - error.limit,
    }
  }
}
