import { z } from 'zod'

import type { ImportBatchDescription } from '../-server/describe-batch'
import type { ImportUploadResult } from '#/server/fns/imports'

/**
 * The four steps, and the file's columns however the screen came by them.
 *
 * ## The stepper is addressable
 *
 * `?step=` is the whole navigation state, so back and forward are ordinary links, the browser's own
 * back button walks the flow, and a step is a thing that can be linked to. `19-S3`'s commit is the
 * fourth entry rather than a surface of its own — the length of the flow is known from the first
 * screen, which is the point of naming all four before any of them is entered.
 *
 * ## The columns have two sources, and the screen cannot tell which it got
 *
 * `uploadImport` answers with the header row and ten sample rows, and the map below holds that
 * answer for as long as the tab lives: walking from `/import` to `/import/$batchId` costs no second
 * round trip, because the file was just parsed and the result is already here.
 *
 * A reload, or a link opened in another tab, finds the map empty. `describeImportBatch` in
 * `-server/describe-batch.ts` then re-reads the stored object from R2 and parses it again, and the
 * screen carries on. That is the fallback rather than the default only because it costs a fetch and
 * a parse of a file that was, in the common case, parsed a moment ago.
 *
 * {@link ImportFileView} is what both answers narrow to, so the mapping step consumes one shape and
 * has no opinion about provenance. The one thing the fallback cannot recover is the **account**: a
 * batch row has no account column and the account lives inside the confirmed mapping, so it comes
 * back `null` until a mapping exists and the mapping step asks for it.
 *
 * The map is module-scoped rather than history state because the payload is a sample of somebody's
 * bank statement: history state is serialised into the session store and outlives the tab there.
 * Nothing about the file is written to any browser store — the durable copy is the one already in
 * R2, behind the tenant scope.
 */

export const IMPORT_STEPS = ['upload', 'map', 'review', 'done'] as const

export type ImportStep = (typeof IMPORT_STEPS)[number]

export const importStepSearchSchema = z.object({
  /**
   * Which step the person is on. Absent means the first — an unknown value is corrected to it
   * rather than refused, because a decorated or truncated link has to land on the flow.
   */
  step: z.enum(IMPORT_STEPS).catch('upload').optional(),
})

export type ImportStepSearch = z.infer<typeof importStepSearchSchema>

/** The step after this one, or `null` at the end of the flow. */
export function nextStep(step: ImportStep): ImportStep | null {
  return IMPORT_STEPS[IMPORT_STEPS.indexOf(step) + 1] ?? null
}

/** The step before this one, or `null` at the start. */
export function previousStep(step: ImportStep): ImportStep | null {
  const at = IMPORT_STEPS.indexOf(step)
  return at <= 0 ? null : IMPORT_STEPS[at - 1]
}

/**
 * What the mapping and upload steps need, whichever way the file arrived.
 *
 * `accountId` is `string` from an upload — the person chose it on the previous screen — and
 * `string | null` from a re-read, which is why the type is the wider one for both.
 */
export interface ImportFileView {
  readonly accountId: string | null
  readonly headers: ReadonlyArray<string>
  readonly sampleRows: ReadonlyArray<ReadonlyArray<string>>
  readonly rowCount: number
  readonly truncated: boolean
  readonly warnings: ImportUploadResult['warnings']
}

/** Narrows either answer to the shape the steps read. */
export function toFileView(
  source: ImportUploadResult | ImportBatchDescription,
): ImportFileView {
  return {
    accountId: source.accountId,
    headers: source.headers,
    sampleRows: source.sampleRows,
    rowCount: source.rowCount,
    truncated: source.truncated,
    warnings: source.warnings,
  }
}

/** The upload responses this tab is still holding, keyed by batch id. */
const PARSED_FILES = new Map<string, ImportUploadResult>()

export function rememberParsedFile(upload: ImportUploadResult): void {
  PARSED_FILES.set(upload.batch.id, upload)
}

/** What the upload learned about this batch's file, or `undefined` after a reload. */
export function recallParsedFile(
  batchId: string,
): ImportUploadResult | undefined {
  return PARSED_FILES.get(batchId)
}

export function forgetParsedFile(batchId: string): void {
  PARSED_FILES.delete(batchId)
}
