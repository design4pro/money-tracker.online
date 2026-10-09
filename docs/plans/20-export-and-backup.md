# 20 — Export and backup

## Area brief

Two obligations, one machine:

- **Export** — a person can take their entire workspace out, in an open format, without asking anyone.
  This is a product commitment (`PRODUCT.md`) and a legal one (GDPR portability,
  `docs/SECURITY.md` §8). An export that requires support intervention is not portability.
- **Backup** — a nightly, automated, restorable copy of every workspace, so a bad migration or a
  D1 incident is recoverable rather than terminal.

They share the writer, the R2 layout and the retention machinery, which is why they are one plan.
They differ in who triggers them and who can read them: an export belongs to the workspace and is
downloadable by its members; a backup belongs to the operator and is **never** exposed on a
workspace-facing route.

Formats: **CSV per entity inside a ZIP** and **a single JSON document**. CSV because spreadsheets are
where this data goes next; JSON because it is the only one of the two that round-trips structure
losslessly. No XLSX (BND-12).

`20-S1` is the writer, `20-S2` is the workspace-facing export, `20-S3` is the operator-facing backup
and restore drill.

---

## Stage 20-S1 — The serialiser and the archive writer

### Stage id

`20-S1` · Wave 4 · effort **L**.

### Reference rows

`EXP-01 missing → done` — the entity serialisers and the stable export schema.
`EXP-02 missing → done` — the streaming ZIP writer and the R2 object layout.

### Owned paths

- `src/server/export/schema.ts` — new
- `src/server/export/serialize.ts` — new
- `src/server/export/zip.ts` — new
- `src/server/export/__tests__/serialize.test.ts` — new
- `src/server/export/__tests__/zip.test.ts` — new

### Data and migration

None in this stage; the job rows arrive in `20-S2`.

### Server (repo, server function, Zod)

- **`schema.ts` declares the export format and its version.** `EXPORT_FORMAT_VERSION = 1`, a Zod
  schema per entity, and a manifest schema (`{ formatVersion, generatedAt, workspaceId,
baseCurrency, counts, entities[] }`). The schema is the contract: a consumer reads the manifest,
  learns the version, and knows what the files contain. **Changing an entity's shape bumps the
  version**, and `serialize.test.ts` fails if a field is added or removed without the bump — a
  snapshot test on the schema's shape, which is the cheapest way to make a format promise enforceable.
- **Entities exported.** accounts, account groups, categories, tags, payees, transactions, splits,
  transfers (as the shared `transfer_id` on the two rows, not a separate file), budgets and budget
  periods, recurring series and periods, rules, goals and contributions, attachments **metadata**
  (with the R2 key, not the bytes, in v1 — a 2 GB export is not a download), currencies used, and
  workspace settings. Auth rows, sessions, billing identifiers and audit rows are **not** exported.
- **`serialize.ts`** streams rows through keyset pagination (`DEFAULT_PAGE_SIZE`) and yields records;
  it never materialises a whole table. Every serialiser is a pure function from a row to a record so
  it is testable without a database.
- **`zip.ts`** writes a **store-only (method 0) ZIP** built by hand — no compression, no dependency.
  Store-only is the deliberate choice: it streams in constant memory in workerd, it is universally
  readable, and the CPU we would spend deflating is CPU a Worker does not have. The size cost is
  named in a comment and accepted. The writer emits local headers, the central directory and the EOCD
  with correct CRC-32s, and `zip.test.ts` asserts a produced archive opens in Node's `zlib`-free
  reader and that a 100 MB stream never exceeds a bounded buffer.
- **R2 layout** (`00-S12` owns the key module, `src/server/files/keys.ts`): `exports/<orgId>/<jobId>.<zip|json>`
  for exports and `backups/<orgId>/<yyyy-mm-dd>.json` for backups. Different prefixes, different
  lifecycle rules, no chance of a workspace-facing signed URL reaching a backup.

### UI (route, components)

None.

### Quota

No countable row in this stage.

### Tenant isolation test

In `tenant-isolation.test.ts`: every serialiser is driven by a `TenantScope` and a fixture with two
populated workspaces; the produced manifest's `counts` match workspace A exactly and the record
stream contains **no** id belonging to B. The test walks every entity, so adding an entity without
scoping it fails the test rather than shipping.

### Money invariant

_An export states amounts as integers plus a currency code, and a round trip changes nothing._ Cases
in `serialize.test.ts`:

- _JSON records carry `amountMinor` as an integer and `currency` as the ISO code_ — never a decimal
  string, never a float. JSON numbers are IEEE-754, and an integer minor unit is exactly
  representable while `12.34` is not; this is the reason the format is what it is, stated in the file.
- _CSV records carry a decimal string with exactly `currencies.digits` places, a `.` separator, and
  the currency in its own column_, matching `17-S3`'s `formatAmountForCsv` — one formatter, two
  callers.
- _`ref_amount_minor` and the `rate_e10` that produced it are both exported_, so a consumer can verify
  the conversion rather than trust it, and a re-import can preserve history.
- _a zero-decimal currency exports `1200` in JSON and `1200` in CSV_, with no `.00`.
- _serialising and re-parsing every fixture record through its Zod schema yields a deep-equal
  object_ — the round-trip property, run over every entity.
- _CSV fields beginning `=`, `+`, `-` or `@` are prefixed with `'`_, the same injection guard as
  `17-S3`.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `serialize.test.ts`: the six money cases; the schema-shape snapshot guarding the version bump; the
  full-entity isolation walk.
- `zip.test.ts`: a produced archive's central directory and CRCs verified against a known-good
  reader; an entry with a UTF-8 name (Polish diacritics in a filename); the bounded-memory assertion;
  an empty archive (a workspace with no data still produces a valid ZIP with a manifest).
- No browser evidence.

### Definition of done

All seven §7 items; §2's visual clauses are carried by `20-S2`, stated explicitly.

### Blockers

None.

---

## Stage 20-S2 — Workspace export: request, generate, download, expire

### Stage id

`20-S2` · Wave 4 · effort **L**.

### Reference rows

`EXP-03 missing → done` — the export job store and the queue handler.
`EXP-04 missing → done` — `/settings/data` with request, progress and download.
`EXP-05 missing → done` — signed, expiring download links and the nightly prune.

### Owned paths

- `src/server/repos/exports.ts` — new
- `src/server/repos/__tests__/exports.test.ts` — new
- `src/server/queue/handlers/export-generate.ts` — new
- `src/server/queue/handlers/__tests__/export-generate.test.ts` — new
- `src/routes/_app/settings/data.tsx` — new
- `src/routes/api/exports.$jobId.download.ts` — new
- `e2e/export.spec.ts` — new

### Data and migration

Requisitions `export_jobs` into `00-S9`: `id`, `workspace_id`, `requested_by`, `format`
(`csv_zip|json`), `status` (`queued|running|ready|failed|expired`), `r2_key`, `byte_size`,
`row_counts_json`, `error_code`, `created_at`, `ready_at`, `expires_at`, indexed on
`(workspace_id, created_at desc)`.

`expires_at` is `ready_at + 7 days`. The nightly cron's export-prune step (`0 3 * * *`, `00-S2`)
deletes the R2 object and marks the row `expired`. **The row survives the object** so the history
shows that an export happened — an audit trail of who took the data out is worth more than the bytes.

### Server (repo, server function, Zod)

- `createExportsRepository(scope)` — `list`, `get`, `request`, and `markExpired` (operator path).
- `requestExport({ format })` enqueues `export.build`. **One in-flight job per workspace**: a
  second request while one is `queued` or `running` returns the existing job rather than starting a
  duplicate, enforced with a conditional insert, not a read-then-write.
- The handler streams `serialize` into `zip` (or into a JSON writer) and multipart-uploads to R2,
  then flips the row to `ready` in one update. A failure sets `failed` with a code and **deletes any
  partial object** — a half-written export offered as a download is a support ticket that costs more
  than the failure.
- **The export row cap is unenforced and unpromised.** `EXPORT_MAX_ROWS` (250 000 in `wrangler.jsonc`,
  both environments) is read by no code; `20-S2` adopts it or replaces it, and until then nothing
  promises it.
- **Download.** `/api/exports/$jobId/download` re-checks the session, the membership and the job's
  workspace on every request, then streams from R2 with
  `Content-Disposition: attachment; filename*=UTF-8''...`. There is **no public signed URL** — the
  Worker is the only reader, so a leaked link outside a session is worthless. The route is the same
  shape as `11-S3`'s `/api/files/$id` and shares its header hardening (`X-Content-Type-Options:
nosniff`).

### UI (route, components)

- **Route.** `/settings/data`.
- **Components.** A format `RadioGroup` with a plain-language description of each; a request button; a
  job list with status, size, row counts and a download link; and a **What's included** disclosure
  listing the entities and, honestly, the exclusions (attachments' bytes, auth rows, billing).
- **States.** No exports yet; queued; running; ready (with size and counts); failed (with a retry);
  expired (with the date it expired and a "request a new one" action); **in-flight duplicate** (the
  button is disabled with the reason stated — "An export is already being prepared").
- **Accessibility.** Status changes are announced once per transition in a polite live region, driven
  by polling, not on every tick. The download is a real link. The disclosure is a native
  `<details>`-shaped React Aria component so it works before hydration.

### Quota

`assertWithinLimit('exportsPerMonth', ...)` in `request`, counting jobs created this calendar month.
Generating a full copy of a database is the most expensive thing a free workspace can ask for, so a
ceiling exists on every plan; the numbers are `OPEN-1`. The **legal** portability obligation is met at
any ceiling above zero, and the free tier's ceiling is therefore never zero — that constraint is
written next to the constant so a future tuning pass cannot quietly remove it.

### Tenant isolation test

In `tenant-isolation.test.ts`: A cannot list, get or download B's jobs; `$jobId` from B returns
not-found from the download route **before** any R2 read is attempted (asserted by a spy on the
binding, so the object is not even touched); and the R2 key is derived from the job row's workspace
id after the scope check, never from the URL.

### Money invariant

_The export contains every transaction the workspace can see, and the same integers._ Cases in
`money-invariants.test.ts`:

- _the manifest's `counts.transactions` equals the scoped repository's count_, so a truncated export
  is a failed test rather than a silent gap.
- _the sum of exported `amountMinor` per account equals the account's balance-affecting sum in the
  ledger_, computed independently, for a fixture with multi-currency, splits, transfers and refunds.
- _both legs of every transfer are present with their shared `transfer_id`_, and an export containing
  one leg fails the test.
- _split children are exported with their parent's id and their amounts sum to the parent_, the same
  invariant `11-S1` enforces on write, re-asserted on the way out.
- _the export's `baseCurrency` matches the workspace's_, and every `refAmountMinor` in the file is in
  that currency.

### Verification

- Command gate.
- `exports.test.ts`: the one-in-flight conditional insert under a concurrent double request; the
  quota rejection; the expiry transition; the partial-object cleanup on failure.
- `export-generate.test.ts`: a job over a 10 000-transaction fixture completing within the CPU budget
  in chunks; a retried message not producing a second object; the DLQ path setting `failed`.
- `e2e/export.spec.ts`: request a JSON export, poll to ready, download it, parse it, and assert the
  transaction count matches the list view's count for the same seed — the end-to-end version of the
  first money case.
- Browser evidence at the pinned clock: `/settings/data` in both themes at **360 / 1280 / 2560 px**,
  plus **queued**, **ready with a download link**, **failed**, **expired**, and the **disclosure
  open**.
- axe on `/settings/data`: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

`OPEN-1` — exports per month per plan. Ship with `plans.ts` values and the never-zero constraint
recorded beside them.

---

## Stage 20-S3 — Nightly backup and the restore drill

### Stage id

`20-S3` · Wave 4 · effort **M**. Operator-facing; nothing here is reachable from a workspace route.

### Reference rows

`EXP-06 missing → done` — the nightly backup step and its retention.
`EXP-07 missing → done` — the restore script and the documented drill.

### Owned paths

- `src/server/cron/backup.ts` — new
- `src/server/cron/__tests__/backup.test.ts` — new
- `scripts/restore-workspace.ts` — new
- `docs/RESTORE.md` — new

### Data and migration

Requisitions `backup_runs` into `00-S14` (the console schema): `id`, `ran_on`, `workspace_count`,
`byte_size`, `status`, `error_json`, `started_at`, `finished_at`. This is platform data, not tenant
data, and it lives with the other console tables so `tenantFilter` is not misapplied to it.

### Server (repo, server function, Zod)

- **The backup step** runs inside the nightly cron (`0 3 * * *`) after the FX refresh and the
  revaluation sweep, in that order, because a backup taken before revaluation would capture a state
  the morning would immediately change. It iterates workspaces in pages, reuses `20-S1`'s serialiser
  at `format: 'json'`, and writes `backups/<orgId>/<yyyy-mm-dd>.json`.
- **Bounded work.** The cron has a CPU budget; the step processes workspaces until a **time budget**
  (a named constant, well under the limit) is exhausted, records the cursor in `backup_runs`, and
  enqueues a continuation message. A backup that silently covers only the first 200 workspaces is the
  failure mode this guards against, and `backup.test.ts` asserts the continuation covers the
  remainder. The continuation message is the `backup.run` kind of `00-S12` with a `cursor`, enqueued with
  a delay of at least `CLAIM_RETRY_DELAY_SECONDS`, the delay of `00-S12`'s KV claim.
- **Retention.** Daily backups for 30 days, then the weekly prune keeps one per week for 12 weeks.
  Both numbers are constants in one file and are quoted in `docs/RESTORE.md`. Pruning `backups/<orgId>/`
  and the offboarding sweep of a workspace's prefixes are this plan's, not `00-S12`'s; the layout makes
  each one a prefix list.
- **Restore.** `scripts/restore-workspace.ts` reads one backup object and writes it into a **named
  target workspace** through the same Zod schemas, in dependency order, remapping ids. It runs against
  staging by default and requires an explicit `--env production --confirm <workspaceId>` to touch
  production. It is **additive into an empty workspace** and refuses a non-empty target rather than
  merging — merge semantics for a restore is a research project, and refusing is the honest v1.

### UI (route, components)

None. The console (plan 24) may later surface `backup_runs`; this stage does not build a screen, and
saying so is better than a half-built one.

### Quota

None. Backups are operator-funded and not plan-limited.

### Tenant isolation test

The inverse assertion, and it is the important one: _the backup path is the one place that iterates
across workspaces_, and it does so through an explicitly named `platformScope` helper rather than by
bypassing `tenantFilter`. `tenant-isolation.test.ts` asserts that `backup.ts` is on the **allow-list**
of files permitted to call it (alongside `src/server/catalog`), and that no other file gained that
call — the same lint-shaped guard `04-S2` established, extended by one entry.

### Money invariant

_A restored workspace is arithmetically identical to the one that was backed up._ Cases in
`backup.test.ts`:

- _restore then re-serialise yields a deep-equal manifest_ (ignoring ids and timestamps) for a fixture
  with multi-currency transactions, splits, transfers, refunds, budgets with rollover and goals.
- _every account's balance after restore equals its balance before backup_, recomputed by the ledger
  rebuild rather than copied — this proves the restore produced real rows, not a snapshot of
  derived numbers.
- _`ref_amount_minor` values survive the round trip unchanged_, and are **not** recomputed at restore
  time at today's rate, which would silently rewrite history during a recovery.
- _a partially written backup object fails schema validation and is refused by the restore script_
  before any write, with the failing entity named.

### Verification

- Command gate.
- `backup.test.ts`: the four money cases; the time-budget cursor and continuation; the retention
  calculation across a month boundary; the refusal on a non-empty target.
- **A real drill, recorded in `docs/RESTORE.md`:** back up a seeded staging workspace, restore it into
  a fresh one, and paste the compared balance table and the elapsed time into the doc. A restore
  procedure that has never been executed is a document, not a capability, and the drill is the
  acceptance criterion.
- No browser evidence; this stage renders nothing and the DoD records that.

### Definition of done

All seven §7 items. The §2 visual clauses do not apply and the DoD says so with the reason, rather than
ticking boxes for a screen that does not exist.

### Blockers

`OPEN-8` — the retention numbers and the backup's residency interact with the DPA and sub-processor
statement. The engineering defaults (30 daily / 12 weekly, same-region R2) are implementable now; the
published commitment is blocked on `OPEN-8` and `docs/RESTORE.md` marks the numbers as
"engineering defaults, pending the published policy".
