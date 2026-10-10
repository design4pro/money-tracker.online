# money-tracker.online — Architecture

The runtime shape of the system: what runs where, what talks to what, and which of those edges are
contracts rather than conveniences. `docs/SPEC.md` §5 summarises this document; where they differ,
this one is the detail and `SPEC.md` is the address other documents cite.

---

## 1. Shape of the system

**One Worker.** It serves the marketing site, the SSR application, every server function, the Better
Auth mount, the Polar webhook, the file and export routes — and it is also the queue consumer and
the scheduled handler. There is no second Worker, no separate API service and no edge function
sprawl.

```
                    ┌──────────────────────────────────────────────┐
   browser ────────►│  Worker  (src/server/worker.ts)               │
                    │                                              │
                    │  fetch()      SSR + server fns + API routes   │
                    │  queue()      TASKS consumer                  │
                    │  scheduled()  four cron branches              │
                    │  export       AccountLedger (Durable Object)  │
                    └───┬───────┬────────┬────────┬────────┬────────┘
                        │       │        │        │        │
                       D1      KV       KV       R2      Queue
                      (DB)   (KV)   (SESSIONS) (FILES)  (TASKS)
                        │                                  │
                        └──────── AccountLedger DO ◄────────┘
                                (lock + dirty bit only)
```

`src/server/worker.ts` is a **custom entry module**, not the framework's default server entry. That
is not a preference: only the entry module's own exports let the runtime discover the Durable Object
class, the queue consumer and the scheduled handler. It is a shared path owned by
`docs/plans/00-foundations.md`, and a stage that adds a DO class, a queue kind or a cron branch files
the requirement there rather than editing it.

---

## 2. Request lifecycle

### 2.1 A page request

1. `fetch()` receives the request. Sentry's Cloudflare wrapper is the outermost layer; the release is
   read from `CF_VERSION_METADATA`.
2. The router matches. `api/*` routes are handled directly; everything else enters the Start handler.
3. For an application route, the `_app` layout's `beforeLoad` runs `loadShell()`: it resolves the
   session from Better Auth (which reads KV `SESSIONS`), resolves or provisions the workspace, reads
   the membership row for the workspace role, and returns a shell object into router context. A null
   result redirects to `/login?redirect=…`.
   **`beforeLoad` is UX. It is never a data boundary** — every server function re-authorises.
4. Route loaders call server functions. Server functions validate input with Zod, build a
   `TenantScope`, and call repositories.
5. Repositories are the only place SQL exists. Every query is composed from `tenantFilter()`.
6. The response streams. The document shell (`lang`, `dir`, title, meta) is owned by the root route.

### 2.2 A server function

```
createServerFn({ method: 'POST' })
  .validator(zodSchema)          // shape only, never permission
  .handler(async ({ data }) => {
    return runWithLedgerBatch(async () => {
      const scope = createScope(db, await requireOrg())   // re-reads the role from `member`
      await assertWithinLimit(scope, 'transactions', 1)   // quota, inside the boundary
      return txRepo.create(scope, data)                   // second parse happens here
    })
  })
```

Four properties of that shape are load-bearing:

- **`requireOrg()` re-reads the workspace role from the membership row.** A session claim is not
  trusted, because a role change must take effect on the next request and not on the next sign-in.
- **`runWithLedgerBatch` wraps the whole handler**, at the outermost boundary, so every account the
  handler touched gets exactly one rebuild enqueued afterwards — including when the handler throws,
  because the rows are already committed by then.
- **The quota is asserted inside the repository boundary, before the write**, not in the UI and not
  in the route.
- **The input is parsed twice**: once at the server-function edge for shape and once in the
  repository, because a repository is callable from a queue handler and a cron body that never saw
  the first schema.

### 2.3 A queue message

`queue()` receives a batch (max 10, 5s timeout, 4 consumers in production) and passes it to the
dispatcher, `handleTaskBatch` in `src/server/queue/dispatch.ts`, which settles each message on its own:
never `ackAll`, never `retryAll`, so one throw does not redeliver the nine messages that succeeded.
The handler for a kind is one entry of the registry in `src/server/queue/handlers/index.ts`, typed so
that a kind without an entry does not compile. A plan that owns a job kind writes one handler file and
replaces its entry; `worker.ts` and the dispatcher are not edited. For each message:

1. **Parse.** The body is parsed against the envelope union (§6). A body no handler in this deploy
   recognises is acked with a warning, because retrying it five times only fills the dead-letter queue
   with no more information than the first attempt had.
2. **Claim.** Every kind but `billing.event` takes a claim in KV, `task:claim:v1:<kind>:<orgId>:<identity>`
   (120s; §3.1), where the identity is the batch, the job or the backup day and `backup.run`, which has
   no workspace, carries the literal `platform` in the workspace position. **A held claim is a delayed
   retry, never an ack**: the message comes back after 45s, because acking a duplicate loses the job
   when the first worker crashed without releasing. The claim is released in a `finally`, by token: the value is a random per-delivery token and the key is deleted
   only while it still holds this delivery's token, so a slow worker that outlived the 120s expiry cannot
   delete a claim a second worker has since taken. A crash never runs the `finally`; the expiry is the
   safety net. A claim read or write that throws is a throw before the handler, so the handler never runs
   unguarded. `billing.event` takes none: its `billing_events` row status is its idempotency.
3. **Run.** The handler opens `runWithLedgerBatch`, does its job, and returns, or returns a permanent
   refusal (§6), or throws.
4. **Settle.** Returning acks. A permanent refusal acks and logs at `error` with ids only. A throw
   retries, with an `error` log naming the kind, the attempt and the message id; that includes a known
   kind whose handler is not installed yet, which is retried and never acked. Five retries in
   production, three in staging, then the dead-letter queue. What happens to the body there is §6.

**The claim is a concurrency guard, not the correctness mechanism.** Workers KV has no compare-and-swap,
so two deliveries can both read "free" and both write. What makes a doubled run safe is each handler's
own D1 state: the batch's `imported_count` as the resume cursor, the export job's row status. Every
retry of a held claim spends an attempt, so `max_retries` times the 45s delay must exceed the 120s expiry
in both environments; `src/server/__tests__/wrangler-config.test.ts` asserts it.

**A continuation is enqueued with a delay.** A handler that enqueues the next chunk of its own job does
so while still holding the claim, so a continuation sent with no delay is delivered into a held claim.
Enqueue it with `delaySeconds` of at least `CLAIM_RETRY_DELAY_SECONDS` (`src/server/queue/claim.ts`), or
treat a claim-held retry as normal.

Kinds in the envelope today: `billing.event`, handled, and `import.parse`, `import.execute`,
`import.revert`, `export.build` and `backup.run`, which parse but have no handler installed yet (plans 19
and 20). Planned and not in the envelope: `email`, `ledger.rebuild`, `fx.refresh`, `recurring.materialise`,
`notify.fanout`.

### 2.4 A scheduled invocation

`scheduled()` switches on `controller.cron` against **four literal constants**. A cron expression that
does not match one of them is a hard error rather than a silent no-op, because a mistyped expression
in `wrangler.jsonc` that quietly runs nothing is indistinguishable from a healthy system.

| Cron           | Job                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*/15 * * * *` | **Reminder and due sweep.** Scans for recurring series due, budgets that crossed a threshold, and tag reminders that fire. Dedupe marker written to KV **after** dispatch. |
| `7 * * * *`    | **Recurring auto-record.** Materialises `recurring_periods` whose `auto_record` is set and whose due instant has passed.                                                   |
| `0 3 * * *`    | **Nightly.** FX refresh for every pair any workspace holds; full balance-history revaluation sweep; per-workspace JSON backups to R2; expired export artefact prune.       |
| `17 4 * * 1`   | **Weekly.** Platform audit-log prune (400-day retention), provider usage roll-up, orphaned R2 object sweep (planned, not yet built).                                       |

Staging runs only `0 3 * * *`, so a staging deploy cannot fan out reminders to real inboxes.

**Why the sweep scans rather than reading a scheduled index.** A due-date index has to be maintained
by every write path that could change a due date — editing a series, skipping a period, changing a
budget's limit, importing rows that settle a period. Every one of those is a chance to forget, and a
forgotten index entry is a reminder that silently never fires. A scan over the workspace's active
series is bounded by the workspace's size, runs in well under the cron budget, and is correct by
construction. If a workspace ever grows past the scan budget, the fix is a materialised view rebuilt
by the same scan, not a hand-maintained index.

---

## 3. Binding map

| Binding               | Type                           | Holds                                                                                                               | Written by                             |
| --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `DB`                  | D1 `money-tracker-db`          | All domain tables and all Better Auth tables. `migrations_dir: drizzle`                                             | server functions, queue handlers, cron |
| `KV`                  | KV                             | Plan-state cache (60s), queue concurrency claims, FX day-cache, import-preset fingerprints, reminder dedupe markers | mutations, webhook, queue, cron        |
| `SESSIONS`            | KV                             | Better Auth secondary storage: sessions, OAuth state, rate-limit counters (60s TTL floor)                           | sign-in, refresh, sign-out             |
| `FILES`               | R2 `money-tracker-files`       | Uploaded import files, generated exports, receipt attachments, per-workspace JSON backups (§3.2)                    | upload server fn, queue handlers, cron |
| `LEDGER`              | Durable Object `AccountLedger` | **A lock and a dirty bit. No ledger data.** Addressed `idFromName(accountId)`                                       | the ledger queue handler               |
| `TASKS`               | Queue                          | Every asynchronous job                                                                                              | server functions, cron                 |
| `AI`                  | Workers AI (staging first)     | Import column-mapping assistance and statement extraction, always review-before-write                               | import queue handlers                  |
| `CF_VERSION_METADATA` | version metadata               | The Sentry release identifier                                                                                       | —                                      |

Keeping `SESSIONS` in its own namespace from `KV` means a cache purge can never sign everyone out.
That is the whole reason for the second namespace and it is worth the extra binding.

### 3.1 KV key namespaces

| Prefix                                 | TTL                      | Contents                                                |
| -------------------------------------- | ------------------------ | ------------------------------------------------------- |
| `billing:plan:v1:<org>`                | 60s                      | Resolved **plan state only**. Usage is always read live |
| `billing:polar-event:v1:<id>`          | 120s claim → 72h handled | Webhook dedupe                                          |
| `task:claim:v1:<kind>:<org>:<id>`      | 120s                     | Queue concurrency claim, released by token in `finally` |
| `fx:day:v1:<base>:<quote>:<date>`      | 36h                      | Resolved rate for a pair on a day                       |
| `import:preset:v1:<org>:<fingerprint>` | 90d                      | Header-row fingerprint → saved mapping                  |
| `remind:v1:<kind>:<entity>:<date>`     | 8d                       | Reminder dedupe, written **after** dispatch             |

Every key carries a `v1` segment. Changing a value's shape bumps the segment rather than migrating,
because a KV value with a stale shape read by new code is a class of bug that is not worth the saving.

### 3.2 R2 key layout

```
imports/<orgId>/<batchId>/<filename>               the uploaded file
attachments/<orgId>/<transactionId>/<attachmentId> receipts
exports/<orgId>/<jobId>.<zip|json>                 generated, with an `expires_at` in D1
backups/<orgId>/<yyyy-mm-dd>.json                  one workspace's backup for one day
dlq/<queue>/<messageId>.json                       dead-letter envelope: planned, nothing writes it
```

The workspace is always the second segment of a tenant family, so a sweep of one workspace is one prefix
list per family, and a reader can refuse an address that belongs to another workspace. `dlq/` is
platform-level and carries none. There is one bucket per environment, so no key carries the environment.
`src/server/files/keys.ts` builds the last three and holds the prefix helper `orgPrefix` and the guard
`assertKeyInOrg`; `importFileKey` and `attachmentKey` stay in their repositories.

**No object is ever served from a public bucket URL.** Everything goes through `/api/files/$id`,
which resolves the row in the caller's tenant scope first and streams from R2 second, supporting
`Range`. A bucket-level public URL would be a tenancy bypass with no audit trail.

---

## 4. Data access

### 4.1 The tenant-scoped repository

```ts
export interface TenantScope {
  readonly db: Database
  readonly ctx: TenantContext
}
export function createScope(db: Database, context: unknown): TenantScope // the only constructor
export function tenantFilter(
  scope: TenantScope,
  table: Table,
  ...extra: SQL[]
): SQL
export function createTenantRepository<T extends KeyedTenantTable>(
  table: T,
  entityName: string,
): TenantRepository<T>
```

- `TenantPatch<T> = Partial<Omit<T['$inferInsert'], 'organizationId' | 'id' | 'createdAt'>>` — a
  patch cannot carry a tenant id, so it cannot move a row between tenants.
- `insertMany` **stamps** `organizationId` from the scope; the payload cannot override it.
- `page()` is keyset on `desc(table.id)`. Ids are base36-epoch-prefixed, so the primary key is
  already creation-ordered and keyset pagination needs no second sort column.
  `DEFAULT_PAGE_SIZE = 25`, `MAX_PAGE_SIZE = 100`.
- `assertScopedWrite` throws when a write composes to an empty predicate list — "refusing to write to
  every transactions row" is a real message and it has earned its place.

`src/server/catalog` is a carve-out (global tables with no `organization_id`), guarded by
`requirePermission` plus a `platform_audit_log` write. `billing_events` and the insert-only
`organization_currencies` write in the workspace-creation batch (`src/server/auth/organization.ts`)
are the other two
(`docs/SPEC.md` §5.2).

### 4.2 Transaction read and write policies

Transactions carry state that changes what "all transactions" means, so the read/write layer requires
the caller to be **explicit** rather than defaulting:

- `PlannedPolicy` — `only | exclude | { visibleTo }`. A future-dated row is not a real spend.
- `BalanceAdjustmentPolicy` — adjustments count towards a balance and usually not towards a budget.
- `TransferPolicy` — both legs, one leg, or neither, depending on whether the consumer double-counts.
- `CompletenessPolicy` — whether rows with unresolved conversions may be returned at all.

A query that does not state its policies does not compile. The alternative — a default that is right
for the list screen and wrong for the budget total — is how a product ends up with two different
numbers for the same month on two different screens.

### 4.3 D1 constraints we design around

- **No interactive transactions and no advisory locks.** `db.batch()` is the atomic unit. Anything
  that needs read-modify-write serialisation across requests goes through a Durable Object.
- **A bound-parameter ceiling.** Chunk sizes are _computed_ from it rather than chosen:
  `D1_MAX_BOUND_PARAMETERS = 100`, so a 16-column notification insert chunks at 6 rows, an id filter
  chunks at 90, and an email fan-out chunks at 25. A hand-picked constant drifts when a column is
  added; a computed one does not.
- **10 GB per database, no read replicas by default.** §7 states the ceiling and the alarm.

---

## 5. The `AccountLedger` Durable Object

One instance per account, `idFromName(accountId)`.

**It holds a lock and a dirty bit, and no ledger data.** The rows live in D1.

```
rebuild(accountId):
  if running:  dirty = true; return 'coalesced'
  running = true
  do { dirty = false; await rebuildBalanceHistory({ accountId }) } while (dirty)
  running = false
  return 'rebuilt'
```

**Why it exists.** The balance-history write is _delete-range + insert_. D1 has no interactive
transactions and no advisory locks, so two concurrent rebuilds of the same account can interleave
their deletes and inserts into a hole — an account with a gap in its chart, and no error anywhere.
Serialising by account id makes that state unreachable.

**Why coalescing matters.** A 5 000-row import touches five accounts. Without coalescing that is
5 000 rebuild messages; with it, five. The dirty bit is what turns a queue storm into a constant.

The full algorithm, its grid bounds and its sparse-output rule are `docs/MONEY.md` §5. A direct write
to `account_balances` from outside `src/server/ledger` is a defect.

---

## 6. Queue envelope and retry policy

The envelope is a **flat object per kind**, one member of the union in `src/server/queue/messages.ts`.
Each is a `z.strictObject` with a `kind` literal and the fields that kind needs, and there is **no
version field and no `payload` wrapper**: a new `kind` is the versioning mechanism, and the old kind
keeps its handler for one release (`BACKWARD_COMPATIBILITY.md`, "Queue messages").

| Kind             | Fields                                |
| ---------------- | ------------------------------------- |
| `billing.event`  | `eventId`                             |
| `import.parse`   | `organizationId`, `userId`, `batchId` |
| `import.execute` | `organizationId`, `userId`, `batchId` |
| `import.revert`  | `organizationId`, `userId`, `batchId` |
| `export.build`   | `organizationId`, `userId`, `jobId`   |
| `backup.run`     | `date` (`YYYY-MM-DD`), `cursor?`      |

Every id matches `^[A-Za-z0-9_-]{1,64}$`, so an id cannot carry a slash, a space or a control character
into a KV key or an R2 key. `date` is a real calendar day. **An envelope carries ids, one date and one
pagination cursor, and never a value that is also stored in a row** (an amount, a rate, a role, a
status); `envelope.test.ts` holds this as an allow-list over the union. `backup.run` is the one kind
without `organizationId`: it is platform-level and its handler enumerates workspaces itself.

- **No batch byte cap is enforced.** `QUEUE_BATCH_BYTE_CAP` (256 000) is a planned constant that no code
  defines; the design is that a producer which would exceed it splits rather than truncates.
- Production: `max_batch_size 10`, `max_batch_timeout 5`, `max_retries 5`, `max_concurrency 4`,
  `retry_delay 10`. Staging: retries 3, concurrency 2.
- **Dead-letter queues exist before the first deploy.** A consumer configured with a DLQ that does
  not exist fails to deploy, and discovering that during an incident is the worst possible time.
- **A permanent refusal, not a permanent-error class.** A `PermanentTaskError` is not implemented and
  is not the design. A handler that must never succeed (a workspace or batch that does not match the
  envelope) returns `{ permanent: string }`; the dispatcher acks it and logs at `error` with ids only.
  The string is the handler's own label and is not logged, because a free-form reason is how a row value
  ends up in a log line.
- **The identity fields are a claim, never an authorisation.** `organizationId` and `userId` find a
  scope; a handler for a tenant kind then does all four, in this order, and each handler's
  tenant-isolation case proves each one: (1) `memberScopeFor` re-reads the role from `member` and returns
  `null` for a person who has left, which is a permanent refusal; (2) the batch or job is loaded through
  that scope, and a `NotFoundError` is a permanent refusal; (3) the loaded row's creator is the
  envelope's `userId`, because without it any current member could be named as the actor of a job they
  did not start; (4) `assertRole` for the action the kind performs, because an envelope carries no role
  and a role may have changed since the message was sent.
- **A producer must reach production after its consumer.** An older consumer does not know a new kind
  and acks the body as unhandled (step 1 of §2.3), so a job sent before its handler is deployed is lost.
  A known kind whose handler is not installed is the opposite case and is safe: it is retried into the
  dead-letter queue and never acked.
- **The dead-letter writer is planned, not written.** Nothing consumes either dead-letter queue and
  nothing copies a dead-lettered body to R2, so today the body survives for the queue's own retention
  window (a platform setting) and `docs/DEPLOY.md` §13 says what an operator does. The writer ships with
  an R2 lifecycle expiry rule and stores the envelope only, which is ids and never more, so a body that
  could carry more is not kept forever. Its key is `dlq/<queue>/<messageId>.json` (§3.2).

---

## 7. Scaling posture and the stated ceiling

- **D1 is 10 GB per database** and there are no read replicas by default. All tenants share one.
- The dominant row growth is `account_balances`. A power user with 15 years of history across 10
  accounts is roughly 55 000 snapshot rows **before** the sparse rule, which typically removes 70–90%
  of them on accounts that do not change daily.
- **Decision for v1: accept one shared database, with a size alarm.** Per-workspace database sharding
  is expensive to build now and expensive to discover the need for later; the trade is recorded here
  rather than assumed, and the alarm is what converts "we did not think about it" into "we have a
  number and a date".
- The levers, in the order they would be pulled: raise the sparse threshold on cold accounts → archive
  snapshots older than N years to R2 as a compressed series → shard by workspace.

---

## 8. Caching and invalidation

- **Plan state** is cached 60s in KV; **usage is always read live**, so nobody outruns a quota inside
  the cache window. Caching usage is the tempting optimisation and it is exactly the wrong one.
- **FX rates** are cached per pair per day, 36h. A day's rate never changes retroactively, so the
  cache needs no invalidation path at all.
- **No cookie session cache.** Better Auth's `cookieCache` would put a signed session snapshot in a
  cookie, which is a five-minute window in which a banned or role-changed account keeps its old
  authority. Without it, the workspace role is read from the `member` row on every call, so a
  demotion applies to the next call; a ban and the platform role are read from the session record in
  KV and take effect when Better Auth rewrites or deletes it, bounded by KV propagation
  (ADR 0011, Amendment).
- **Query cache on the client** is TanStack Query with route-loader integration; a mutation
  invalidates by key prefix, and money-bearing surfaces refetch rather than optimistically patching,
  because an optimistic amount that is later corrected is worse than a spinner.

---

## 9. Migration policy

**Additive by default. The reader we protect is the previous Worker's SQL**, which is still serving
traffic during the migrate-then-deploy window.

- No column is dropped, renamed or narrowed in the same change that stops writing it.
- A rename is: add the new column → write both → backfill → switch reads → stop writing the old one →
  (a later, separate change) drop it.
- A `NOT NULL` column is added with a default, or added nullable and tightened in a later migration
  after the backfill.
- Every enum column carries a SQL `CHECK` generated from an exported TypeScript tuple, so the two
  cannot drift.
- Migrations are generated (`pnpm db:generate`), never hand-written, and CI fails when a schema edit
  arrives without its migration. `drizzle/` is generated and is never hand-edited.
- **Non-additive migrations are registered.** `docs/DEPLOY.md` carries a register naming every one,
  its window, and the manual step it needs. A non-additive migration that is not in that register is
  a release blocker.

---

## 10. Failure modes and mitigations

| Failure                                           | What happens                                        | Mitigation                                                                      |
| ------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| FX provider down                                  | Nightly refresh writes nothing for that day         | Fallback provider; 7-day look-back at read time; `source` per row               |
| Both FX providers down for >7 days                | A conversion for a new transaction cannot resolve   | The write is refused with a typed error and the person is offered a manual rate |
| Queue consumer failing                            | Messages retry, then dead-letter                    | The DLQ keeps the body for its retention; a writer to R2 is planned (§6)        |
| A rebuild interleaves                             | Cannot happen                                       | The `LEDGER` DO serialises by account                                           |
| A write path forgets `runWithLedgerBatch`         | That account's chart is stale until 03:00           | The nightly sweep heals it; the lint rule catches the missing wrapper           |
| Polar webhook replayed                            | Handled once                                        | Claim-then-handle dedupe in KV, claim released on throw                         |
| Polar webhook unsigned                            | 400, never processed                                | HMAC over `id.timestamp.body`, 300s tolerance, constant-time compare            |
| D1 approaching 10 GB                              | Writes eventually fail                              | Size alarm; §7's lever list                                                     |
| A session survives a ban                          | Cannot happen for longer than one request           | No cookie session cache; the role is re-read per request                        |
| An amount reaches Sentry                          | A data-protection incident                          | Money-aware scrubber in the redaction middleware; typed error envelopes         |
| A cron expression is mistyped in `wrangler.jsonc` | The branch throws instead of silently doing nothing | `scheduled()` switches on four literal constants with a default that throws     |

---

## 11. Observability

- **Sentry** on both the Worker and the client, release from `CF_VERSION_METADATA`. The
  `failureRedactionMiddleware` scrubs money-shaped fields by key before anything is sent, and the
  public failure envelope is built from typed codes rather than interpolated messages.
- **Workers observability** is on with 100% head sampling and invocation logs in both environments;
  the cost is small and the alternative is debugging a money bug from a 1% sample.
- **`/api/health`** returns `200` with the version, the environment and a D1 round-trip. It is what
  the deploy smoke check asserts.
- `classifyFailure` maps every thrown error to a stable public code, so a client can branch on the
  cause without the server leaking the reason.
