# 19 — Import

## Area brief

File import is the **only** way transactions arrive from outside this product. There are no bank
connectors and there never will be (`docs/adr/0008-no-bank-connectors.md`,
`99-boundaries-and-blockers.md` BND-01/BND-02). That makes import a first-class area rather than a
convenience: for many people it is the difference between using the product and not.

**CSV in v1.** OFX and QIF parsers are deferred (BND-30) and XLSX is dropped (BND-12) — a person with
a spreadsheet exports CSV in one step, and shipping a 500 KB parser to avoid that step is a poor
trade. The importer is built so a second format is a new parser module behind the same pipeline, and
`19-S1` names that seam.

The pipeline is four phases and each is separately resumable:

1. **Upload and sniff** — the file lands in R2, the delimiter, encoding and header row are detected.
2. **Map** — the person maps columns to fields and confirms the amount and date conventions.
3. **Preview and dedupe** — every row is parsed, validated and checked against existing transactions;
   the person sees exactly what will be created before anything is written.
4. **Commit** — rows are inserted through the normal write path, in batches, through the queue.

The rule that governs the whole area: **nothing is written until the person has seen the preview.** An
import that silently creates 400 rows is a catastrophe to undo, so the preview is not a nicety, and
`19-S2` cannot be skipped to "ship faster".

---

## Stage 19-S1 — Upload, sniff and the CSV parser

### Stage id

`19-S1` · Wave 4 · effort **L**.

### Reference rows

`IMP-01 missing → done` — the import batch store and the upload endpoint.
`IMP-02 missing → done` — the CSV parser with delimiter, encoding and header detection.

### Owned paths

- `src/server/repos/imports.ts` — new
- `src/server/repos/__tests__/imports.test.ts` — new
- `src/server/lib/csv/parse.ts` — new
- `src/server/lib/csv/sniff.ts` — new
- `src/server/lib/csv/__tests__/parse.test.ts` — new
- `src/server/lib/csv/__tests__/sniff.test.ts` — new
- `src/server/functions/imports.ts` — new
- `src/lib/import-types.ts` — new

### Data and migration

Requisitions into `00-S9` (which owns `schema.ts`): `import_batches` (`id`, `workspace_id`,
`account_id`, `filename`, `r2_key`, `status` in
`uploaded|mapped|previewed|committing|committed|failed|cancelled`, `mapping_json`, `row_count`,
`created_row_count`, `skipped_row_count`, `error_json`, `created_by`, `created_at`, `committed_at`)
and `import_rows` (`id`, `workspace_id`, `batch_id`, `line_no`, `raw_json`, `parsed_json`,
`decision` in `create|skip_duplicate|skip_invalid|skip_user`, `duplicate_of_id`, `error_code`),
indexed on `(workspace_id, batch_id, line_no)`.

`import_rows` is the staging table that makes the preview honest and the commit resumable. It is
pruned by the weekly cron (`17 4 * * 1`, `00-S2`) **30 days after** the batch reaches a terminal
status, and the retention number lives in one constant.

### Server (repo, server function, Zod)

- **Upload.** `POST /api/imports` accepts `multipart/form-data`, cap **5 MB** and **20 000 data
  rows**, both named constants. The file is written to R2 under
  `workspaces/{workspaceId}/imports/{batchId}/{filename}` — the key layout `00-S12` owns. **The R2
  object is written first, the row second, and a throw between them triggers a compensating delete**,
  the same ordering `11-S3` uses for attachments and for the same reason.
- **Sniff.** `sniff.ts` detects: the byte-order mark; the encoding (UTF-8, UTF-16LE/BE via BOM,
  falling back to **windows-1250 for Polish exports**, which is the single most common real-world
  encoding failure in this market and is why it is named rather than left to chance); the delimiter
  (`,` `;` `\t` `|`, by consistency of field count across the first 20 lines, not by frequency); the
  quote character; and whether line 1 is a header (by type-heterogeneity between line 1 and lines
  2–10).
- **Parse.** `parse.ts` is a **streaming RFC 4180 parser** written here, not a dependency: it must run
  in workerd, handle quoted newlines, escaped quotes and a ragged final line, and stop at the row cap
  without buffering the whole file. It returns `{ headers, rows, warnings }` where a warning is a
  ragged row or a re-encoded byte, never a thrown error — a single bad line must not lose the file.
- **The format seam.** `import-types.ts` declares `interface ImportParser { id, label, sniff, parse }`
  and a registry with exactly one entry (`csv`). Adding OFX later is a new module and a registry
  entry, touching nothing in `19-S2` or `19-S3`.
- **Zod.** `uploadSchema` (accountId, file size and type), `mappingSchema` (see `19-S2`).

### UI (route, components)

None in this stage.

### Quota

`assertWithinLimit('importsPerMonth', ...)` before creating a batch, counting batches created in the
current calendar month in the workspace time zone. The number per plan is `OPEN-1`. Free-tier import
existing at all is not in question — a product whose only ingestion path is paywalled is a product
nobody evaluates.

### Tenant isolation test

In `tenant-isolation.test.ts`: A cannot read B's `import_batches` or `import_rows`; the upload
endpoint refuses an `accountId` from B with a not-found, not a forbidden (which would confirm the id
exists); and the R2 key is built from the **scope's** workspace id, never from the request body, with
an assertion that a forged `workspaceId` in the payload cannot move the object.

### Money invariant

_Parsing produces integer minor units or it produces an error — never a float._ Cases in
`parse.test.ts`:

- _`"1 234,56"`, `"1,234.56"`, `"1234.56"`, `"1234,56"` and `"1.234,56"` all parse to `123456`_ under
  the matching decimal convention, and **the convention is explicit in the mapping, never guessed**
  when the file contains both `.` and `,` in ambiguous positions — a wrong guess here is a 100×
  error in someone's ledger.
- _`"(45.00)"` and `"-45.00"` both parse to `-4500`_ when the accounting-negatives option is on.
- _a trailing or leading currency symbol and a non-breaking space are stripped_; an **embedded
  different currency code** in the cell (`"45.00 EUR"` in a PLN column) is a `skip_invalid` row with
  a named error code, not a silent coercion.
- _a value with more decimal places than the currency's `digits` is a `skip_invalid` row_, never
  rounded — rounding someone's data on import without telling them is data loss.
- _a zero-decimal currency's `"1200"` parses to `1200`, not `120000`_, driven by `currencies.digits`.
- _the parser never returns a JavaScript `number` for an amount_ — the type is `Minor`, asserted at
  the type level and at runtime with an integer check.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `sniff.test.ts`: fixtures for UTF-8 with and without BOM, UTF-16LE, windows-1250 with Polish
  diacritics, `;`-delimited (the Polish Excel default), tab-delimited, headerless, and a file whose
  first line is a bank's title row rather than a header.
- `parse.test.ts`: the six money cases; quoted newlines; escaped quotes; a ragged row producing a
  warning and not a throw; the 20 000-row cap; a 5 MB file streaming without exceeding a memory
  assertion on chunk count.
- `imports.test.ts`: the compensating delete on a post-R2 throw; the quota rejection; the status
  transitions rejecting an illegal move (`committed → mapped` throws).
- No browser evidence — this stage renders nothing.

### Definition of done

All six §7 items; the §2 visual clauses are carried by `19-S2` and `19-S3`, stated explicitly.

### Blockers

None.

---

## Stage 19-S2 — Mapping and the preview with duplicate detection

### Stage id

`19-S2` · Wave 4 · effort **L**.

### Reference rows

`IMP-03 missing → done` — the column mapping step with saved profiles.
`IMP-04 missing → done` — the preview with per-row validation and duplicate detection.

### Owned paths

- `src/server/lib/import-map.ts` — new
- `src/server/lib/import-dedupe.ts` — new
- `src/server/lib/__tests__/import-dedupe.test.ts` — new
- `src/routes/_app/import/index.tsx` — new
- `src/routes/_app/import/$batchId.tsx` — new
- `src/routes/_app/import/-ui/mapping-step.tsx` — new
- `src/routes/_app/import/-ui/preview-step.tsx` — new
- `e2e/import.spec.ts` — new

### Data and migration

Requisitions `import_profiles` into `00-S9`: `id`, `workspace_id`, `name`, `mapping_json`,
`signature` (a hash of the sorted header names), `created_at`, unique on `(workspace_id, name)`. On
upload, a profile whose `signature` matches the file's headers is **offered**, pre-filling the
mapping — it is never applied silently, because a bank that reorders its columns would otherwise
import everything into the wrong fields.

### Server (repo, server function, Zod)

- **`mappingSchema`.** `date` (required, plus a `dateFormat` from an enum of named patterns —
  `YYYY-MM-DD`, `DD/MM/YYYY`, `MM/DD/YYYY`, `DD.MM.YYYY`, and an explicit "ambiguous" rejection when
  the sample cannot distinguish DMY from MDY), `amount` (required, in one of two shapes: a single
  signed column, or a debit column plus a credit column), `decimalSeparator`, `thousandsSeparator`,
  `accountingNegatives`, and optional `description`, `payee`, `category`, `reference`, `notes`,
  `currency`.
- **The DMY/MDY rejection is the point.** If every sampled day is ≤ 12, the mapping step **requires an
  explicit choice** rather than defaulting. Defaulting here silently misdates up to 12/31 of a
  person's rows and nobody notices for months.
- **Dedupe.** `import-dedupe.ts` scores an incoming row against existing transactions in the target
  account within ±3 days: exact match on (`booked_on`, `amount_minor`, normalised description) is a
  **certain** duplicate; a match on (`booked_on`, `amount_minor`) alone is a **probable** one. Certain
  duplicates default to `skip_duplicate`; probable ones default to `create` **and are flagged**, on
  the principle that a missing transaction is more discoverable than a silently dropped one. It also
  dedupes **within the file**, because banks re-export overlapping ranges.
- **Preview.** `previewBatch` writes one `import_rows` row per line with its parsed values, decision
  and error code, then returns a page of them. It is idempotent: re-running replaces the batch's rows
  in one D1 batch (delete-range then insert), the same pattern `09-S1` uses.

### UI (route, components)

- **Route.** `/import` (a list of recent batches plus the upload form) and `/import/$batchId` (the
  stepper).
- **Components.** `mapping-step.tsx` — a table whose columns are the file's headers, each with a
  field `Select`, showing three sample values per column so the choice is grounded in the data;
  `preview-step.tsx` — the parsed rows in the `data-table` (`00-S8`) with a decision control per row,
  a filter by decision, and a header summary ("312 to create · 18 duplicates skipped · 4 invalid").
- **States.** Uploading; sniffing; **needs mapping**; **needs a disambiguation** (the DMY/MDY case,
  rendered as a blocking inline question, not a toast); previewing; **preview ready**; **all rows
  invalid** (a designed dead-end with the first three errors quoted and a "start over" action);
  committing; committed; failed; cancelled.
- **Accessibility.** The stepper is a real sequence: each step is a `<section>` with an `<h2>`, the
  current step is announced on entry, and back/forward are links so browser history works. The
  preview table's decision control is a `Select` with an accessible name including the row's date and
  amount, never a bare "Action". Errors are associated with their rows via `aria-describedby`. Nothing
  in the flow is time-limited (2.2.6 AAA).

### Quota

The **preview** does not consume quota; the batch already did at upload. `assertWithinLimit` for
`transactions` is checked at preview time as a **warning** ("this import would exceed your plan by 40
transactions") and enforced at commit — telling someone after they mapped 30 columns is hostile.

### Tenant isolation test

In `tenant-isolation.test.ts`: dedupe only ever queries within the scope, asserted by seeding B with
byte-identical transactions and confirming A's rows are **not** marked duplicate; `import_profiles`
are not visible across workspaces; and `$batchId` from B renders a not-found.

### Money invariant

_The preview's numbers are the numbers that will be written._ Cases in `money-invariants.test.ts` and
`import-dedupe.test.ts`:

- _every previewed row's `amount_minor` is the integer that the commit inserts_, asserted by
  comparing the `import_rows.parsed_json` to the created transaction for a full batch.
- _the summary's "to create" total equals the sum of the rows whose decision is `create`_, recomputed
  from the rows rather than tracked incrementally.
- _a debit/credit column pair produces one signed integer_, with both columns populated on one line
  being a `skip_invalid` row rather than a sum.
- _a row whose currency column differs from the account's currency is `skip_invalid`_ in v1, with a
  named error code — converting on import would need a rate for a historical date the file does not
  supply, and guessing is worse than refusing.
- _duplicate detection compares integers_, never formatted strings, so `1 234,56` and `1234.56` in
  two files are the same amount.

### Verification

- Command gate.
- `import-dedupe.test.ts`: certain vs probable; the ±3-day window's edges; within-file duplicates; a
  re-import of the same file marking every row `skip_duplicate`.
- `e2e/import.spec.ts`: upload a `;`-delimited windows-1250 fixture with Polish diacritics, map it,
  hit the DMY/MDY disambiguation, preview, and assert the summary — **without committing**, which is
  `19-S3`'s test.
- Browser evidence at the pinned clock: `/import` and both steps of `/import/$batchId`, both themes,
  at **360 / 1280 / 2560 px** (the mapping table at 360px is a stacked layout and the evidence must
  show it), plus the **disambiguation state**, the **all-rows-invalid state**, and a **row flagged as
  a probable duplicate**.
- axe on both steps: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 19-S3 — Commit, undo and the batch history

### Stage id

`19-S3` · Wave 4 · effort **M**.

### Reference rows

`IMP-05 missing → done` — queued, batched, resumable commit.
`IMP-06 missing → done` — undo an import batch.
`IMP-07 missing → done` — the import history with per-batch outcome.

### Owned paths

- `src/server/queue/handlers/import-commit.ts` — new
- `src/server/queue/handlers/__tests__/import-commit.test.ts` — new
- `src/routes/_app/import/-ui/commit-step.tsx` — new
- `src/routes/_app/import/-ui/history-list.tsx` — new

### Data and migration

Requisitions into `00-S9`: `transactions.import_batch_id` (nullable, indexed with `workspace_id`).
That column is what makes undo exact — undo deletes **the transactions this batch created and no
others**, identified by the column rather than by a time window or a heuristic.

### Server (repo, server function, Zod)

- **Commit** is a queue job (`00-S12`'s envelope, kind `import.commit`), not a request: 20 000 rows
  do not fit in a request's CPU budget. It processes `import_rows` with `decision = 'create'` in
  chunks of **100**, writing through `07-S1`'s `createTransaction` so **every policy, every quota
  check and every ledger notification applies** — an import that bypassed the write path would produce
  transactions the balance rebuild has never heard of.
- **Idempotency.** Each chunk marks its rows committed in the same D1 batch as the inserts. A retried
  message re-reads and skips already-committed rows, so at-least-once delivery cannot double-post.
  The DLQ path marks the batch `failed` with the chunk index preserved, and a resume continues from
  there rather than restarting.
- **Ledger.** The whole commit runs inside `runWithLedgerBatch` (`09-S2`) so the balance rebuild is
  coalesced into one pass per account instead of 20 000.
- **Undo.** `undoImport(batchId)` deletes those transactions in chunks through the same write path
  (so the ledger and budgets react) and sets the batch to `cancelled`. It is available for **30 days**
  and refuses once any created transaction has been **edited** — silently reverting someone's later
  work is worse than refusing, and the refusal names the offending rows.

### UI (route, components)

- **Components.** `commit-step.tsx` — a progress region driven by polling the batch (not a websocket;
  BND-14), showing created/skipped counts and a per-chunk status; `history-list.tsx` — batches with
  filename, date, outcome, and Undo where eligible.
- **States.** Queued; running (with a real progress figure, never an indeterminate spinner for a
  known-length job); succeeded; **partially succeeded** (some chunks failed — the count is stated and
  a resume is offered); failed; cancelled; **undo refused** (with the reason and the edited rows
  listed).
- **Accessibility.** Progress is a `progressbar` with `aria-valuenow`, and the completion is announced
  once in a polite live region — not on every poll tick, which would flood a screen reader. Undo is
  an `AlertDialog` naming the exact count to be removed.

### Quota

`assertWithinLimit('transactions', ...)` is enforced **per chunk** inside the write path. Hitting the
ceiling mid-import stops the job cleanly, marks the batch `partially_committed`, and reports how many
rows landed and how many remain — it does not roll back what succeeded, because a partial import a
person can see is more useful than an invisible failure.

### Tenant isolation test

In `tenant-isolation.test.ts`: the queue handler builds its scope from the **message body's workspace
id validated against the batch row**, and a message naming B's batch under A's workspace is dropped
to the DLQ rather than processed; `undoImport` on B's batch from A is a not-found.

### Money invariant

_Committing writes exactly what the preview promised, and undo removes exactly what commit wrote._
Cases in `money-invariants.test.ts`:

- _the sum of created transactions' `amount_minor` equals the preview summary's stated total_, to the
  minor unit.
- _`ref_amount_minor` is computed at each row's own `booked_on` rate_, not at the import date — an
  import of last year's data must not value it at today's rate.
- _a retried queue message creates no additional rows_, asserted by delivering the same message
  three times and comparing counts and sums.
- _after undo, every affected account's balance equals its pre-import balance_, asserted by capturing
  the balance before the import and after the undo — this is the test that proves the ledger reacted
  to both directions.
- _a partially committed batch's created count equals the actual row count_, so a person can trust the
  number they are shown when deciding whether to resume.

### Verification

- Command gate.
- `import-commit.test.ts`: chunking; idempotent redelivery; DLQ on a poisoned chunk; resume from the
  preserved index; the quota stop; undo including the refusal-on-edit path.
- `e2e/import.spec.ts` extended: commit the fixture from `19-S2`, assert the transaction list contains
  the rows, undo, and assert the balance returned to its starting value.
- Browser evidence at the pinned clock: the **commit step running**, **succeeded**, **partially
  succeeded**, and the **history list with an Undo dialog open**, both themes, 360 / 1280 / 2560 px.
- axe on the commit step and the history list: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.
