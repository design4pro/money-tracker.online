# 19 — Import

## Area brief

File import is the **only** way transactions arrive from outside this product. There are no bank
connectors and there never will be (`docs/adr/0008-no-bank-connectors.md`,
`99-boundaries-and-blockers.md` BND-01/BND-02). That makes import a first-class area rather than a
convenience: for many people it is the difference between using the product and not.

**Four formats and two migrations, all owned here.** `IMPORT_SOURCES` in `src/server/db/schema.ts`
already enumerates them — `csv`, `ofx`, `qif`, `ynab`, `wallet`, `json_backup` — and the enum is
already migrated, so the formats are a commitment the database carries rather than an ambition.
CSV is `19-S1`. OFX and QIF are `19-S4`, hand-rolled to the contract BND-30 writes down: OFX 1.x
SGML and OFX 2.x XML, `STMTTRN` records only — no investment statements, no balance reconciliation
— and QIF limited to the `!Type:Bank` / `!Type:CCard` subset. They are hand-rolled because the npm
options are unmaintained and their failure mode on a malformed file is an exception carrying no row
number, which is exactly the information the preview needs. The two tracker migrations are `19-S5`.
`json_backup` is this product's own export read back and belongs to plan `20`. XLSX is the one
format that is deferred (BND-12): a person with a spreadsheet exports CSV in one step, and shipping
a 500 KB parser with a CVE history to avoid that step is a poor trade.

A capture round of the reference surface found **no entry for either interchange format there**
(`docs/agents/parity.md` gap 2, where the observation is recorded and is not repeated here). `19-S4`
is therefore not catching anyone up. It keeps a promise this product made to itself in
`docs/adr/0008-no-bank-connectors.md`, which named those formats as part of what we bought instead
of connectivity, and it is owed regardless of what anyone else ships. A later reader who finds no
competitive pressure behind the stage has found the point, not a reason to delete it.

The importer is built so a format is a parser module behind one pipeline, and `19-S1` names that
seam. `19-S4` and `19-S5` are that seam being used: each adds a directory and edits no file another
stage in this wave owns.

The pipeline is four phases and each is separately resumable:

1. **Upload and sniff** — the file lands in R2, the format is resolved and the delimiter, encoding
   and header row are detected.
2. **Map** — the person maps columns to fields and confirms the amount and date conventions.
3. **Preview and dedupe** — every row is parsed, validated and checked against existing transactions;
   the person sees exactly what will be created before anything is written.
4. **Commit** — rows are inserted through the normal write path, in batches, through the queue.

The rule that governs the whole area: **nothing is written until the person has seen the preview.** An
import that silently creates 400 rows is a catastrophe to undo, so the preview is not a nicety, and
`19-S2` cannot be skipped to "ship faster".

**The entry surface is organised by where the data comes from, not by file format.** Two groups on
`/import`: a file exported from a bank or a spreadsheet first, a migration out of another tracker
second. Format is a property of the file the pipeline sniffs, not a choice a person should make from
a list of acronyms, and ordering by format puts the case with the weakest signal last.
`docs/agents/parity.md` gap 1 carries that observation and ranks it first; the row it asks for is not
minted here, and when it is, it belongs at the **head of the first group** rather than appended after
the formats. `19-S2` builds the surface in that shape now, with the import history beside the two
groups as a peer surface rather than something reached through a batch.

**One question is recorded rather than decided:** whether a single upload may carry several files on
condition that they share a column set. It is a product call and not a plan call — it changes the
batch's relationship to its object in R2, the meaning of `row_count`, and what undo removes — so it
is written down here rather than answered by whoever implements `19-S1` first. Until it is made,
`19-S1` ships one file per batch. It is not a row and no stage waits on it.

**There is no staging table, and that is a decision rather than an omission.** The schema has
`import_batches`, `import_mapping_presets` and `import_row_errors`, and nothing that holds a parsed
row. The preview recomputes from the stored file plus the confirmed mapping, and the commit runs
that same parse over those same bytes, so the two cannot disagree about what will be written — where
a staging table is a second representation of the file, written once and free to drift from it
afterwards. Only errors persist, because an error is the one thing a person comes back to read after
the batch is over. Nothing follows from a staging table that has to be built instead: there is no
retention window to choose and no pruning cron to write, and undo stays exact without one, because
`transactions.import_batch_id` deletes the rows **this batch created** rather than everything inside
a time window. The cost is real and is stated rather than buried: previewing a large file re-parses
it on each request. The mitigation is the shape of the request — the preview is one call returning
the whole decision set, not a server-paginated scan a person walks through a page at a time.

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
- `src/server/import/types.ts` — new
- `src/server/import/registry.ts` — new
- `src/server/import/csv/parse.ts` — new
- `src/server/import/csv/sniff.ts` — new
- `src/server/import/csv/__tests__/parse.test.ts` — new
- `src/server/import/csv/__tests__/sniff.test.ts` — new
- `src/server/fns/imports.ts` — new

### Data and migration

**Nothing is requisitioned.** Every table this area needs is already in `src/server/db/schema.ts`
and already migrated — `00-S9`'s row, landed in `drizzle/0001_nosy_magneto.sql`.

- `import_batches` carries `id`, `organization_id`, `source`, `status`, `file_r2_key`, `row_count`,
  `imported_count`, `skipped_count`, `duplicate_count`, `error_count`, `mapping` (the confirmed
  column map, JSON), `started_at`, `finished_at`, `reverted_at`, `created_by_user_id` and
  timestamps, indexed on `(organization_id, created_at)` for the history screen and on
  `(organization_id, status)` for the consumer's in-flight query.
- `source` is one of `IMPORT_SOURCES` under a `CHECK`. This stage writes `csv`; `19-S4` and `19-S5`
  write the next four.
- `status` is one of `IMPORT_STATUSES` under a `CHECK` — `queued`, `parsing`, `mapping`,
  `previewing`, `running`, `completed`, `failed`, `reverted`. Those are the names the constraint
  accepts, and a stage that writes `committed` or `cancelled` is writing a row D1 rejects.
- No staging table exists and none is asked for. The only thing a parse persists is
  `import_row_errors`, and `19-S2` owns that write.

### Server (repo, server function, Zod)

- **Upload.** `POST /api/imports` accepts `multipart/form-data`, cap **5 MB** and **20 000 data
  rows**, both named constants and the row cap the `IMPORT_MAX_ROWS` value `00-S12` enforces. The
  file is written to R2 under `imports/<orgId>/<batchId>/<filename>` — the key layout `00-S12`
  fixes, with the workspace id in the second segment so a tenant sweep is a prefix list. **The R2
  object is written first, the row second, and a throw between them triggers a compensating
  delete**, the same ordering `11-S3` uses for attachments and for the same reason.
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
- **The format seam.** `types.ts` declares `interface ImportParser { source, sniff, parse }` over the
  `ImportSource` ids the schema already exports, so the list of formats has exactly one home and it
  is the schema. It sits under `src/server/` and not under `src/lib/` because the interface takes a
  byte stream and returns parsed rows: it is server-only, and `src/lib/` is reachable from the client
  bundle. `registry.ts` resolves a batch's `source` to its module **by convention** —
  `src/server/import/<source>/parse.ts` — rather than through a table an author has to remember to
  edit. A format is therefore a new directory and no edit to a file another stage owns, which is what
  lets `19-S4` and `19-S5` run in this wave beside `19-S2` and `19-S3`. A `source` with no module is
  a typed failure at resolution, never a silent fallback to CSV.
- **Zod.** `uploadSchema` (accountId, file size and type), `mappingSchema` (see `19-S2`).

### UI (route, components)

None in this stage.

### Quota

`assertWithinLimit('importsPerMonth', ...)` before creating a batch, counting batches created in the
current calendar month in the workspace time zone. The number per plan is `OPEN-1`. Free-tier import
existing at all is not in question — a product whose only ingestion path is paywalled is a product
nobody evaluates.

### Tenant isolation test

In `tenant-isolation.test.ts`: A cannot read B's `import_batches`; the upload endpoint refuses an
`accountId` from B with a not-found, not a forbidden (which would confirm the id exists); and the R2
key is built from the **scope's** workspace id, never from the request body, with an assertion that a
forged `organizationId` in the payload cannot move the object.

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
  transitions rejecting an illegal move (`completed → mapping` throws); `registry.ts` resolving
  `csv` and failing a `source` whose module is absent.
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

- `src/server/import/map.ts` — new
- `src/server/import/dedupe.ts` — new
- `src/server/import/__tests__/dedupe.test.ts` — new
- `src/routes/_app/import/index.tsx` — new
- `src/routes/_app/import/$batchId.tsx` — new
- `src/routes/_app/import/-ui/mapping-step.tsx` — new
- `src/routes/_app/import/-ui/preview-step.tsx` — new
- `e2e/import.spec.ts` — new

### Data and migration

**Nothing is requisitioned.** `import_mapping_presets` already exists in `schema.ts` and is already
migrated: `id`, `organization_id`, `fingerprint` (a hash of the normalised header row), `mapping`
JSON, `label`, `last_used_at` and timestamps, unique on `(organization_id, fingerprint)` and indexed
on `(organization_id, last_used_at)`. The ceiling of **20 presets per workspace** is a repository
invariant rather than a `CHECK`, because it is a product number and a `CHECK` is a migration
(`00-S9`). On upload, a preset whose `fingerprint` matches the file's headers is **offered**,
pre-filling the mapping — it is never applied silently, because a bank that reorders its columns
would otherwise import everything into the wrong fields.

The preview persists no parsed row. What it persists is `import_row_errors`: one row per rejected
line, with `row_index`, `code`, an i18n-keyed `message` and the truncated `raw` source text. `raw` is
the file's own text, comma decimal separator and all, and no repository reads it back as an amount.

### Server (repo, server function, Zod)

- **`mappingSchema`.** `date` (required, plus a `dateFormat` from an enum of named patterns —
  `YYYY-MM-DD`, `DD/MM/YYYY`, `MM/DD/YYYY`, `DD.MM.YYYY`, and an explicit "ambiguous" rejection when
  the sample cannot distinguish DMY from MDY), `amount` (required, in one of two shapes: a single
  signed column, or a debit column plus a credit column), `decimalSeparator`, `thousandsSeparator`,
  `accountingNegatives`, and optional `description`, `payee`, `category`, `reference`, `notes`,
  `currency`. It is stored on `import_batches.mapping` once confirmed, and it is the second half of
  what the preview and the commit both parse from.
- **The DMY/MDY rejection is the point.** If every sampled day is ≤ 12, the mapping step **requires an
  explicit choice** rather than defaulting. Defaulting here silently misdates up to 12/31 of a
  person's rows and nobody notices for months.
- **Dedupe.** `dedupe.ts` scores an incoming row against existing transactions in the target
  account within ±3 days: exact match on (`booked_on`, `amount_minor`, normalised description) is a
  **certain** duplicate; a match on (`booked_on`, `amount_minor`) alone is a **probable** one. Certain
  duplicates default to `skip_duplicate`; probable ones default to `create` **and are flagged**, on
  the principle that a missing transaction is more discoverable than a silently dropped one. It also
  dedupes **within the file**, because banks re-export overlapping ranges. The rule is the same for
  every format: a parser hands it normalised rows, never format-specific fields.
- **Preview.** `previewBatch` re-reads the batch's object from R2, parses it with the confirmed
  mapping through the parser `registry.ts` resolved, scores every row, and returns the whole decision
  set in one response — the counts, the per-row decision and the errors. It persists only the
  rejected rows, replacing that batch's previous `import_row_errors` in one D1 batch (delete-range
  then insert) so a re-preview after a mapping change is idempotent, the same pattern `09-S1` uses.
  The commit re-runs this same parse over the same bytes, which is why the preview cannot promise a
  number the commit does not write.

### UI (route, components)

- **Route.** `/import` — the entry surface, carrying the two provenance groups of the brief and the
  import history beside them as a peer surface — and `/import/$batchId`, the stepper.
- **Components.** `mapping-step.tsx` — a table whose columns are the file's headers, each with a
  field `Select`, showing three sample values per column so the choice is grounded in the data;
  `preview-step.tsx` — the parsed rows in the `data-table` (`00-S8`) with a decision control per row,
  a filter by decision, and a header summary ("312 to create · 18 duplicates skipped · 4 invalid").
  The upload control's accepted extensions are read from the parser registry rather than written out
  as a literal list, so a format landing in `19-S4` or `19-S5` needs no edit to this file. The
  stepper names all four steps — upload, map, review, done — and shows them from the first screen, so
  the length of the flow is known before it is entered; the fourth is `19-S3`'s commit step rendered
  in this same stepper rather than on a surface of its own.
- **States.** Uploading; sniffing; **needs mapping**; **needs a disambiguation** (the DMY/MDY case,
  rendered as a blocking inline question, not a toast); previewing; **preview ready**; **all rows
  invalid** (a designed dead-end with the first three errors quoted and a "start over" action);
  running; completed; failed; reverted.
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
byte-identical transactions and confirming A's rows are **not** marked duplicate;
`import_mapping_presets` are not visible across workspaces; A cannot read B's `import_row_errors`;
and `$batchId` from B renders a not-found.

### Money invariant

_The preview's numbers are the numbers that will be written._ Cases in `money-invariants.test.ts` and
`dedupe.test.ts`:

- _every previewed row's `amount_minor` is the integer the commit inserts_, asserted by previewing a
  full batch, committing it, and comparing the preview response row for row against the created
  transactions. One parse path run twice over the same bytes is the mechanism; this test is what
  says the mechanism holds.
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
- `dedupe.test.ts`: certain vs probable; the ±3-day window's edges; within-file duplicates; a
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

**Nothing is requisitioned.** `transactions.import_batch_id` already exists in `schema.ts` —
nullable, referencing `import_batches.id`, indexed on `(organization_id, import_batch_id)` — and is
already migrated. That column is what makes undo exact: it deletes **the transactions this batch
created and no others**, identified by the column rather than by a time window or a heuristic. The
same column is the commit's resume cursor, which is the second reason no staging table is needed.
`import_batches.reverted_at` and the terminal `reverted` status record that an undo happened, and
the batch row survives so the history says so.

### Server (repo, server function, Zod)

- **Commit** is a queue job (`00-S12`'s envelope, kind `import.execute`), not a request: 20 000 rows
  do not fit in a request's CPU budget. It re-parses the batch's stored object with the confirmed
  mapping — the same parse the preview ran — and inserts the rows whose decision is `create` in
  chunks of **100**, writing through `07-S1`'s `createTransaction` so **every policy, every quota
  check and every ledger notification applies** — an import that bypassed the write path would produce
  transactions the balance rebuild has never heard of.
- **Idempotency.** The parse is deterministic and ordered by row index, so the count of transactions
  already carrying this `import_batch_id` is the resume cursor: a chunk skips what the batch has
  already created. `import_batches.imported_count` is written in the same D1 batch as the chunk's
  inserts, so the number a person is shown and the number the job resumes from are one number. A
  retried message re-reads it and re-does nothing, so at-least-once delivery cannot double-post. The
  DLQ path marks the batch `failed` with `imported_count` preserved, and a resume continues from
  there rather than restarting.
- **Ledger.** The whole commit runs inside `runWithLedgerBatch` (`09-S2`) so the balance rebuild is
  coalesced into one pass per account instead of 20 000.
- **Undo.** `undoImport(batchId)` runs as the `import.revert` envelope, deletes those transactions in
  chunks through the same write path (so the ledger and budgets react), then stamps `reverted_at` and
  sets the batch to `reverted`. It is available for **30 days** and refuses once any created
  transaction has been **edited** — silently reverting someone's later work is worse than refusing,
  and the refusal names the offending rows.

### UI (route, components)

- **Components.** `commit-step.tsx` — a progress region driven by polling the batch (not a websocket;
  BND-14), showing created/skipped counts and a per-chunk status; `history-list.tsx` — batches with
  filename, date, outcome, and Undo where eligible.
- **States.** Queued; running (with a real progress figure, never an indeterminate spinner for a
  known-length job); completed; **partially succeeded** — `failed` with a non-zero `imported_count`,
  the count stated and a resume offered; failed with nothing landed; reverted; **undo refused** (with
  the reason and the edited rows listed).
- **Accessibility.** Progress is a `progressbar` with `aria-valuenow`, and the completion is announced
  once in a polite live region — not on every poll tick, which would flood a screen reader. Undo is
  an `AlertDialog` naming the exact count to be removed.

### Quota

`assertWithinLimit('transactions', ...)` is enforced **per chunk** inside the write path. Hitting the
ceiling mid-import stops the job cleanly, leaves the batch `failed` with `imported_count` recording
exactly how many rows landed, and reports how many remain — it does not roll back what succeeded,
because a partial import a person can see is more useful than an invisible failure. There is no
`partially_committed` status and none is requisitioned: the shipped enum has eight values, and the
partial case is `failed` with a non-zero `imported_count`, which is what the history list reads.

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
- _a batch's `imported_count` equals the number of transactions carrying its `import_batch_id`_, so a
  person can trust the number they are shown when deciding whether to resume.

### Verification

- Command gate.
- `import-commit.test.ts`: chunking; idempotent redelivery; DLQ on a poisoned chunk; resume from the
  preserved `imported_count`; the quota stop; undo including the refusal-on-edit path.
- `e2e/import.spec.ts` extended: commit the fixture from `19-S2`, assert the transaction list contains
  the rows, undo, and assert the balance returned to its starting value.
- Browser evidence at the pinned clock: the **commit step running**, **completed**, **partially
  succeeded**, and the **history list with an Undo dialog open**, both themes, 360 / 1280 / 2560 px.
- axe on the commit step and the history list: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 19-S4 — The OFX and QIF parsers

### Stage id

`19-S4` · Wave 4 · effort **L**. The stage that keeps a promise the ADR made to us, not one a
comparison forces — see the area brief and `docs/agents/parity.md` gap 2 before deciding it is
unmotivated.

### Reference rows

`IMP-08 missing → done` — the OFX 1.x SGML and 2.x XML parser, `STMTTRN` records only.
`IMP-09 missing → done` — the QIF parser, the `!Type:Bank` / `!Type:CCard` subset.

### Owned paths

- `src/server/import/ofx/parse.ts` — new
- `src/server/import/ofx/tokenise.ts` — new
- `src/server/import/ofx/__tests__/parse.test.ts` — new
- `src/server/import/qif/parse.ts` — new
- `src/server/import/qif/__tests__/parse.test.ts` — new

### Data and migration

**Nothing is requisitioned and nothing is added.** `IMPORT_SOURCES` already carries `ofx` and `qif`
under the `import_batches_source_check` constraint, so this stage writes values the database has
accepted since `drizzle/0001_nosy_magneto.sql`. Rejected rows land in `import_row_errors` exactly as
CSV's do, and the `row_index` is the record's ordinal in the file — the `STMTTRN` for OFX, the
`^`-terminated entry for QIF — so the error a person reads points at something they can find.

### Server (repo, server function, Zod)

- **The seam, used as designed.** Each parser is `src/server/import/<source>/parse.ts` and implements
  `ImportParser` from `19-S1`'s `src/server/import/types.ts`. `registry.ts` finds them by convention, so this
  stage adds two directories and edits no file `19-S1`, `19-S2` or `19-S3` owns. Both parsers return
  the same normalised rows the CSV parser returns, which is what lets the mapping, the dedupe scorer,
  the preview and the commit stay exactly as they are.
- **The governing rule, and it is the reason these are hand-rolled.** _Every row either parses or
  produces an `import_row_errors` entry naming the row index_ — never a thrown parse that loses the
  batch (BND-30). A record with an unreadable date, an unreadable amount or a missing required tag is
  one error row and the file keeps going. Only a header the parser cannot classify at all — an OFX
  file with no `STMTTRN` anywhere, a QIF whose `!Type:` is outside the supported subset — rejects the
  whole file, and it does so with a named code rather than an exception.
- **OFX.** `tokenise.ts` reads both dialects into one tag stream: 2.x is XML, and 1.x is SGML whose
  tags are routinely unclosed, so the tokeniser closes a tag when the next one at the same depth
  opens rather than demanding well-formedness. `parse.ts` reads `STMTTRN` records only — `DTPOSTED`,
  `TRNAMT`, `TRNTYPE`, `NAME`, `MEMO`, `FITID` — and ignores `INVSTMTMSGSRSV1` and `LEDGERBAL`
  entirely: no investment statements and no balance reconciliation, which is scope BND-30 fixed
  deliberately and this stage does not widen. `DTPOSTED` is `YYYYMMDD` with an optional time and an
  optional bracketed offset; only the date survives, because `booked_on` is a calendar date. `FITID`
  is carried into the row's `reference` field; duplicate detection stays the one rule `19-S2` owns,
  scored on date, amount and description for every format alike.
- **QIF.** Line-per-field records terminated by `^`, in the `!Type:Bank` and `!Type:CCard` subset:
  `D` date, `T` amount, `P` payee, `M` memo, `N` reference, `L` category. `!Type:Invst`, `!Account`
  blocks and `!Type:Cat` lists are skipped with a stated count rather than parsed, and a `S`/`E`/`$`
  split triplet is one error row naming the record — a split imported as a flat sum is a wrong
  number, and plan `11` owns splits. QIF dates are the format's known ambiguity: `D` may be
  `M/D/YY`, `D/M/YYYY` or `YYYY-MM-DD`, and the same explicit-choice rule `19-S2` applies to CSV
  applies here — an ambiguous sample requires the person to choose and is never guessed.
- **Zod.** No new input schema. The upload path is `19-S1`'s and the mapping is `19-S2`'s; an OFX or
  QIF file carries its own field names, so the mapping step confirms the date and amount conventions
  and nothing else.

### UI (route, components)

None. Both formats render through `/import/$batchId`, which `19-S2` owns and which reads its accepted
extensions from the registry, so this stage adds a format without touching a route file.

### Quota

No countable row of its own: the batch consumed `importsPerMonth` at upload in `19-S1`, and the
transactions consume `transactions` at commit in `19-S3`. A parser writes nothing but error rows,
which are bounded by the row cap the upload already enforced.

### Tenant isolation test

The parsers hold no `TenantScope` because they touch no repository — they are pure functions over
bytes, and that is the isolation property to assert rather than assume. In `tenant-isolation.test.ts`:
previewing an `ofx` and a `qif` batch belonging to B from A's scope is a `NotFoundError` raised by
`19-S1`'s batch read **before any parse runs**, and the error rows written for A's batch carry A's
`organization_id` with B's `import_row_errors` untouched.

### Money invariant

_A foreign format's amount reaches the ledger as an integer or as an error, never as a float and
never as a guess._ Cases in the two `parse.test.ts` files:

- _`TRNAMT` of `-45.00`, `-45.0` and `-45` all parse to `-4500`_ in a two-decimal currency, and
  _to `-45000` in a three-decimal one_, driven by `currencies.digits` and never by a hard-coded 2.
- _an OFX `<CURDEF>` or a `<CURRENCY>` differing from the target account's currency is an error row_
  with a named code, not a conversion — the file supplies no historical rate and inventing one is
  worse than refusing, the same rule `19-S2` holds for a CSV currency column.
- _a QIF `T` of `1.234,56` and one of `1,234.56` parse to `123456` under their stated convention_,
  and an amount whose convention is ambiguous is an error row rather than a guess.
- _a `TRNAMT` with more decimal places than the currency's `digits` is an error row_, never rounded.
- _neither parser constructs a JavaScript `number` from an amount_ — the type is `Minor`, asserted at
  the type level and at runtime with an integer check, exactly as in `19-S1`.

### Verification

- Command gate.
- `ofx/__tests__/parse.test.ts`: an OFX 1.x SGML fixture with unclosed tags and a header block; an
  OFX 2.x XML fixture; a file mixing CRLF and LF; a `STMTTRN` missing `DTPOSTED` producing one error
  row with its index and not a throw; an investment statement producing the whole-file rejection with
  its named code; a 20 000-record file stopping at the cap.
- `qif/__tests__/parse.test.ts`: `!Type:Bank` and `!Type:CCard` fixtures; a record with a multi-line
  `M` memo; a split triplet producing one error row; an unsupported `!Type:` rejecting the file by
  code; a file with no trailing `^` on the last record parsing that record rather than dropping it.
- Browser evidence at the pinned clock: the preview step of `/import/$batchId` for an OFX file and for
  a QIF file, both themes, at **360 / 1280 / 2560 px**, plus the state where **some records became
  error rows** and the error list is shown with its row indices.
- axe on the preview step for both formats: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses, ticked against the preview step this stage feeds — the
surface is `19-S2`'s, the content in it is this stage's, and evidence is taken here.

### Blockers

None. The package question is already answered: BND-30's disposition is **hand-roll**, owned by this
plan, and this stage is the writing it names.

---

## Stage 19-S5 — The two tracker migrations

### Stage id

`19-S5` · Wave 4 · effort **M**.

### Reference rows

`IMP-10 missing → done` — the YNAB register migration.
`IMP-11 missing → done` — the Wallet backup migration.

### Owned paths

- `src/server/import/ynab/parse.ts` — new
- `src/server/import/ynab/__tests__/parse.test.ts` — new
- `src/server/import/wallet/parse.ts` — new
- `src/server/import/wallet/__tests__/parse.test.ts` — new

### Data and migration

**Nothing is requisitioned and nothing is added.** `IMPORT_SOURCES` already carries `ynab` and
`wallet`, so both values pass `import_batches_source_check` today. A record that cannot be taken is
an `import_row_errors` row whose `row_index` is the record's ordinal in the file.

### Server (repo, server function, Zod)

- **Both are parsers behind the same seam**, `src/server/import/<source>/parse.ts`, resolved by
  `19-S1`'s registry and returning the same normalised rows. A migration is a format, not a second
  pipeline: it maps, previews, dedupes, commits and reverts through the code the first four stages
  already built.
- **YNAB.** A register export is delimited, so this parser reads it **through `19-S1`'s CSV reader**
  rather than writing a second one, and adds only what the layout needs: the outflow and credit
  columns are a debit/credit pair, `Payee` and `Memo` are the description sources, and the category
  arrives as one `"Group: Category"` string that is split on the last colon into a group and a leaf.
  A `Cleared` flag maps to the transaction's cleared state and nothing else.
- **Wallet.** A backup is JSON: an array of records carrying an account name, a category name, a
  payee, a date, a currency and an amount. Names, not ids, are the join — the export's ids mean
  nothing in this workspace — so each record resolves its account and category **by name within the
  scope**, and an unresolved name is an error row. A file never creates an account or a category as
  a side effect: the preview exists precisely so that nothing is written before a person has seen
  what will be, and silently minting six accounts from a file is the sharpest version of the thing
  that rule forbids.
- **Neither migration invents a transfer.** A record that names a counter-account is imported as an
  ordinary transaction on its own account with the counter-account's name kept in the description.
  Plan `10` owns the two-leg model and its four ref-amount cases, and a parser guessing at pairs
  would produce legs that plan has never seen.
- **Zod.** No new input schema. `wallet/parse.ts` validates the backup's record shape with a
  `z.strictObject()` per record and reports a shape failure as that record's error row, so a
  malformed record costs one row rather than the file.

### UI (route, components)

None. Both formats render through `/import/$batchId`, whose accepted extensions come from the
registry, so this stage adds two formats without touching a route file.

### Quota

No countable row of its own, for the same reason as `19-S4`: `importsPerMonth` was consumed at upload
and `transactions` is consumed per chunk at commit.

### Tenant isolation test

In `tenant-isolation.test.ts`: a Wallet backup naming an account that exists **only in B** resolves
nothing in A's scope and produces an error row rather than a cross-tenant match — the name lookup is
built on `tenantFilter()` like every other read, and this is the case that proves it; and previewing
a `ynab` or `wallet` batch of B's from A is a `NotFoundError` before any parse runs.

### Money invariant

_A migrated amount is the integer the source file wrote, and no float appears between the two._
Cases in the two `parse.test.ts` files:

- _a YNAB outflow/inflow pair produces one signed integer_, and both columns populated on one record
  is an error row rather than a sum — the same rule `19-S2` holds for a mapped debit/credit pair.
- _a Wallet amount never passes through `JSON.parse`._ The parser walks the records array and takes
  each amount as its **source text**, converting to minor units by `currencies.digits`. `JSON.parse`
  would make every amount an IEEE-754 double before anything could object, and `docs/MONEY.md`
  forbids a float touching an amount at any layer — an invariant that held only because a particular
  rounding happened to come out right would not be an invariant.
- _a Wallet record whose currency is not the target account's is an error row_, with the same named
  code and the same reason as `19-S4`: the file supplies no historical rate.
- _a zero-decimal currency's `1200` migrates to `1200`_, not `120000`, from either format.
- _neither parser returns a JavaScript `number` for an amount_ — `Minor`, asserted at the type level
  and with a runtime integer check.

### Verification

- Command gate.
- `ynab/__tests__/parse.test.ts`: a register fixture with the outflow/inflow pair, a `"Group:
Category"` string containing a colon inside the leaf name, an empty amount pair producing an error
  row, and a re-export overlapping a previous one so `19-S2`'s dedupe marks the overlap.
- `wallet/__tests__/parse.test.ts`: a backup fixture with two accounts and three currencies; a record
  naming an unknown account producing an error row with its index; a record whose amount is a JSON
  number read from source text; a truncated file rejected whole with a named code.
- Browser evidence at the pinned clock: the preview step of `/import/$batchId` for a YNAB register
  and for a Wallet backup, both themes, at **360 / 1280 / 2560 px**, plus the state where **records
  failed to resolve an account** and the error list names them.
- axe on the preview step for both formats: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses, ticked against the preview step this stage feeds — the
surface is `19-S2`'s and the evidence is taken here.

### Blockers

None.
