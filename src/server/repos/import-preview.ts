/**
 * The SQL the mapping-and-preview step needs: what a file turns out to say.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AND WHY IT HOLDS THREE THINGS
 * ---------------------------------------------------------------------------
 *
 * `./imports` belongs to `19-S1` and owns *a batch arriving* — the object in R2, the row, the
 * status graph. This file owns the other half of the pipeline's SQL, and a stage in this wave may
 * not edit a file another stage owns, so the three reads and writes the mapping-and-preview step
 * needs live here together rather than being spread across a file this stage may not touch.
 * `./import-presets` is the fourth and has its own file, because a remembered mapping outlives
 * every batch that used it:
 *
 * 1. **`import_row_errors`** — the table the module is named for, and the only thing a preview
 *    persists. {@link replaceImportRowErrors} is a **replace**, so re-previewing after a mapping
 *    change is idempotent rather than additive.
 * 2. **`import_batches.mapping`** — the confirmed column map. `advanceImportBatchSchema` in
 *    `./imports` deliberately excludes it, precisely so that this stage is its only writer.
 * 3. **The dedupe candidates** — existing transactions in the target account, read under the
 *    caller's scope. `src/server/import/dedupe.ts` is a pure scorer and holds no `TenantScope`;
 *    this is where its input comes from, and the tenant filter it comes through is the reason
 *    seeding B with byte-identical transactions leaves A's rows un-duplicated.
 *
 * ---------------------------------------------------------------------------
 * `raw` IS NOT MONEY
 * ---------------------------------------------------------------------------
 *
 * `import_row_errors.raw` is the verbatim source cells — comma decimal separator, currency symbol,
 * non-breaking space and all. It is the **one amount-shaped value in this system that is not in
 * minor units**, and it is kept so a human can read what they actually wrote. Nothing parses it
 * back into the money path; see the comment at the write site, which is the one place the rule
 * could be broken.
 */

import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { z } from 'zod'

import { newId } from '#/server/db/ids'
import {
  importBatches,
  importRowErrors,
  transactions,
} from '#/server/db/schema'

import {
  allOf,
  createTenantRepository,
  createTenantTableAccess,
  tenantFilter,
} from './base'
import { ConflictError } from './errors'

import type { ExistingTransaction } from '#/server/import/dedupe'
import type { ImportBatchRow, ImportRowErrorRow } from '#/server/db/schema'
import type { TenantScope } from './base'

const errorAccess = createTenantTableAccess(importRowErrors, 'import row error')
const batchRepo = createTenantRepository(importBatches, 'import batch')
const transactionAccess = createTenantTableAccess(transactions, 'transaction')

/* -------------------------------------------------------------------------- */
/* Caps                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * How much of a rejected row's source text is kept.
 *
 * Enough to recognise the line in the file, and bounded so one malformed 5 MB export cannot fill
 * the table. The number is here rather than in the column's type because it is a product number.
 */
export const IMPORT_RAW_MAX_CHARS = 500

/** Rows per `INSERT`, so a 20 000-row file does not compose one statement D1 refuses. */
const ERRORS_PER_INSERT = 200

/**
 * How many source-reference hashes go into one `IN (…)`.
 *
 * D1 caps a statement at 100 bound parameters, and the predicate around the list needs a few of
 * them, so the list itself stays under ninety. The probe is **exact and unbounded in total**: it
 * asks the database about the hashes the file actually carries rather than pulling the account's
 * hashes into the isolate to filter them here. That is the direction
 * `transactions_organization_id_import_source_hash_idx` exists for, it has no ceiling above which a
 * match is lost, and it returns the handful of real hits instead of tens of thousands of rows.
 */
const SOURCE_HASHES_PER_QUERY = 90

/* -------------------------------------------------------------------------- */
/* Input schemas                                                               */
/* -------------------------------------------------------------------------- */

const idField = z.string().trim().min(1).max(64)

/**
 * One rejected row.
 *
 * `code` is a machine name from the mapping layer and `message` is an **i18n key**, never a
 * sentence with data baked into it: the row outlives the request that wrote it and is read back in
 * whatever language the person is using then.
 */
export const importRowErrorSchema = z.strictObject({
  rowIndex: z.number().int().min(0),
  code: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(500).nullable().optional(),
  /** The source cells. Truncated on write. Never read back as an amount. */
  raw: z.array(z.string()).max(500).optional(),
})

export const replaceImportRowErrorsSchema = z.strictObject({
  batchId: idField,
  errors: z.array(importRowErrorSchema).max(20_000),
})

export type ReplaceImportRowErrorsInput = z.input<
  typeof replaceImportRowErrorsSchema
>

export const listImportRowErrorsSchema = z.strictObject({
  batchId: idField,
  limit: z.number().int().positive().max(1000).optional(),
})

export type ListImportRowErrorsInput = z.input<typeof listImportRowErrorsSchema>

export const setImportBatchMappingSchema = z.strictObject({
  id: idField,
  /** The confirmed mapping, already validated by `mappingSchema`, serialised on the way in. */
  mapping: z.string().min(2).max(20_000),
})

export type SetImportBatchMappingInput = z.input<
  typeof setImportBatchMappingSchema
>

export const dedupeCandidatesSchema = z.strictObject({
  accountId: idField,
  /** Inclusive `booked_on` bounds, already widened by the dedupe window. */
  from: z.iso.date(),
  to: z.iso.date(),
  /**
   * The `<source>:<value>` hashes of the incoming rows, from
   * `import/dedupe.ts`'s `importSourceHashes`.
   *
   * Empty for a file with no usable reference column, which is the common case and costs no query.
   */
  sourceHashes: z
    .array(z.string().trim().min(1).max(200))
    .max(20_000)
    .optional(),
})

export type DedupeCandidatesInput = z.input<typeof dedupeCandidatesSchema>

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/** One batch's errors, in file order — the only read this table serves and the index it has. */
export async function listImportRowErrors(
  scope: TenantScope,
  input: ListImportRowErrorsInput,
): Promise<ReadonlyArray<ImportRowErrorRow>> {
  const parsed = listImportRowErrorsSchema.parse(input)
  return errorAccess.findMany(scope, {
    where: eq(importRowErrors.batchId, parsed.batchId),
    orderBy: [importRowErrors.rowIndex],
    limit: parsed.limit,
  })
}

/**
 * Replaces this batch's whole error set: delete the range, then insert the new one.
 *
 * **Replace rather than append, and that is what makes a re-preview idempotent.** A person who
 * previews, sees four bad rows, fixes the date format and previews again must be shown the errors
 * of the mapping they are looking at — not those four plus whatever the new mapping produced. The
 * delete is bounded to this batch, so another batch's report is untouched.
 *
 * **Why this is not one `db.batch()`, which the plan text asks for.** A batch needs statement
 * *builders* and the base's `removeWhere` / `insertMany` execute; composing the statements here
 * instead would mean hand-stamping `organization_id`, which the fork guard in
 * `__tests__/tenant-isolation.test.ts` forbids a repository from doing — and is right to.
 * `repos/account-balances` and `repos/splits` weighed the same pair and ruled the same way. Of the
 * two rules the tenant one is enforced and atomicity is not, and **the worst case of the window
 * here is a valid state**: an error set that was deleted and not re-inserted is an empty error
 * report on a batch that has written no transactions, and the next preview rebuilds it from the
 * same bytes. Nothing a person could act on is lost, because nothing was committed. The seam that
 * would close it belongs in `base.ts`, not in a fourth repository reaching around it.
 */
export async function replaceImportRowErrors(
  scope: TenantScope,
  input: ReplaceImportRowErrorsInput,
): Promise<number> {
  const parsed = replaceImportRowErrorsSchema.parse(input)
  // The batch is read through the scope first, so B's id deletes nothing and writes nothing.
  await batchRepo.requireById(scope, parsed.batchId)

  await errorAccess.removeWhere(
    scope,
    eq(importRowErrors.batchId, parsed.batchId),
  )

  const now = new Date()
  const rows = parsed.errors.map((error) => ({
    id: newId(),
    batchId: parsed.batchId,
    rowIndex: error.rowIndex,
    code: error.code,
    message: error.message ?? null,
    // `raw` is the file's own text and it stays the file's own text. It is stored so a person can
    // read the line that was refused; **no repository parses it back into the money path**, and
    // `money-invariants.test.ts` asserts exactly that. Anything that wants this row's amount goes
    // back to the bytes in R2 and through `src/server/import/amount.ts`.
    raw:
      error.raw === undefined
        ? null
        : JSON.stringify(error.raw).slice(0, IMPORT_RAW_MAX_CHARS),
    createdAt: now,
  }))

  for (let at = 0; at < rows.length; at += ERRORS_PER_INSERT) {
    await errorAccess.insertMany(scope, rows.slice(at, at + ERRORS_PER_INSERT))
  }

  return rows.length
}

/* -------------------------------------------------------------------------- */
/* The confirmed mapping                                                       */
/* -------------------------------------------------------------------------- */

/** Statuses after which the mapping is history rather than a setting. */
const MAPPING_FROZEN_AFTER: ReadonlySet<string> = new Set([
  'running',
  'completed',
  'failed',
  'reverted',
])

/**
 * Stores the confirmed column map on the batch.
 *
 * Refused once the batch has started running, and that refusal is the preview's promise held from
 * the other side: the commit re-parses the same bytes with the mapping stored here, so a mapping
 * edited underneath a running job would write numbers no preview ever showed anybody.
 *
 * The status is not *advanced* here — the graph belongs to `./imports` and has one door.
 */
export async function setImportBatchMapping(
  scope: TenantScope,
  input: SetImportBatchMappingInput,
): Promise<ImportBatchRow> {
  const parsed = setImportBatchMappingSchema.parse(input)
  const batch = await batchRepo.requireById(scope, parsed.id)

  if (MAPPING_FROZEN_AFTER.has(batch.status)) {
    throw new ConflictError(
      `An import batch that is ${batch.status} cannot have its mapping changed.`,
    )
  }

  return batchRepo.requireUpdate(scope, parsed.id, {
    mapping: parsed.mapping,
    updatedAt: new Date(),
  })
}

/* -------------------------------------------------------------------------- */
/* Dedupe candidates                                                           */
/* -------------------------------------------------------------------------- */

/** The five columns a comparison reads. Selected by name so a wide row is not shipped per match. */
const CANDIDATE_COLUMNS = {
  id: transactions.id,
  bookedOn: transactions.bookedOn,
  direction: transactions.direction,
  amountMinor: transactions.amountMinor,
  description: transactions.note,
  importSourceHash: transactions.importSourceHash,
}

/**
 * What an incoming file is compared against: the target account's transactions, under this scope.
 *
 * Two reads, because the two mechanisms in `src/server/import/dedupe.ts` need different sets:
 *
 * - **The scorer's window** — everything in the account between `from` and `to`, which the caller
 *   has already widened by {@link import('#/server/import/dedupe').DEDUPE_WINDOW_DAYS}.
 * - **The source-reference probe** — the transactions carrying one of `sourceHashes`, with **no
 *   date window at all**, because a row an institution identified is the same row whatever date it
 *   eventually settled on. It asks the database for the file's own hashes rather than reading the
 *   account's hashes into the isolate: exact, indexed, no ceiling above which a match is lost, and
 *   a handful of rows back instead of tens of thousands. A file with no usable reference column
 *   sends no hashes and runs no such query.
 *
 * Both go through `tenantFilter`, which is what makes the scorer's isolation a property of the
 * query rather than of the caller remembering: B's byte-identical transactions are not in either
 * result set, so A's rows are never marked duplicate because of them.
 *
 * The account id is **not** checked for existence here — the caller reads it through
 * `getAccount` first, so an id from another workspace is a not-found before a comparison is
 * composed. This function would simply return nothing for one, which is correct but silent.
 */
export async function loadDedupeCandidates(
  scope: TenantScope,
  input: DedupeCandidatesInput,
): Promise<ReadonlyArray<ExistingTransaction>> {
  const parsed = dedupeCandidatesSchema.parse(input)
  const inAccount = eq(transactions.accountId, parsed.accountId)

  const found = await scope.db
    .select(CANDIDATE_COLUMNS)
    .from(transactions)
    .where(
      tenantFilter(
        scope,
        transactions,
        allOf(
          inAccount,
          and(
            gte(transactions.bookedOn, parsed.from),
            lte(transactions.bookedOn, parsed.to),
          ),
        ),
      ),
    )

  const hashes = [...new Set(parsed.sourceHashes ?? [])]
  for (let at = 0; at < hashes.length; at += SOURCE_HASHES_PER_QUERY) {
    found.push(
      ...(await scope.db
        .select(CANDIDATE_COLUMNS)
        .from(transactions)
        .where(
          tenantFilter(
            scope,
            transactions,
            allOf(
              inAccount,
              inArray(
                transactions.importSourceHash,
                hashes.slice(at, at + SOURCE_HASHES_PER_QUERY),
              ),
            ),
          ),
        )),
    )
  }

  const byId = new Map<string, ExistingTransaction>()
  for (const row of found) {
    byId.set(row.id, {
      id: row.id,
      bookedOn: row.bookedOn,
      direction: row.direction === 'income' ? 'income' : 'expense',
      amountMinor: row.amountMinor,
      description: row.description,
      importSourceHash: row.importSourceHash,
    })
  }
  return [...byId.values()]
}

/**
 * How many transactions the workspace holds.
 *
 * The figure the preview's plan-ceiling **warning** is computed from. The metric is metered per
 * workspace rather than per account, so this counts the workspace: telling somebody they are over
 * their plan after they mapped thirty columns is hostile, and telling them the wrong number is
 * worse.
 */
export async function countWorkspaceTransactions(
  scope: TenantScope,
): Promise<number> {
  return transactionAccess.count(scope)
}
