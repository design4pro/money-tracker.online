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
import { mappingSchema } from '#/server/import/map'
import {
  fingerprintHeaders,
  offerImportPreset,
} from '#/server/repos/import-presets'

import {
  confirmImportMappingFor,
  previewImportBatchFor,
} from './import-mapping-data'

import type {
  ImportMappingPresetRow,
  TransactionDirection,
} from '#/server/db/schema'
import type { ImportBatchDto } from '#/server/repos/imports'
import type {
  DedupeReason,
  DuplicateConfidence,
  ImportRowDecision,
} from '#/server/import/dedupe'
import type { MappedRowErrorCode } from '#/server/import/map'
import type { ImportWarning } from '#/server/import/types'

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

/** Stores the confirmed mapping. What it does, and why, is in {@link confirmImportMappingFor}. */
export const confirmImportMapping = createServerFn({ method: 'POST' })
  .inputValidator(confirmMappingSchema)
  .handler(async ({ data }): Promise<ImportBatchDto> => {
    const scope = await requireOrg()
    return confirmImportMappingFor(scope, data)
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
  readonly batch: ImportBatchDto
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

/** The preview. What it does, and why, is in {@link previewImportBatchFor}. */
export const previewImportBatch = createServerFn({ method: 'POST' })
  .inputValidator(previewImportSchema)
  .handler(async ({ data }): Promise<ImportPreviewResult> => {
    const scope = await requireOrg()
    return previewImportBatchFor(scope, await filesBucket(), data)
  })
