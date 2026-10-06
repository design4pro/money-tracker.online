# Queue envelope kinds, the handler seam and the R2 key layout (plan stage 00-S12)

| Field              | Value                                 |
| ------------------ | ------------------------------------- |
| **Status**         | in-progress                           |
| **Issue**          | none                                  |
| **Spec PR**        | #515                                  |
| **Implementation** | #525                                  |
| **Plan**           | 00-S12 (docs/plans/00-foundations.md) |

## 📝 TLDR

Plan stage `00-S12` ("Bindings: the import and export queue surfaces", `docs/plans/00-foundations.md`)
exists so that plans `19` (import) and `20` (export and backup) never edit the two shared paths
`src/server/worker.ts` and `wrangler.jsonc`. It was written before the code, and the code has since
shipped half of it: the import and attachment R2 keys already have the stage's layout. What is left is
the queue side and the contradictions around it. The consumer is one inlined loop that can only run
`billing.event`; the union has one kind; the KV claim that `docs/ARCHITECTURE.md` §2.3 describes does
not exist; three documents give three R2 layouts; `wrangler.jsonc` says the import cap is 50 000 where
the code and plan 19 say 20 000; and the stage's quota paragraph describes metering the code does not do.

This spec turns the stage into seven small tickets: an executable key module for the layouts that are
not written yet, a tenant check on attachment reads, a dispatcher with a handler registry so later
plans add a line instead of editing `worker.ts`, the five new envelope kinds, a KV claim wrapper proven
in `workerd`, the config values and a config test, and the documentation reconciliation. It ships no
handler for the new kinds and no producer: those are `19-S1`, `19-S3` and `20-S1` to `20-S3`.

## 📝 Problem Statement

Verified against the repository at the time of writing (commands in Resolved assumptions row 14).

**What the code already delivers**

- `importFileKey` (`src/server/repos/imports.ts`) returns `imports/<orgId>/<batchId>/<fileName>` and
  `attachmentKey` (`src/server/repos/attachments.ts`) returns
  `attachments/<orgId>/<transactionId>/<attachmentId>`: both are the stage's layout, both are asserted
  against real rows, and both writers already put the object first, assert the quota second and delete
  the object when the insert throws.
- `wrangler.jsonc` declares `FILES` and `TASKS`, one consumer per environment with
  `dead_letter_queue` `money-tracker-tasks-dlq` and `money-tracker-tasks-staging-dlq`.
- `src/server/worker.ts` exports `queue()`; `src/server/queue/messages.ts` parses with a discriminated
  union; the shipped producer is `src/routes/api/webhooks/polar.ts`.

**What does not hold**

1. **The union has one kind.** `taskMessageSchema` carries `billing.event` and nothing else. The import,
   export and backup kinds have no envelope. `src/server/queue/__tests__/` does not exist, so
   `parseTaskMessage` has no test.
2. **Every plan that adds a kind edits `worker.ts`.** `queue()` calls `handleBillingEvent` for any
   parsed message without switching on `kind`; widening the union breaks `task.eventId` there. Plan `09`
   also plans a `handlers/ledger.ts` with no path that wires it. The `workerd` vitest entry deliberately
   does not import the application, so the inlined loop cannot be driven against real KV.
3. **The documented idempotency claim does not exist.** `docs/ARCHITECTURE.md` §2.3 and §3.1 describe
   `task:claim:v1:<id>` (120 s, released on throw); `grep task:claim src/` finds nothing. §2.3 also says a
   duplicate delivery "finds the claim and acks", which loses the job when the first worker crashed
   without releasing.
4. **`ARCHITECTURE.md` §6 describes an envelope the code does not have**
   (`{ v, id, kind, orgId, payload, enqueuedAt }`, a `PermanentTaskError`), and §2.3 and `DEPLOY.md` §13
   promise that a dead-lettered body is written to R2 under `dlq/`. Nothing writes it and neither DLQ
   queue has a consumer.
5. **Three layouts for one bucket.** The stage: `exports/<orgId>/<jobId>.<ext>`,
   `backups/<env>/<date>/d1.sql.gz`, `dlq/<queue>/<messageId>.json`. `ARCHITECTURE.md` §3.2:
   `imports/.../source.<ext>`, `exports/<orgId>/<jobId>/export.<json|csv>`, `backups/<env>/<date>/d1.jsonl.gz`,
   a dated `dlq/` key. Plan 20: `workspaces/{workspaceId}/exports/{jobId}/{name}`,
   `backups/{yyyy-mm-dd}/{workspaceId}.json`, the kind `export.generate`, and "`00-S12` owns the key
   module". Plan 20-S3's backup is the export serialiser at `format: 'json'`, one object per workspace;
   a Worker has no D1 dump API, so the stage's `d1.sql.gz` cannot be produced.
6. **The two row caps disagree.** `wrangler.jsonc` says `IMPORT_MAX_ROWS` 50 000 and `EXPORT_MAX_ROWS`
   250 000 in both environments and nothing reads either. `src/server/import/types.ts` exports
   `IMPORT_MAX_ROWS = 20_000`, read by the upload and mapping paths, and plan 19 promises "20 000 data
   rows". `EXPORT_MAX_ROWS` appears only in `wrangler.jsonc`, the generated `worker-configuration.d.ts` and
   the stage text. No test reads `wrangler.jsonc`.
7. **The stage's quota paragraph is false.** It says `storageBytes` "is metered against the `imports/`,
   `exports/` and `attachments/` prefixes". `src/server/repos/usage.ts` (line 23) and
   `src/lib/plans.ts` (line 98) say `storageBytes` is the sum of `attachments.byte_size` only, and
   imports are limited by the monthly `imports` metric.
8. **Nothing refuses an attachment row that points into another workspace's prefix.**
   `GET` and `HEAD /api/files/$id` rely only on the scoped row lookup. The row's `r2_key` is written only by
   `attachmentKey(scope.ctx.organizationId, ...)`, so a cross-tenant key can only come from a bug, a bad
   restore or a hand-edited row; but the stage names the refusal as its tenant-isolation case and no code
   makes it possible to fail.
9. **The stage's own text is out of step with the decisions below**: its Owned paths list only
   `src/server/worker.ts` and `wrangler.jsonc`, it names `backup.d1`, and its Verification asks for a
   `wrangler dev` round trip that has no handler to run.

## 📝 Proposed Solution

Seven tickets, each one pull request, none of them a behaviour change for a user.

- **Phase 1 - the key module for the layouts nothing writes yet.** `src/server/files/keys.ts` with
  `exportKey`, `backupKey`, `dlqKey` and the prefix helpers, a segment guard, and `keys.test.ts`. The
  layouts in Resolved assumptions row 2.
- **Phase 2 - the attachment prefix check.** `getAttachmentForRead` refuses a row whose key is not under the
  caller's `attachments/<orgId>/` prefix, as a `NotFoundError`, plus the stage's tenant-isolation case.
- **Phase 3 - the dispatcher.** Extract the batch loop into `src/server/queue/dispatch.ts` and a registry in
  `src/server/queue/handlers/index.ts`; `worker.ts` `queue()` becomes one call. `billing.event` behaves exactly
  as today.
- **Phase 4 - the five envelope kinds.** `import.parse`, `import.execute`, `import.revert`, `export.build`,
  `backup.run` in `messages.ts`, a registry typed over every kind, a "not installed" handler for the five, and
  `envelope.test.ts`.
- **Phase 5 - the KV claim wrapper.** One wrapper for the five kinds, with a `workerd` test against the real
  `KV` binding that observes the marker.
- **Phase 6 - the caps and the config test.** `IMPORT_MAX_ROWS` 20 000 in both environments, a `server`-project
  test that reads `wrangler.jsonc`.
- **Phase 7 - make the documents say what the code is.** `ARCHITECTURE.md` §2.3, §3.1, §3.2, §6, `DEPLOY.md` §13,
  the `wrangler.jsonc` comment, plan 20's layout and kind lines, the 00-S12 stage block, and its `Delivered:` line.

Not in this spec, on purpose, each justified in Resolved assumptions: a DLQ-to-R2 writer and the two DLQ
consumers (row 7), a generic `{ v, id, payload }` envelope (row 3), a shared module for the key builders that
already exist (row 2), enforcement code for `EXPORT_MAX_ROWS` (row 9), widening `storageBytes` to imports and
exports (row 10), and any handler or producer for the new kinds.

### Why a dispatcher and a registry

`worker.ts` is one of the eight shared paths (`docs/plans/00-foundations.md`, area brief): it has one writer at a
time. If each later plan that adds a job kind has to edit the inlined loop, the file is contested by plans `09`,
`19` and `20` and the stage has not done its job. After Phase 3, a plan adds one handler file and replaces one
registry entry. The dispatcher also takes its handler table as an argument, which is what lets a `workerd` test
drive it with the real `KV` binding without importing the application.

### How a message is handled after this spec

1. `parseTaskMessage(body)`; `null` is acked with a warning (unchanged).
2. For `billing.event`: the registered handler, with no claim (its D1 row status is its idempotency, unchanged).
3. For the five new kinds: `withTaskClaim` (Phase 5) takes `task:claim:v1:<kind>:<organizationId>:<identity>` in KV
   (identity is `batchId`, `jobId` or the backup `date`; `backup.run` has no organization and uses the literal
   `platform` in that position). When the claim is already held the message is `retry({ delaySeconds })`, never `ack`;
   otherwise the handler runs and the claim is released in a `finally`, only if it still carries this delivery's token.
4. A handler that throws, or the "not installed" handler, is `message.retry()` with an error log naming kind,
   attempt and `message.id`; the retry limit then sends it to the DLQ. A known kind is never silently acked.
5. A handler that needs to refuse permanently (an organization or batch that does not match) returns its own
   outcome, which the dispatcher acks and logs at `error`; this is the pattern `docs/plans/09-balance-history.md`
   §Tenant isolation test already specifies.

The KV claim is a **concurrency guard, not the correctness mechanism**: KV has no compare-and-swap, so two
workers can both pass a get-then-put. Correctness is each handler's own D1 state (`import_batches.imported_count`
as the resume cursor for `19-S3`, the `export_jobs` row status for `20-S2`). The claim is keyed per organization so
that two tenants whose ids collide, or a guessed id, can never hold or starve another tenant's claim.

## 📝 Architecture

Owner modules, per `docs/SPEC.md` §8.

| Concept                                   | Owner module                                     | Seam this spec touches                                                                                          |
| ----------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| The queue envelope (what a message says)  | `src/server/queue/messages.ts`                   | Five new `z.strictObject` members of `taskMessageSchema`; `parseTaskMessage` unchanged                          |
| Batch dispatch (ack, retry, unknown body) | `src/server/queue/dispatch.ts` (new)             | `handleTaskBatch(batch, env, handlers)`; no import of the application                                           |
| Which handler runs for a kind             | `src/server/queue/handlers/index.ts` (new)       | An exhaustive `{ [K in TaskKind]: TaskHandler<K> }`; plans 19 and 20 replace one entry                          |
| The KV claim                              | `src/server/queue/claim.ts` (new)                | `withTaskClaim(kv, key, run)`, `claimKey(task)`; used for the five new kinds only                               |
| R2 keys not yet written                   | `src/server/files/keys.ts` (new)                 | `exportKey`, `backupKey`, `dlqKey`, `orgPrefix`, `assertKeyInOrg`, the segment guard                            |
| R2 keys already written                   | `src/server/repos/{imports,attachments}.ts`      | Unchanged builders; `attachmentKeyPrefix` (one line over `orgPrefix`) beside `attachmentKey`                    |
| The attachment read decision              | `getAttachmentForRead` in `repos/attachments.ts` | Throws `NotFoundError` on a key outside the caller's prefix; `deleteAttachment` likewise before `bucket.delete` |
| Deployment values and queue topology      | `wrangler.jsonc`                                 | `IMPORT_MAX_ROWS` corrected; comment on R2 contents corrected                                                   |
| The import row cap                        | `src/server/import/types.ts` (`IMPORT_MAX_ROWS`) | Read by the config test; not moved                                                                              |

Dependency direction: `dispatch.ts` imports `messages.ts`, `claim.ts`, `db/from-env` and `observability/logger` (to
build the handler context), and nothing from `handlers/`, `repos/` or `cloudflare:workers`; the registry and
`worker.ts` import it. `keys.ts` imports nothing, and `repos/attachments.ts` imports `keys.ts`, never the reverse.
The `server` vitest project forbids `cloudflare:workers`, and all five new modules respect that.

The stage's Owned paths widen from the two shared paths to this list; the extension is necessary for each item
and is stated here because a stage's "Owned paths" is what the scheduler uses to keep two stages from the same file.

## 📝 Data Model

None. No table, no column, no migration. `export_jobs` (`00-S9`) and the import batch columns are not touched;
`export_jobs.r2_key` will store what `exportKey` returns, which is plan 20's to write. `backup_runs` is `00-S14`'s.

## 📝 API Contracts

**Envelopes** (the queue's public surface, `BACKWARD_COMPATIBILITY.md` "Queue messages"). New members of
`taskMessageSchema`, each `z.strictObject`, none with a `v` field (a new `kind` is the versioning mechanism):

| Kind             | Fields                                             | Producer / handler (not in this spec) |
| ---------------- | -------------------------------------------------- | ------------------------------------- |
| `import.parse`   | `organizationId`, `userId`, `batchId`              | `19-S1`                               |
| `import.execute` | `organizationId`, `userId`, `batchId`              | `19-S3`                               |
| `import.revert`  | `organizationId`, `userId`, `batchId`              | `19-S3`                               |
| `export.build`   | `organizationId`, `userId`, `jobId`                | `20-S2`                               |
| `backup.run`     | `date` (`YYYY-MM-DD`), `cursor?` (string, bounded) | `20-S3`, platform-level, no tenant    |

Field rules. Every id is `z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)`: a bounded charset, so an id cannot carry `/`, a
space or a control character into a KV key or an R2 key. `date` is a real calendar day (a round trip through `Date`,
not only the pattern, so `2026-02-31` is refused). `cursor` is `z.string().max(512)` over a printable-ASCII class.
`billing.event`'s `eventId` is unchanged.

The invariant, worded so it is true: **an envelope carries ids, one date and one pagination cursor, and never a value
that is also stored in a row** (an amount, a rate, a role, a status). `backup.run` is the one kind without
`organizationId`: it is platform-level and the handler enumerates organizations itself.

**Authority of the identity fields.** `organizationId` and `userId` in an envelope are a claim used to find a scope,
never an authorisation. A handler for a tenant kind does all four, in this order, and each stage's tenant-isolation
case proves each one:

1. `memberScopeFor(db, organizationId, userId)` (`src/server/repos/members.ts`) re-reads the role from `member` and
   returns `null` for a person who has left; a `null` scope is a permanent refusal.
2. The batch or job is loaded through that scope; a `NotFoundError` is a permanent refusal.
3. The creator matches: the loaded row's creator (`import_batches.created_by_user_id`, the `export_jobs` requester) is
   the envelope's `userId`. Without it any current member could be named as the actor of a job they did not start.
4. `assertRole` for the action the kind performs (for example a role that may commit or revert an import), because an
   envelope carries no role and a member's role may have changed since the message was sent.

A permanent refusal is an ack and an `error` log with ids only. Each stage that adds a handler adds its isolation
case, and `memberScopeFor` is the only way a queue handler builds a scope: a case in the tooling project asserts that
`src/server/queue/handlers/` imports no other scope constructor. `billing.event` is unchanged and carries only
`eventId`.

**Dispatcher** (internal): `handleTaskBatch(batch: MessageBatch<unknown>, env: TaskEnv, handlers: TaskHandlers)`
where `TaskEnv` is the full `Cloudflare.Env` that `queue()` already receives: `dbFromEnv(env: Env)` takes the whole
environment and `loggerFromEnv` reads `LOG_LEVEL` and `ENVIRONMENT`, so a narrower type would either not compile or
drop the `environment` log field. `src/server/db/from-env.ts` is not touched.
A handler is `(task: Extract<TaskMessage, { kind: K }>, ctx: TaskContext) => Promise<void | { permanent: string }>`.
`TaskContext` is built once per message by the dispatcher:
`{ db: dbFromEnv(env), logger: loggerFromEnv(env, { context: { component: 'queue', route: batch.queue } }), now: () => Date }`
(the same logger and database `worker.ts` builds today; `now` is injected so a handler test pins the clock).

`TaskHandlers` is the correlated mapped type `{ [K in TaskKind]: TaskHandler<K> }`, with
`type TaskKind = TaskMessage['kind']`. The dispatcher looks a handler up as `handlers[task.kind]` and TypeScript
cannot correlate that with `task`, so the one call site goes through a single documented helper
`runHandler<K extends TaskKind>(handlers, task: Extract<TaskMessage, { kind: K }>, ctx)`; this is the only place a
cast is allowed, and it carries a comment naming the invariant. The test for "a missing registry entry is retried" builds
the table as `Partial<TaskHandlers>` and passes it through one cast in the test file.

**R2 keys** (the layout this stage fixes; documented in `docs/ARCHITECTURE.md` §3.2). `orgId` is the second segment
of every tenant family (`imports`, `exports`, `attachments`, `backups`), so a tenant sweep is a prefix list per
family. `dlq/` is platform-level and carries no organization:

```
imports/<orgId>/<batchId>/<filename>          shipped (importFileKey)
attachments/<orgId>/<transactionId>/<attachmentId>   shipped (attachmentKey)
exports/<orgId>/<jobId>.<zip|json>            new (exportKey)
backups/<orgId>/<yyyy-mm-dd>.json             new (backupKey)
dlq/<queue>/<messageId>.json                  new (dlqKey); no writer in this spec
```

Each environment has its own bucket, so no key carries the environment. `exportKey`, `backupKey` and `dlqKey` take
plain strings (the backup cron runs across tenants, so a `TenantScope` is the wrong parameter) and throw on a segment
that is empty, is `.` or `..`, or contains `/` or a backslash.

Two helpers over the same module serve the readers. `orgPrefix(family, organizationId)` returns `<family>/<orgId>/`
and is the only place that string is spelled (`attachmentKeyPrefix` is a one-line call to it, so the write side and the
check cannot drift). `assertKeyInOrg(family, organizationId, key)` throws when `key` does not start with that prefix;
`getAttachmentForRead` and `deleteAttachment` call it. Two obligations are recorded for tickets this spec does not
write: a `dlq/` writer ships with an R2 lifecycle expiry rule and stores only the envelope (ids), never a body that
could carry more, and the future download route of `20-S2` and the import-file read of `19-S1` (no reader exists today) each call
`assertKeyInOrg` on the key they are about to `get`.

**Server functions, Zod, TenantScope:** none are added. The handlers that will consume the envelopes parse the
payload a second time in the repository, as `AGENTS.md` requires; that belongs to the stages that write them.

## 📝 UI/UX

None. No surface; no browser evidence, no axe run.

## 📝 Edge Cases & Failure Scenarios

- **Deploy order.** No producer for the new kinds ships here. The code that sends them (`19-S1`, `20-S2`) must reach
  production after the consumer that parses them, because an older consumer treats an unknown body as unhandled and
  acks it. This is stated in the ARCHITECTURE §6 text Phase 7 writes.
- **A known kind with no handler yet.** Retried, then dead-lettered: the body survives in the DLQ for the queue's
  retention window (a platform setting; the DLQ writer to R2 is deferred, row 7). It is never acked.
- **The claim is held.** `retry({ delaySeconds: CLAIM_RETRY_DELAY_SECONDS })` with `CLAIM_RETRY_DELAY_SECONDS = 45`.
  Each claim-held retry consumes an attempt, so the retry budget (`max_retries` 3 in staging, 5 in production, from
  `wrangler.jsonc`) must outlast the claim: the config test of Phase 6 asserts
  `max_retries * CLAIM_RETRY_DELAY_SECONDS > CLAIM_TTL_SECONDS` in both environments (3 * 45 = 135 and 5 * 45 = 225,
  both above 120; the wrangler `retry_delay` of 10 s applies only to a plain `retry()`). A duplicate that arrives while a very long
  job runs can still reach the DLQ; the D1 cursor makes a re-drive safe, and the claim TTL (120 s) is the crash safety
  net, not a promise about job length.
- **The claim store is down.** A KV `get` or `put` that throws is a throw out of `withTaskClaim` before the handler
  runs; the dispatcher retries the message (error log) and never acks it. The handler does not run unguarded.
- **The first worker crashed.** The claim is released only in a `finally`, which a crash does not run; it expires after
  its TTL (KV's minimum `expirationTtl` is 60 s, so 120 s is valid) and the retried message then runs. Acking a
  duplicate would have lost the job.
- **A slow first worker's release.** The claim value is a per-delivery token; release reads the key and deletes it only
  when it still equals this delivery's token, so a worker that overran the TTL cannot delete a claim a second worker
  has since taken. A release that fails is logged at `warn` and never fails the message (the TTL clears the key).
- **A continuation message.** A handler that enqueues the next chunk (`19-S3`) or a backup continuation (`20-S3`)
  does so while still holding the claim, so a continuation sent with no delay is delivered into a held claim. The
  rule for plans 19 and 20: enqueue continuations with `delaySeconds` of at least `CLAIM_RETRY_DELAY_SECONDS`, or
  treat a claim-held retry as normal; the ARCHITECTURE §2.3 text of Phase 7 states it.
- **`backup.run` identity.** Its claim identity is the `date` alone with the literal `platform` organization, so one
  backup run per day holds the claim; a continuation of the same date is the same message identity and relies on the
  delay rule above. Plan 20-S3 may widen the identity to include the cursor if it needs concurrent chunks.
- **A file named `..`.** `importFileKey` and `safeFileName` are untouched: R2 keys are flat strings and the shipped
  builder cannot escape a prefix. The segment guard applies to the new builders, whose segments are ids.
- **A row cap changed in one place.** The config test (Phase 6) fails when the wrangler value and the code constant
  differ in either environment.
- **A key of the right shape in the wrong tenant.** Phase 2 refuses it, on read and on delete, with the same 404 as an
  id that does not exist (`repos/errors`: the two must be indistinguishable) and logs the attachment id only, never the
  key or the other organization. On delete the check runs before `bucket.delete`, so a poisoned row cannot be used to
  delete another tenant's object.
- **A stale `userId`.** A person who left between enqueue and delivery gets a `null` scope and a permanent refusal; a
  person whose role dropped fails `assertRole`. Neither is retried.
- **Offboarding.** A tenant sweep per prefix would also reach `backups/<orgId>/`. Whether a leaver's backups are
  deleted at once or kept for the retention window is a retention decision (`OPEN-8`, plan 20); this spec makes the
  sweep possible and decides nothing about it.

## 📝 Risks & Impact Review

| Risk                                                         | Severity | Mitigation                                                                                                                                                                                                              |
| ------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 3 changes the shipped `billing.event` path             | Medium   | A pure extraction: `dispatch.test.ts` pins ack on success, retry on throw and ack-plus-warn on an unparseable body, and `billing-event.test.ts` is untouched                                                            |
| Phase 2 rejects a legitimate attachment                      | Medium   | The test keeps a happy-path assertion that a correctly keyed row of A's still reads, so a check that rejects everything cannot pass                                                                                     |
| A tenant check on a download path is a tenant-scoping change | High     | Ask First (`AGENTS.md`) is settled for the pipeline by the security specialist's verdict (`afk-decide`, row 11); the Phase 2 PR is `risk-high`, takes a second reviewer and needs human `qa-approved`; no schema change |
| The claim is read as a correctness guarantee                 | Medium   | The ARCHITECTURE text and the wrapper's docblock say it is a concurrency guard; each handler's D1 cursor is the mechanism                                                                                               |
| The structural money test is weakened later                  | Medium   | It is an allow-list over `taskMessageSchema.options`: a new field of a type or name not on the list fails; narrowing a test is Ask First (`AGENTS.md`)                                                                  |
| A claim that outlives its retry budget loses a job           | Medium   | The config test asserts `max_retries * CLAIM_RETRY_DELAY_SECONDS > CLAIM_TTL_SECONDS` in both environments                                                                                                              |
| A plan-text edit contradicts a plan already in flight        | Low      | Phase 7 edits only the 00-S12 block and the two layout and kind lines of plan 20, which cite `00-S12` as their authority                                                                                                |

The spec PR itself is design-only and `risk-low`. The one implementation ticket that touches tenant scoping is Phase 2.
Backward compatibility: the queue-message surface gains kinds and changes none (no producer exists for them, the
shipped `billing.event` shape is untouched); no binding is renamed; `IMPORT_MAX_ROWS` in `wrangler.jsonc` is a
variable nothing reads, so correcting it changes no behaviour.

## 📝 Visual change expected

None. Backend-only; no route or state changes on screen in either theme or viewport.

## 📝 Copy

None. No user-facing string is added, changed or removed, so there is no EN or PL catalogue entry.

## 📋 Phasing

Seven tickets, in this order. The numbering is the dependency order; `afk-to-tickets` may merge adjacent small ones.

1. **Phase 1 - key module.** Independently shippable. Fixes Problem 5 (code half).
2. **Phase 2 - attachment prefix check and the tenant-isolation case.** Blocked by Phase 1 (`orgPrefix`, `assertKeyInOrg`). Fixes Problem 8.
3. **Phase 3 - dispatcher and registry.** Independently shippable and behaviour-preserving. Fixes Problem 2.
4. **Phase 4 - envelope kinds.** Blocked by Phase 3. Fixes Problem 1.
5. **Phase 5 - claim wrapper.** Blocked by Phase 4. Fixes Problem 3.
6. **Phase 6 - caps and config test.** Blocked by Phase 5 (the config test imports `CLAIM_TTL_SECONDS` and `CLAIM_RETRY_DELAY_SECONDS`); `afk-to-tickets` may split the `max_retries` assertion into Phase 5 to make the cap part independent. Fixes Problem 6.
7. **Phase 7 - documentation reconciliation and `Delivered:`.** Blocked by 1 to 6. Fixes Problems 4, 5 (text half), 7 and 9.

## 📋 Implementation Plan

Every phase ends by running the gate: `node -e "require('./.ai/agentic.config.json').validation.commands.forEach(c=>console.log(c))"`
and every command in the order it prints, on the final commit; no `.skip`, `.only`, `.todo`, `@ts-expect-error` or
`eslint-disable`; prettier-clean on what it touches (`pnpm exec prettier --check <files>`).

### Phase 1 - the key module

1. **Red first.** `src/server/files/__tests__/keys.test.ts` (the `server` project): `exportKey('org-a', 'job-1', 'zip')`
   is `exports/org-a/job-1.zip` and `'json'` likewise; `backupKey('org-a', '2026-10-04')` is
   `backups/org-a/2026-10-04.json`; `dlqKey('money-tracker-tasks', 'msg-1')` is `dlq/money-tracker-tasks/msg-1.json`;
   for each org-scoped builder, `key.split('/')[1]` is the organization and `key.startsWith(orgPrefix(kind, org))`;
   `orgPrefix` ends with `/` so `org-a` is not a prefix of `org-ab`; `assertKeyInOrg` accepts a key built by each org-scoped builder and throws on the same key checked against another organization, on a key that merely shares the organization's characters as a prefix, and on a key of another family; every builder throws on `''`, `'.'`, `'..'`,
   `'a/b'` and a backslash segment. The date argument is parsed as `YYYY-MM-DD`.
2. **Write `src/server/files/keys.ts`** to turn it green: the three builders, `orgPrefix(family, organizationId)` for
   `imports | exports | attachments | backups`, `assertKeyInOrg`, and one private segment guard. No import. Docblock states the rule
   (organization second, one bucket per environment) and that `importFileKey` and `attachmentKey` stay in their
   repositories.
3. **Tenant-isolation test:** none, no repository function. **Money invariant:** none, no amount.

### Phase 2 - the attachment prefix check

4. **Red first**, in `src/server/repos/__tests__/tenant-isolation.test.ts`, the stage's case named
   _`/api/files/$id` refuses an object whose key prefix is not the caller's organization_. The fixture has to get past
   `attachments_r2_key_unique` (`src/server/db/schema.ts:2081`): create a receipt in workspace B through
   `createAttachment` with B's scope, so the key is real; read B's `r2_key`; **delete B's row with a raw `DELETE`** in
   the test's setup (a test may write SQL directly; the repository rule is for application code) and insert an org-A row
   whose `r2_key` is that key, so the unique index is not violated and the object is still in the bucket. Then:
   `getAttachmentForRead(scopeA, ...)` is a `NotFoundError`; the route's own order (`getAttachmentForRead`, then
   `serveAttachment` only if it returned) against a bucket that records `get` calls sees zero `get` calls;
   `deleteAttachment(scopeA, bucket, ...)` is a `NotFoundError` and the bucket records zero `delete` calls (a second
   case); and in the same test a correctly keyed row of A's still reads, so a check that rejects everything cannot pass.
   The bucket is the `RecordingBucket` of that file moved out of its `describe` and given a `get` recorder, or the
   `FakeBucket` of `attachments.test.ts` (it already has `reads`); the implementer takes whichever needs the smaller
   edit and does not write a third one.
5. **Implement** in `src/server/repos/attachments.ts`: `attachmentKeyPrefix(organizationId)` is `orgPrefix('attachments',
organizationId)` (one line, so write side and check share the spelling); a private `requireOwnKey(scope, row)` calls
   `assertKeyInOrg` and turns a failure into `NotFoundError` plus a `warn` carrying the attachment id only. Both
   `getAttachmentForRead` and `deleteAttachment` call it on the loaded row, `deleteAttachment` before `bucket.delete`.
   `serve.ts` and `src/routes/api/files/$id.ts` are not edited: the repository read covers `GET` and `HEAD`.
6. **Label and approval:** the tenant-scoping change is Ask First (`AGENTS.md`). For the pipeline that question is
   settled by the security specialist's verdict recorded in Resolved assumptions row 11 (`afk-decide`), not by this run
   alone; the implementation PR is `risk-high`, takes a second reviewer, and needs the human `qa-approved` label.
   Obligations recorded for later tickets, not done here: `19-S1`'s file read and `20-S2`'s download route each call
   `assertKeyInOrg` before `get` and ship their own isolation case.

### Phase 3 - the dispatcher and the registry

7. **Red first**, `src/server/queue/__tests__/dispatch.test.ts` with fake messages that record `ack` and `retry`:
   ack on a handled message; `retry` on a handler that throws; ack plus a warning on an unparseable body; ack plus an
   `error` log (ids only) on a handler that returns `{ permanent }`, never a retry; messages
   settled one at a time (a throw in message 2 of 3 does not retry 1 or 3); no `ackAll`.
8. **Write `src/server/queue/dispatch.ts`** (`handleTaskBatch`) by moving the loop out of `worker.ts` unchanged in
   behaviour for `billing.event`, plus the `{ permanent }` outcome of How-a-message-is-handled step 5 (ack, `error` log), and `src/server/queue/handlers/index.ts` with the registry holding the one `billing.event` entry that
   calls `handleBillingEvent` as today. `worker.ts` `queue()` calls `handleTaskBatch(batch, env, registry)`; the dispatcher builds the logger and the
   `TaskContext` of API Contracts per message (`db`, `logger`, `now`), so `queue()` keeps no logic. The typing of
   `handlers[task.kind]` goes through the one `runHandler` helper of API Contracts. Existing `billing-event.test.ts`
   is unchanged.

### Phase 4 - the five kinds

9. **Red first**, `src/server/queue/__tests__/envelope.test.ts`: each of the five parses a valid body to itself and
   refuses an unknown extra key, a missing field, an empty string, an over-long string and an id outside
   `^[A-Za-z0-9_-]{1,64}$` (a `/`, a space, a newline); `backup.run` refuses a malformed date and `2026-02-31`, and a
   `cursor` over 512 characters or with a control character; and the structural case **no envelope field can carry a
   value that is stored in a row**, as an allow-list: walk `taskMessageSchema.options`, assert each is a strict object,
   and assert each shape key other than `kind` is on the list `organizationId | userId | batchId | jobId | eventId |
date | cursor`, and that each of those is a `ZodString` (or an optional of one). A new field of any other name or
   type fails until someone edits the list, which is the review point; a name deny-list is not used because it is
   defeated by a field called `value`.
10. **Extend `messages.ts`** with the five schemas of API Contracts and add them to the union. **Type the registry**
    in `handlers/index.ts` as `{ [K in TaskKind]: TaskHandler<K> }` so a kind without an entry does not compile, and
    give the five an explicit `notInstalled(kind)` handler that throws `HandlerNotInstalledError`, and add a `workerd`-free handler-table test that every one of the six kinds has a registry entry. The dispatcher turns
    any throw, this included, into `retry()` with an error log naming kind, attempt and `message.id`; it also keeps a
    runtime fallback: a missing registry entry is `retry()` with an error log, never `ack()`. Add a `dispatch.test.ts`
    case for the not-installed path.
11. **Tenant-isolation test:** none yet; each of `19-S1`, `19-S3`, `20-S2` ships its handler's case. **Money invariant:**
    the structural test above.

### Phase 5 - the claim wrapper

12. **Red first**, `src/server/queue/__tests__/claim.test.ts` (fake KV): `claimKey(task)` is
    `task:claim:v1:<kind>:<organizationId>:<identity>` (`platform` in the organization position for `backup.run`), put
    with a 120 s `expirationTtl` (the KV minimum is 60 s) and a per-delivery random token as the value; a held claim
    does not run the handler and `withTaskClaim` returns `{ held: false }`, which makes the dispatcher call
    `retry({ delaySeconds: CLAIM_RETRY_DELAY_SECONDS })`; the claim is deleted when the handler returns and when it
    throws; release deletes only when the stored value is still this delivery's token (a second worker's claim survives
    a late release); a release that throws is logged at `warn` and does not fail the message; a KV `get` or `put` that
    throws makes the dispatcher `retry()` with an error log and does not run the handler, and does not ack;
    `billing.event` takes no claim; two organizations with the same `batchId` hold different keys.
13. **Write `src/server/queue/claim.ts`**: `withTaskClaim<T>(kv, key, run: () => Promise<T>)` returning
    `Promise<{ held: true; result: T } | { held: false }>` (`held: true` means this delivery holds the claim and ran),
    `claimKey`, `CLAIM_TTL_SECONDS = 120` and `CLAIM_RETRY_DELAY_SECONDS = 45`, and call it from the dispatcher for the
    five kinds. The docblock states: concurrency guard, not correctness; KV has no compare-and-swap; a get-then-put
    can let two workers through; the TTL is the crash safety net.
14. **The real-KV proof**, `src/server/queue/__tests__/dispatch.workerd.test.ts` (the `workerd` project): import
    `handleTaskBatch` directly and call it with the real `env` from `cloudflare:test`, a hand-built batch of one
    `import.execute` message and a test handler table filling all six kinds. **Inside the handler** read the marker from
    `env.KV` and assert it exists and carries a token (reading it after the batch would observe nothing); after the
    batch settles assert it is gone; and with the marker pre-set assert the handler did not run and the message was
    retried with `delaySeconds` 45. This replaces the stage's "`wrangler dev` round trip", which needs a handler that
    does not exist (Resolved assumptions row 8). Run it alone: `pnpm test:workerd`.

### Phase 6 - the caps and the config test

15. **Red first**, `src/server/__tests__/wrangler-config.test.ts` (the `server` project): read `wrangler.jsonc` per
    environment (top level and `staging`) with `unstable_readConfig` from the installed `wrangler`; assert
    `vars.IMPORT_MAX_ROWS` equals the exported `IMPORT_MAX_ROWS` constant; `max_retries * CLAIM_RETRY_DELAY_SECONDS`
    exceeds `CLAIM_TTL_SECONDS` for each environment's consumer; `vars.EXPORT_MAX_ROWS` is a positive integer
    and equal in both environments; both consumers name a `dead_letter_queue`, each is its own queue and the two
    environments' names differ; the producer queue equals the consumer queue per environment. Plan B if
    `unstable_readConfig` cannot run in the `server` project (it was probed and works in plain Node): parse
    `wrangler.jsonc` with the repository's existing JSONC reader and apply the `env.staging` override by hand in the
    test, never a regex over the file.
16. **Set `IMPORT_MAX_ROWS` to `20000`** in the top-level and the staging `vars` of `wrangler.jsonc`. Do not hand-edit
    `worker-configuration.d.ts`; the type is `number` either way, so regeneration is expected to be a no-op, which the
    implementer confirms by running the generator. This ticket edits no comment: Phase 7 is the single owner of the R2 comment
    prose in `wrangler.jsonc`.

### Phase 7 - documents and the stage block

17. **`docs/ARCHITECTURE.md`:** §2.3 (claim semantics: held means retry with a delay; released in `finally` by token;
    concurrency guard; the dispatcher and registry; continuations are enqueued with `delaySeconds` of at least the claim
    delay), §3 (the binding-map row at line ~131 that names the R2 contents and the §10 rows at lines ~337 and ~340 that
    repeat the old layout), §3.1 (the claim key as implemented, with the organization), §3.2 (the five-line layout above),
    §6 (the flat per-kind envelope, no `v`, no `payload`; `PermanentTaskError` described as not implemented and the
    permanent-refusal outcome that replaces it; the four-part authority rule; the deploy-order rule; the DLQ writer as
    planned, not written, with its lifecycle-expiry and ids-only conditions).
18. **`docs/DEPLOY.md` §13:** drop the date segment and the promise that bodies are already written to `dlq/`; state
    what an operator does today (the DLQ queue's own retention) and that the writer is planned.
19. **`wrangler.jsonc`:** every R2 comment (lines ~105, ~132-134 and ~162, not only the first) stops saying "nightly D1
    logical backups" and says per-workspace JSON backups under `backups/<orgId>/`; comments only, no value.
    **`BACKWARD_COMPATIBILITY.md` "Queue messages"** gains the sentence that a known kind without an installed handler is
    retried into the DLQ, never acked, and that a producer must not ship before its consumer.
    **`docs/plans/19-import.md`** (the line that says a duplicate delivery acks, ~125) says a held claim is a delayed
    retry. **`docs/plans/09-balance-history.md`** gets a one-line pointer that its `handlers/ledger.ts` registers in
    `handlers/index.ts`.
20. **`docs/plans/20-export-and-backup.md`:** the R2 layout bullet (line ~72) and the kind `export.generate` (line
    ~166) become `exports/<orgId>/<jobId>.<ext>`, `backups/<orgId>/<yyyy-mm-dd>.json` and `export.build`; add that 20-S3's
    continuation message is `backup.run` with a `cursor`; note that `EXPORT_MAX_ROWS = 250000` is unenforced and
    unpromised until 20-S2 adopts or replaces it, and that retention pruning of `backups/<orgId>/` and the offboarding
    sweep are plan 20's (the prefixes make both a prefix list). Change nothing else in plan 20.
21. **The 00-S12 block of `docs/plans/00-foundations.md`:** sweep the whole block and replace every plan-only name:
    the kind list (`backup.d1` becomes `backup.run`), the Owned paths (the list in Architecture), the Quota paragraph
    (`storageBytes` is `attachments.byte_size` only, `usage.ts`; imports are limited by the monthly `imports` metric;
    exports are time-boxed by plan 20's expiry; the write order _object first, assert second, compensating delete on
    throw_ is stated as the convention every R2 write follows, already true of `uploadAttachment` and
    `createImportBatch`), the Server section (the dispatcher and registry, the claim as a concurrency guard), the
    Tenant isolation test (the repository read, not the route), the Money invariant (ids, one date and one cursor; the allow-list test), the
    Verification (the `workerd` round trip). Reference row `FND-26 missing → partial` with what remains named: the
    handlers (`19-S1`, `19-S3`, `20-S1` to `20-S3`) and the DLQ-to-R2 writer. Add
    `Delivered: <YYYY-MM-DD> - <evidence: the paths, the tests, the pull requests>` directly under the stage heading,
    dated the day Phase 7 is written, the evidence naming pull request numbers and counts read from commands run in that
    pull request. The stage register's Open and Closed rows are not edited: `Closed` means every reference row reads
    `→ done`, and `FND-26` does not yet, which is why the stage is delivered and still open.
22. **Run the gate**, plus `pnpm exec prettier --check` over every file touched.

## 📝 Resolved assumptions (autonomous defaults)

Every row is a decision this run made without a human, or a default it applied; each is reversible before merge by
saying so on the spec PR.

| #   | Question                                                                         | Applied default                                                                                                                                                                                                                                                                                                                                              | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Is the stage delivered, or does it get a spec?                                   | **A spec.** The key layouts for imports and attachments are shipped; the queue side, the claim, the caps and the documents are not.                                                                                                                                                                                                                          | `afk-plan-to-spec` § 2: a partly delivered stage is not delivered.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2   | Which R2 layout is authoritative, and where does the key code live?              | **The stage's, with `backups/<orgId>/<yyyy-mm-dd>.json` (no `<env>`, no `d1.sql.gz`), exports `<jobId>.<zip\|json>`, a dateless `dlq/` key.** New builders in `src/server/files/keys.ts`; the two shipped builders stay in their repositories; `attachmentKeyPrefix` sits beside `attachmentKey`.                                                            | Decided by software architect sub-agent (confidence medium-high) and narrowed by the security and tenancy reviewer (row 11): the stage's layout is the only one that leaves shipped keys alone; plan 20's backup is per workspace and a Worker has no D1 dump API; the organization stays the second segment. The reviewer's objection to a shared module of _existing_ builders is honoured, the new builders get a module because plan 20 says `00-S12` owns it and nothing else could host a test of the layout. |
| 3   | Envelope shape and a `v` field?                                                  | **Flat per-kind `z.strictObject` members; no `v`, no generic `payload`.** `ARCHITECTURE.md` §6 is amended to this.                                                                                                                                                                                                                                           | Decided by software architect sub-agent (confidence medium-high): the generic envelope would migrate the shipped `billing.event` producer, a protected surface; `BACKWARD_COMPATIBILITY.md` already names a new `kind` as the versioning mechanism.                                                                                                                                                                                                                                                                 |
| 4   | What does the "idempotency marker in KV" mean, and what happens when it is held? | **A concurrency guard keyed `task:claim:v1:<kind>:<organizationId>:<identity>`, 120 s, released in `finally` by token; when held, `retry({ delaySeconds: 45 })`, never ack.** `billing.event` takes none.                                                                                                                                                    | Same specialist verdict as row 3: keying on `message.id` guards nothing a re-sent job cares about; acking a duplicate loses the job when the first worker crashed; KV has no compare-and-swap so correctness stays in D1.                                                                                                                                                                                                                                                                                           |
| 5   | Kind names                                                                       | **`export.build` (plan 20's `export.generate` is amended) and `backup.run` with `{ date, cursor? }` (the stage's `backup.d1` is renamed).**                                                                                                                                                                                                                  | Decided by software architect sub-agent (confidence medium): no producer exists so a rename is free now and breaking later; `backup.d1` would name a D1 dump plan 20 cannot do, and `cursor` covers 20-S3's continuation message.                                                                                                                                                                                                                                                                                   |
| 6   | Where does the dispatch loop live, and what happens to a kind with no handler?   | **`src/server/queue/dispatch.ts` plus an exhaustive registry; an uninstalled handler throws and is retried to the DLQ; a missing entry is retried, never acked.**                                                                                                                                                                                            | Decided by software architect sub-agent (confidence medium): `worker.ts` would otherwise be contested by plans 09, 19 and 20; the `workerd` entry cannot import the application, so only an importable dispatcher can be driven against real KV; silently acking a valid job is a deploy-order bug.                                                                                                                                                                                                                 |
| 7   | Does this stage write dead-lettered bodies to R2?                                | **No.** The key layout is fixed, `DEPLOY.md` §13 and `ARCHITECTURE.md` stop promising the writer, and it is recorded as a remaining part of `FND-26`.                                                                                                                                                                                                        | Decided by software architect sub-agent (confidence medium): two new DLQ consumers change production topology and are not exercised by the stage's verification. This run files no tickets (`afk-plan-to-spec`); `afk-to-tickets` or a person files the follow-up from `FND-26`.                                                                                                                                                                                                                                    |
| 8   | The stage's `wrangler dev` round trip                                            | **Replaced by a `workerd` vitest case that drives `handleTaskBatch` with the real `KV` binding and observes the marker.**                                                                                                                                                                                                                                    | There is no handler for any new kind to run under `wrangler dev`, and ADR 0015 makes the `workerd` project the repository's route to real bindings. A claim written and cleared in real KV is the observation the stage asked for.                                                                                                                                                                                                                                                                                  |
| 9   | `IMPORT_MAX_ROWS` and `EXPORT_MAX_ROWS`                                          | **The code constant (20 000) is the source; both wrangler `IMPORT_MAX_ROWS` values become 20 000; `EXPORT_MAX_ROWS` stays 250 000, unenforced and unpromised; a config test guards the drift.**                                                                                                                                                              | Decided by product-owner sub-agent (confidence high): 20 000 is what plan 19 promises and the parser enforces; raising it would widen the promise and re-size the import chunking; no exporter exists to enforce an export cap, so writing enforcement would be speculation. Conditions applied: no hand edit of the generated type, any handler reads the constant, plan 20 gets a one-line note.                                                                                                                  |
| 10  | Does `storageBytes` also meter `imports/` and `exports/`?                        | **No.** The stage text is corrected to what `usage.ts` does: `attachments.byte_size` only.                                                                                                                                                                                                                                                                   | Widening a billing meter is Ask First (`AGENTS.md`) and nobody asked; imports are limited by the monthly `imports` metric and exports are time-boxed. The write-order rule is kept as a convention, which is already true of the two shipped writers.                                                                                                                                                                                                                                                               |
| 11  | Is there a runtime key-prefix check, and where?                                  | **Yes, in `getAttachmentForRead` and `deleteAttachment` as a `NotFoundError`, through `orgPrefix` and `assertKeyInOrg`; `serve.ts` and the route are not edited. Implementation PR `risk-high`, second reviewer, human `qa-approved`.**                                                                                                                      | Decided by security and tenancy reviewer sub-agent (confidence medium): the repository read is the whole authorisation decision (`SECURITY.md` §6.2) and the placement covers `HEAD`, which never reaches `serveAttachment`; no migration (Ask First); the check is the only runtime form of "organization is the second segment". Test conditions applied: real key from B, spy sees zero `get`, happy path kept, id-only logging.                                                                                 |
| 12  | The money-invariant claim and `organizationId` in an envelope                    | **Ids, one date and one cursor, never a value that is also in a row; the test is an allow-list over `taskMessageSchema.options`. `organizationId` and `userId` are a claim, not an authorisation: `memberScopeFor`, a scoped lookup, a creator match and `assertRole`; mismatch is a permanent refusal. No role in an envelope.**                            | Decided by security and tenancy reviewer sub-agent (confidence medium): the stage's wording is false of `billing.event`, which carries only `eventId`; an unscoped re-derivation would be a third exception to SPEC §5.2.                                                                                                                                                                                                                                                                                           |
| 13  | Do the stage's Owned paths widen?                                                | **Yes, to the list in Architecture.**                                                                                                                                                                                                                                                                                                                        | Each added file is new or is the single place a decision above needs; without declaring them the scheduler could run another stage over them.                                                                                                                                                                                                                                                                                                                                                                       |
| 14  | Which numbers in this spec are measured?                                         | Vars `50000` / `250000` and the DLQ names: `unstable_readConfig` probe of `wrangler.jsonc` (both environments). `IMPORT_MAX_ROWS = 20_000`: `src/server/import/types.ts:64`. No `task:claim` in `src/`: `grep -rn task:claim src docs`. `storageBytes` is attachments-only: `src/server/repos/usage.ts:23`, `src/lib/plans.ts:98`.                           | `docs/SPEC.md` §7.7: every number written down came from a command whose output was read. Phase 7's evidence line re-measures what it quotes in its own pull request.                                                                                                                                                                                                                                                                                                                                               |
| 15  | `FND-26` and the `Delivered:` line                                               | **`FND-26` becomes `partial` with the handlers and the DLQ writer named; the stage gets a `Delivered:` line; the register's Open row is not edited.**                                                                                                                                                                                                        | `Delivered:` stops the Reconciler offering the stage again, which is the point once everything this stage owns is in; `Closed` in the register means every row is `→ done`, which `FND-26` is not, so the two statements are both true.                                                                                                                                                                                                                                                                             |
| 16  | Phase 2 is a tenant-scoping change, which `AGENTS.md` makes Ask First            | **Settled for the pipeline by the security specialist's verdict (row 11); the PR is `risk-high` with a second reviewer and human `qa-approved`.**                                                                                                                                                                                                            | `afk-decide`: a specialist's verdict settles an open question in the unattended pipeline; the human gate is the QA sign-off on the implementation PR, where the code change lands. This spec changes no code.                                                                                                                                                                                                                                                                                                       |
| 17  | The claim's key, value, delay and failure behaviour                              | **Key with the organization; per-delivery token, delete-if-match; `CLAIM_RETRY_DELAY_SECONDS = 45`; a throwing acquire retries; the config test pins `max_retries * delay > TTL`.**                                                                                                                                                                          | Panel round 1 (architect and security): a key without the organization lets one tenant's id collide with another's; an unconditional release can delete a second worker's claim; 3 retries of 30 s (staging) do not outlast a 120 s claim.                                                                                                                                                                                                                                                                          |
| 18  | How is the money invariant tested?                                               | **An allow-list of field names and `ZodString` types over `taskMessageSchema.options`, plus a bounded id charset.**                                                                                                                                                                                                                                          | Panel round 1 (security): a name deny-list is defeated by a field called `value`; an allow-list makes a new field a deliberate edit.                                                                                                                                                                                                                                                                                                                                                                                |
| 19  | What does `userId` in an envelope mean?                                          | **A creator-match input, checked against the loaded row's creator, then `assertRole`.**                                                                                                                                                                                                                                                                      | Panel round 1 (security): `memberScopeFor` proves membership, not that this member started the job, and a role may change between enqueue and delivery.                                                                                                                                                                                                                                                                                                                                                             |
| 20  | Does `dlq/` carry an organization, and is its writer in scope?                   | **No organization (platform-level); no writer here; the writer ships with an R2 lifecycle expiry and stores envelope ids only.**                                                                                                                                                                                                                             | Panel round 1 (security): the earlier "organization second in every family" claim was false of `dlq/`, and a dead-lettered body kept forever is an unbounded retention of ids.                                                                                                                                                                                                                                                                                                                                      |
| 21  | Panel verdicts, round 1                                                          | **Software architect: approve with conditions. Product owner: approve with conditions. Security and tenancy reviewer: approve with conditions. None escalated.** All conditions applied in the second commit of this branch.                                                                                                                                 | `afk-plan-to-spec` § 4: a specialist panel reviews the spec, at most two rounds.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 22  | Panel verdicts, round 2                                                          | **Security and tenancy reviewer: approve, no conditions (confidence high). Software architect: approve with four conditions (phase dependencies of Phases 2 and 6, `TaskEnv` is the full `Cloudflare.Env`, a permanent-refusal test), all applied. The product owner was not re-asked: the only product-facing rows (9, 10) did not change.** Not escalated. | The panel is closed after two rounds, as the skill requires; the applied round 2 conditions are mechanical edits, not new design.                                                                                                                                                                                                                                                                                                                                                                                   |
