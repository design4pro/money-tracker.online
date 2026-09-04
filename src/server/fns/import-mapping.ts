/**
 * Confirming a mapping, and previewing what it would create.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * **Nothing is written until the person has seen the preview**, and the preview may not promise a
 * number the commit would not write. Both halves of that are one mechanism rather than two
 * disciplines: there is no staging table, so {@link previewImportBatch} re-reads the batch's object
 * from R2 and re-parses it with the confirmed mapping, and `19-S3`'s commit runs the *same* parse
 * over the *same* bytes. Two representations of a file cannot disagree when there is only one.
 *
 * The stated cost of that, rather than a buried one: previewing a large file re-parses it on every
 * request. The mitigation is the shape of the response — one call returning the whole decision set,
 * not a server-paginated scan a person walks through a page at a time.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS WRITTEN HERE
 * ---------------------------------------------------------------------------
 *
 * The confirmed mapping onto `import_batches.mapping`, the batch's status and counters, and
 * `import_row_errors` — replaced, not appended, so a second preview after a mapping change shows
 * the errors of the mapping being looked at. **No transaction is created by anything in this file.**
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import {
  DEDUPE_WINDOW_DAYS,
  importSourceHashes,
  scoreImportRows,
} from '#/server/import/dedupe'
import { mapRows, mappingSchema } from '#/server/import/map'
import { resolveParser } from '#/server/import/registry'
import { IMPORT_MAX_ROWS } from '#/server/import/types'
import { assertWithinLimit } from '#/server/repos/base'
import { ConflictError, QuotaExceededError } from '#/server/repos/errors'
import { getAccount } from '#/server/repos/accounts'
import {
  countWorkspaceTransactions,
  loadDedupeCandidates,
  replaceImportRowErrors,
  setImportBatchMapping,
} from '#/server/repos/import-preview'
import {
  fingerprintHeaders,
  offerImportPreset,
  saveImportPreset,
} from '#/server/repos/import-presets'
import { advanceImportBatch, getImportBatch } from '#/server/repos/imports'

import type {
  ImportBatchRow,
  ImportMappingPresetRow,
  TransactionDirection,
} from '#/server/db/schema'
import type {
  DedupeReason,
  DuplicateConfidence,
  ImportRowDecision,
} from '#/server/import/dedupe'
import type { ImportMapping, MappedRowErrorCode } from '#/server/import/map'
import type { ImportWarning } from '#/server/import/types'

/** The transactions metric. Named once so the warning and `19-S3`'s enforcement cannot drift. */
const TRANSACTION_QUOTA_METRIC = 'transactions'

/** The `FILES` binding, reached dynamically for the reason `fns/imports.ts` gives at length. */
async function filesBucket(): Promise<R2Bucket> {
  const { env } = await import('cloudflare:workers')
  return env.FILES
}

/* -------------------------------------------------------------------------- */
/* Confirming the mapping                                                      */
/* -------------------------------------------------------------------------- */

const headersField = z.array(z.string().max(200)).min(1).max(200)

export const confirmMappingSchema = z.strictObject({
  id: z.string().trim().min(1).max(64),
  mapping: mappingSchema,
  /**
   * The file's header row, if the surface still has it.
   *
   * Present, it is what the confirmed mapping is remembered under for the next file of the same
   * shape. Absent, the mapping is stored on the batch and nothing is remembered - a preset is a
   * convenience and never a precondition.
   */
  headers: headersField.optional(),
  /** What the person calls this bank. Only ever set by them, never inferred from the file. */
  presetLabel: z.string().trim().min(1).max(200).nullable().optional(),
})

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
export const confirmImportMapping = createServerFn({ method: 'POST' })
  .inputValidator(confirmMappingSchema)
  .handler(async ({ data }): Promise<ImportBatchRow> => {
    const scope = await requireOrg()
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

    return stored
  })

/* -------------------------------------------------------------------------- */
/* The remembered mapping                                                      */
/* -------------------------------------------------------------------------- */

export const offerPresetSchema = z.strictObject({
  headers: headersField,
})

/**
 * The mapping this workspace last confirmed for a file of this shape, or `null`.
 *
 * **Offered, never applied.** The mapping screen pre-fills its fields from what comes back and a
 * person confirms it, exactly as it does with `19-S1`'s `suggestedMapping`. `repos/import-presets`
 * says at length why that is not a step to skip; the short version is that a bank which reorders
 * two columns carrying the same header text would otherwise import silently and wrongly.
 *
 * The returned `mapping` is the JSON string that was stored. It is parsed by the surface into form
 * state, never trusted straight into a commit — {@link confirmImportMapping} runs it through
 * `mappingSchema` again on the way back in.
 */
export const offerMappingPreset = createServerFn({ method: 'GET' })
  .inputValidator(offerPresetSchema)
  .handler(async ({ data }): Promise<ImportMappingPresetRow | null> => {
    const scope = await requireOrg()
    return offerImportPreset(scope, {
      fingerprint: await fingerprintHeaders(data.headers),
    })
  })

/* -------------------------------------------------------------------------- */
/* The preview                                                                 */
/* -------------------------------------------------------------------------- */

export const previewImportSchema = z.strictObject({
  id: z.string().trim().min(1).max(64),
})

/** One row as it would be created, with what the deduper decided about it. */
export interface ImportPreviewRow {
  readonly rowIndex: number
  readonly bookedOn: string
  readonly direction: TransactionDirection
  /** Strictly positive minor units in the account's currency. The sign is {@link direction}. */
  readonly amountMinor: number
  readonly description: string | null
  readonly payee: string | null
  readonly category: string | null
  readonly reference: string | null
  readonly notes: string | null
  readonly decision: ImportRowDecision
  readonly confidence: DuplicateConfidence | null
  readonly reason: DedupeReason | null
  readonly flagged: boolean
  readonly matchedTransactionId: string | null
  readonly matchedRowIndex: number | null
  /** What `19-S3` will write to `transactions.import_source_hash` for this row. */
  readonly importSourceHash: string
}

/** One row the mapping refused. `raw` is source text and is never read back as an amount. */
export interface ImportPreviewError {
  readonly rowIndex: number
  readonly code: MappedRowErrorCode
  /** An i18n key. The sentence is chosen by the surface, in the reader's language. */
  readonly message: string
  readonly raw: ReadonlyArray<string>
}

/**
 * The header summary, **recomputed from the rows** rather than accumulated while they were scored.
 *
 * A counter incremented in the same loop that makes decisions is a counter that can disagree with
 * them after one edit; a figure derived from the decision list cannot.
 */
export interface ImportPreviewSummary {
  readonly total: number
  readonly toCreate: number
  readonly duplicates: number
  readonly invalid: number
  readonly flagged: number
  /**
   * What the balance would change by if the rows to create were written. Integer minor units,
   * **signed**: expenses subtract and income adds. See {@link netAmountMinor}.
   */
  readonly createAmountMinor: number
}

/** How far past the plan's transaction ceiling this import would take the workspace. */
export interface ImportQuotaWarning {
  readonly metric: string
  readonly limit: number
  readonly current: number
  readonly excess: number
}

export interface ImportPreviewResult {
  readonly batch: ImportBatchRow
  readonly accountId: string
  /** The account's currency. The scale every amount above was converted at. */
  readonly currencyCode: string
  readonly summary: ImportPreviewSummary
  readonly rows: ReadonlyArray<ImportPreviewRow>
  readonly errors: ReadonlyArray<ImportPreviewError>
  readonly warnings: ReadonlyArray<ImportWarning>
  /** The file had more rows than one batch may carry. */
  readonly truncated: boolean
  /** Whether the file's `sourceRef` column was trusted. See `import/dedupe.ts`. */
  readonly sourceRefUsed: boolean
  /** Non-null when committing would take the workspace past its plan. A warning, not a refusal. */
  readonly quota: ImportQuotaWarning | null
}

/**
 * What the balance would change by, in integer minor units.
 *
 * `amountMinor` is strictly positive by the schema decision `import/map.ts` states - the sign of a
 * row lives in `direction`. So a sum that does not read `direction` adds three magnitudes and
 * answers with a figure no account will ever move by: a file of `-45,00`, `-12,50` and `+1500,00`
 * comes out at `1557,50` where the balance would move by `1442,50`.
 *
 * Integer addition over integer minor units, and the negation is integer too. Nothing here
 * divides, scales or formats — the scale is the account currency's and belongs to the surface.
 *
 * Exported for its own test: this is the one line of the preview a person decides on.
 */
export function netAmountMinor(rows: ReadonlyArray<SignedRow>): number {
  return rows.reduce((sum, row) => sum + signedAmountMinor(row), 0)
}

/** The two fields the sign rule reads. Both the row list and one row are described by it. */
type SignedRow = Pick<ImportPreviewRow, 'direction' | 'amountMinor'>

/**
 * One row as a signed integer of minor units.
 *
 * The sign rule stated once, so the preview's total and the preview's rows cannot drift apart.
 */
export function signedAmountMinor(row: SignedRow): number {
  return row.direction === 'expense' ? -row.amountMinor : row.amountMinor
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
export const previewImportBatch = createServerFn({ method: 'POST' })
  .inputValidator(previewImportSchema)
  .handler(async ({ data }): Promise<ImportPreviewResult> => {
    const scope = await requireOrg()
    const batch = await getImportBatch(scope, { id: data.id })
    const mapping = mappingOf(batch)
    const account = await getAccount(scope, mapping.accountId)

    // `file_r2_key` is nullable in the schema, so a batch whose object was never written is a
    // stated refusal rather than a `get(null)`.
    const object =
      batch.fileR2Key === null
        ? null
        : await (await filesBucket()).get(batch.fileR2Key)
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

    const rows: ReadonlyArray<ImportPreviewRow> = mapped.rows.map(
      (row, at) => ({
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
      }),
    )

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
      batch: advanced,
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
  })

/**
 * The plan ceiling, asked as a question rather than enforced.
 *
 * Enforcement is `19-S3`'s, per chunk, inside the write path. Here it is a **warning**, because
 * telling somebody they are over their plan after they have mapped thirty columns is hostile, and
 * because the preview writes nothing there is nothing for a refusal to protect.
 */
async function quotaWarning(
  scope: Awaited<ReturnType<typeof requireOrg>>,
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
