# Queue envelope kinds, the handler seam and the R2 key layout (plan stage 00-S12)

| Field              | Value                                 |
| ------------------ | ------------------------------------- |
| **Status**         | ready                                 |
| **Issue**          | none                                  |
| **Spec PR**        | none                                  |
| **Implementation** | none                                  |
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
3. For the five new kinds: take `task:claim:v1:<kind>:<identity>` in KV (identity is `batchId`, `jobId` or the backup
   `date`); when it is already held, `message.retry({ delaySeconds })`, never `ack`; otherwise run the handler and
   release the claim in a `finally`.
4. A handler that throws, or the "not installed" handler, is `message.retry()` with an error log naming kind,
   attempt and `message.id`; the retry limit then sends it to the DLQ. A known kind is never silently acked.
5. A handler that needs to refuse permanently (an organization or batch that does not match) returns its own
   outcome, which the dispatcher acks and logs at `error`; this is the pattern `docs/plans/09-balance-history.md`
   §Tenant isolation test already specifies.

The KV claim is a **concurrency guard, not the correctness mechanism**: KV has no compare-and-swap, so two
workers can both pass a get-then-put. Correctness is each handler's own D1 state (`import_batches.imported_count`
as the resume cursor for `19-S3`, the `export_jobs` row status for `20-S2`).

## 📝 Architecture

Owner modules, per `docs/SPEC.md` §8.

| Concept                                   | Owner module                                     | Seam this spec touches                                                                 |
| ----------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| The queue envelope (what a message says)  | `src/server/queue/messages.ts`                   | Five new `z.strictObject` members of `taskMessageSchema`; `parseTaskMessage` unchanged |
| Batch dispatch (ack, retry, unknown body) | `src/server/queue/dispatch.ts` (new)             | `handleTaskBatch(batch, env, handlers)`; no import of the application                  |
| Which handler runs for a kind             | `src/server/queue/handlers/index.ts` (new)       | An exhaustive `{ [K in TaskKind]: TaskHandler<K> }`; plans 19 and 20 replace one entry |
| The KV claim                              | `src/server/queue/claim.ts` (new)                | `withTaskClaim(kv, key, run)`; used for the five new kinds only                        |
| R2 keys not yet written                   | `src/server/files/keys.ts` (new)                 | `exportKey`, `backupKey`, `dlqKey`, `orgPrefix`, the segment guard                     |
| R2 keys already written                   | `src/server/repos/{imports,attachments}.ts`      | Unchanged builders; `attachmentKeyPrefix` added beside `attachmentKey`                 |
| The attachment read decision              | `getAttachmentForRead` in `repos/attachments.ts` | Throws `NotFoundError` on a key outside the caller's prefix                            |
| Deployment values and queue topology      | `wrangler.jsonc`                                 | `IMPORT_MAX_ROWS` corrected; comment on R2 contents corrected                          |
| The import row cap                        | `src/server/import/types.ts` (`IMPORT_MAX_ROWS`) | Read by the config test; not moved                                                     |

Dependency direction: `dispatch.ts` imports `messages.ts`, `claim.ts` and the logger type, and nothing from
`handlers/`, `repos/` or `cloudflare:workers`; the registry and `worker.ts` import it. `keys.ts` imports nothing.
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

Every string is `min(1)` with a `max`, every id as long as `billing.event`'s `eventId`. The rule, as the money
invariant states it: **an envelope carries ids only, never a value that is also stored in a row** (an amount, a
rate, a role, a status). `organizationId` and `userId` are a claim used to build a scope, never an authorisation:
the handler reaches the batch or job through a scope built with `memberScopeFor(db, organizationId, userId)`
(`src/server/repos/members.ts`), which re-reads the role from `member` and returns `null` for a person who has left;
a `null` scope, or a `NotFoundError` from the scoped lookup of the id under that organization, is a permanent refusal
(ack and `error` log), not a retry. A role never travels in an envelope. `billing.event` is unchanged and carries
only `eventId`.

**Dispatcher** (internal): `handleTaskBatch(batch: MessageBatch<unknown>, env: TaskEnv, handlers: TaskHandlers)`
where `TaskEnv` is the slice of `Cloudflare.Env` it uses (`KV`, `DB`, `LOG_LEVEL`). A handler is
`(task, ctx) => Promise<void | { permanent: string }>`.

**R2 keys** (the layout this stage fixes; documented in `docs/ARCHITECTURE.md` §3.2). `orgId` is always the second
segment, so a tenant sweep is a prefix list per top-level family:

```
imports/<orgId>/<batchId>/<filename>          shipped (importFileKey)
attachments/<orgId>/<transactionId>/<attachmentId>   shipped (attachmentKey)
exports/<orgId>/<jobId>.<zip|json>            new (exportKey)
backups/<orgId>/<yyyy-mm-dd>.json             new (backupKey)
dlq/<queue>/<messageId>.json                  new (dlqKey); no writer in this spec
```

Each environment has its own bucket, so no key carries the environment. `exportKey`, `backupKey` and `dlqKey` take
plain strings (the backup cron runs across tenants, so a `TenantScope` is the wrong parameter) and throw on a segment
that is empty, is `.` or `..`, or contains `/`.

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
- **The claim is held.** `retry({ delaySeconds: CLAIM_RETRY_DELAY_SECONDS })`. Each claim-held retry consumes an
  attempt, so a duplicate that arrives while a very long job runs can reach the DLQ; the D1 cursor makes a re-drive
  safe, and the claim TTL (120 s) is the crash safety net, not a promise about job length.
- **The first worker crashed.** The claim is released only in a `finally`, which a crash does not run; it expires after
  its TTL and the retried message then runs. Acking a duplicate would have lost the job.
- **A continuation message.** A handler that enqueues the next chunk (`19-S3`) or a backup continuation (`20-S3`)
  does so while still holding the claim; the claim is released in `finally` before the next message is delivered or
  the delayed retry picks it up. Plans 19 and 20 must enqueue with a delay or treat a claim-held retry as normal.
- **A file named `..`.** `importFileKey` and `safeFileName` are untouched: R2 keys are flat strings and the shipped
  builder cannot escape a prefix. The segment guard applies to the new builders, whose segments are ids.
- **A row cap changed in one place.** The config test (Phase 6) fails when the wrangler value and the code constant
  differ in either environment.
- **A key of the right shape in the wrong tenant.** Phase 2 refuses it with the same 404 as an id that does not exist
  (`repos/errors`: the two must be indistinguishable) and logs the attachment id only, never the key or the other
  organization.
- **Offboarding.** A tenant sweep per prefix would also reach `backups/<orgId>/`. Whether a leaver's backups are
  deleted at once or kept for the retention window is a retention decision (`OPEN-8`, plan 20); this spec makes the
  sweep possible and decides nothing about it.

## 📝 Risks & Impact Review

| Risk                                                         | Severity | Mitigation                                                                                                                                                   |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 3 changes the shipped `billing.event` path             | Medium   | A pure extraction: `dispatch.test.ts` pins ack on success, retry on throw and ack-plus-warn on an unparseable body, and `billing-event.test.ts` is untouched |
| Phase 2 rejects a legitimate attachment                      | Medium   | The test keeps a happy-path assertion that a correctly keyed row of A's still reads, so a check that rejects everything cannot pass                          |
| A tenant check on a download path is a tenant-scoping change | High     | The implementation PR of Phase 2 is labelled `risk-high` and takes a second reviewer; no schema change                                                       |
| The claim is read as a correctness guarantee                 | Medium   | The ARCHITECTURE text and the wrapper's docblock say it is a concurrency guard; each handler's D1 cursor is the mechanism                                    |
| The structural money test is weakened later                  | Medium   | It walks `taskMessageSchema.options`, so a new kind is covered with no edit; narrowing a test is Ask First (`AGENTS.md`)                                     |
| A plan-text edit contradicts a plan already in flight        | Low      | Phase 7 edits only the 00-S12 block and the two layout and kind lines of plan 20, which cite `00-S12` as their authority                                     |

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
2. **Phase 2 - attachment prefix check and the tenant-isolation case.** Independently shippable. Fixes Problem 8.
3. **Phase 3 - dispatcher and registry.** Independently shippable and behaviour-preserving. Fixes Problem 2.
4. **Phase 4 - envelope kinds.** Blocked by Phase 3. Fixes Problem 1.
5. **Phase 5 - claim wrapper.** Blocked by Phase 4. Fixes Problem 3.
6. **Phase 6 - caps and config test.** Independently shippable. Fixes Problem 6.
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
   `orgPrefix` ends with `/` so `org-a` is not a prefix of `org-ab`; every builder throws on `''`, `'.'`, `'..'`,
   `'a/b'` and a backslash segment. The date argument is parsed as `YYYY-MM-DD`.
2. **Write `src/server/files/keys.ts`** to turn it green: the three builders, `orgPrefix(family, organizationId)` for
   `imports | exports | attachments | backups`, and one private segment guard. No import. Docblock states the rule
   (organization second, one bucket per environment) and that `importFileKey` and `attachmentKey` stay in their
   repositories.
3. **Tenant-isolation test:** none, no repository function. **Money invariant:** none, no amount.

### Phase 2 - the attachment prefix check

4. **Red first**, in `src/server/repos/__tests__/tenant-isolation.test.ts`, the stage's case named
   _`/api/files/$id` refuses an object whose key prefix is not the caller's organization_: create a receipt in
   workspace B through `createAttachment` with the other scope, so the key is real; insert an org-A row whose `r2_key`
   is that key; call `getAttachmentForRead(scopeA, ...)` and assert `NotFoundError`; run the route's own order
   (`getAttachmentForRead`, then `serveAttachment` only if it returned) against a bucket spy and assert zero `get`
   calls; and, in the same test, assert that a correctly keyed row of A's still reads. Reuse the recording bucket in that file (add a `get`
   recorder).
5. **Implement** in `src/server/repos/attachments.ts`: export `attachmentKeyPrefix(organizationId)` beside
   `attachmentKey` (`attachments/<orgId>/`), and make `getAttachmentForRead` throw `NotFoundError` when the loaded
   row's `r2Key` does not start with it, logging a `warn` with the attachment id only. `serve.ts` and
   `src/routes/api/files/$id.ts` are not edited: the repository read covers `GET` and `HEAD`.
6. **Label:** the implementation PR is `risk-high` (tenant scoping) and takes a second reviewer.

### Phase 3 - the dispatcher and the registry

7. **Red first**, `src/server/queue/__tests__/dispatch.test.ts` with fake messages that record `ack` and `retry`:
   ack on a handled message; `retry` on a handler that throws; ack plus a warning on an unparseable body; messages
   settled one at a time (a throw in message 2 of 3 does not retry 1 or 3); no `ackAll`.
8. **Write `src/server/queue/dispatch.ts`** (`handleTaskBatch`) by moving the loop out of `worker.ts` unchanged in
   behaviour, and `src/server/queue/handlers/index.ts` with the registry holding the one `billing.event` entry that
   calls `handleBillingEvent` as today. `worker.ts` `queue()` builds the logger and calls `handleTaskBatch`. Existing `billing-event.test.ts` is unchanged.

### Phase 4 - the five kinds

9. **Red first**, `src/server/queue/__tests__/envelope.test.ts`: each of the five parses a valid body to itself and
   refuses an unknown extra key, a missing field, an empty string and an over-long string; `backup.run` refuses a
   malformed date; and the structural case **no envelope kind carries an amount field**: walk
   `taskMessageSchema.options`, assert each is a strict object and that no key matches
   `/amount|minor|balance|total|rate|price|role/i`.
10. **Extend `messages.ts`** with the five schemas of API Contracts and add them to the union. **Type the registry**
    in `handlers/index.ts` as `{ [K in TaskKind]: TaskHandler<K> }` so a kind without an entry does not compile, and
    give the five an explicit `notInstalled(kind)` handler that throws `HandlerNotInstalledError`. The dispatcher turns
    any throw, this included, into `retry()` with an error log naming kind, attempt and `message.id`; it also keeps a
    runtime fallback: a missing registry entry is `retry()` with an error log, never `ack()`. Add a `dispatch.test.ts`
    case for the not-installed path.
11. **Tenant-isolation test:** none yet; each of `19-S1`, `19-S3`, `20-S2` ships its handler's case. **Money invariant:**
    the structural test above.

### Phase 5 - the claim wrapper

12. **Red first**, `src/server/queue/__tests__/claim.test.ts` (fake KV): the claim key is
    `task:claim:v1:<kind>:<identity>` with a 120 s `expirationTtl`; a held claim does not run the handler and makes the
    dispatcher call `retry({ delaySeconds })`; the claim is deleted when the handler returns and when it throws;
    `billing.event` takes no claim.
13. **Write `src/server/queue/claim.ts`** (`withTaskClaim`, `CLAIM_TTL_SECONDS = 120`, `CLAIM_RETRY_DELAY_SECONDS`)
    and call it from the dispatcher for the five kinds. The docblock states: concurrency guard, not correctness; KV has
    no compare-and-swap.
14. **The real-KV proof**, `src/server/queue/__tests__/dispatch.workerd.test.ts` (the `workerd` project): import
    `handleTaskBatch` directly and call it with the real `env` from `cloudflare:test`, a hand-built batch of one
    `import.execute` message and a test handler table; while the handler runs, read the marker from `env.KV` and assert it
    exists; after it settles assert it is gone; and with the marker pre-set assert the handler did not run and the
    message was retried with a delay. This replaces the stage's "`wrangler dev` round trip", which needs a handler that
    does not exist (Resolved assumptions row 8). Run it alone: `pnpm test:workerd`.

### Phase 6 - the caps and the config test

15. **Red first**, `src/server/__tests__/wrangler-config.test.ts` (the `server` project): read `wrangler.jsonc` per
    environment (top level and `staging`) with `unstable_readConfig` from the installed `wrangler`; assert
    `vars.IMPORT_MAX_ROWS` equals the exported `IMPORT_MAX_ROWS` constant; `vars.EXPORT_MAX_ROWS` is a positive integer
    and equal in both environments; both consumers name a `dead_letter_queue`, each is its own queue and the two
    environments' names differ; the producer queue equals the consumer queue per environment.
16. **Set `IMPORT_MAX_ROWS` to `20000`** in the top-level and the staging `vars` of `wrangler.jsonc`. Do not hand-edit
    `worker-configuration.d.ts`; the type is `number` either way, so regeneration is expected to be a no-op, which the
    implementer confirms by running the generator. Fix the R2 comment at line ~105 (Phase 7 owns the prose, this
    ticket owns the one value; if both land in one pull request, do both).

### Phase 7 - documents and the stage block

17. **`docs/ARCHITECTURE.md`:** §2.3 (claim semantics: held means retry with a delay; released in `finally`; concurrency
    guard; the dispatcher and registry), §3.1 (the claim key as implemented), §3.2 (the five-line layout above),
    §6 (the flat per-kind envelope, no `v`, no `payload`; `PermanentTaskError` described as not implemented and the
    permanent-refusal outcome that replaces it; the deploy-order rule; the DLQ writer as planned, not written).
18. **`docs/DEPLOY.md` §13:** drop the date segment and the promise that bodies are already written to `dlq/`; state
    what an operator does today (the DLQ queue's own retention) and that the writer is planned.
19. **`wrangler.jsonc`:** the R2 comment no longer says "nightly D1 logical backups"; it says per-workspace JSON
    backups.
20. **`docs/plans/20-export-and-backup.md`:** the R2 layout bullet (line ~72) and the kind `export.generate` (line
    ~166) become `exports/<orgId>/<jobId>.<ext>`, `backups/<orgId>/<yyyy-mm-dd>.json` and `export.build`; add that 20-S3's
    continuation message is `backup.run` with a `cursor`; note that `EXPORT_MAX_ROWS = 250000` is unenforced and
    unpromised until 20-S2 adopts or replaces it. Change nothing else in plan 20.
21. **The 00-S12 block of `docs/plans/00-foundations.md`:** sweep the whole block and replace every plan-only name:
    the kind list (`backup.d1` becomes `backup.run`), the Owned paths (the list in Architecture), the Quota paragraph
    (`storageBytes` is `attachments.byte_size` only, `usage.ts`; imports are limited by the monthly `imports` metric;
    exports are time-boxed by plan 20's expiry; the write order _object first, assert second, compensating delete on
    throw_ is stated as the convention every R2 write follows, already true of `uploadAttachment` and
    `createImportBatch`), the Server section (the dispatcher and registry, the claim as a concurrency guard), the
    Tenant isolation test (the repository read, not the route), the Money invariant (ids only, structural test), the
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

| #   | Question                                                                         | Applied default                                                                                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Is the stage delivered, or does it get a spec?                                   | **A spec.** The key layouts for imports and attachments are shipped; the queue side, the claim, the caps and the documents are not.                                                                                                                                                                                                | `afk-plan-to-spec` § 2: a partly delivered stage is not delivered.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2   | Which R2 layout is authoritative, and where does the key code live?              | **The stage's, with `backups/<orgId>/<yyyy-mm-dd>.json` (no `<env>`, no `d1.sql.gz`), exports `<jobId>.<zip\|json>`, a dateless `dlq/` key.** New builders in `src/server/files/keys.ts`; the two shipped builders stay in their repositories; `attachmentKeyPrefix` sits beside `attachmentKey`.                                  | Decided by software architect sub-agent (confidence medium-high) and narrowed by the security and tenancy reviewer (row 11): the stage's layout is the only one that leaves shipped keys alone; plan 20's backup is per workspace and a Worker has no D1 dump API; the organization stays the second segment. The reviewer's objection to a shared module of _existing_ builders is honoured, the new builders get a module because plan 20 says `00-S12` owns it and nothing else could host a test of the layout. |
| 3   | Envelope shape and a `v` field?                                                  | **Flat per-kind `z.strictObject` members; no `v`, no generic `payload`.** `ARCHITECTURE.md` §6 is amended to this.                                                                                                                                                                                                                 | Decided by software architect sub-agent (confidence medium-high): the generic envelope would migrate the shipped `billing.event` producer, a protected surface; `BACKWARD_COMPATIBILITY.md` already names a new `kind` as the versioning mechanism.                                                                                                                                                                                                                                                                 |
| 4   | What does the "idempotency marker in KV" mean, and what happens when it is held? | **A concurrency guard keyed `task:claim:v1:<kind>:<identity>`, 120 s, released in `finally`; when held, `retry({ delaySeconds })`, never ack.** `billing.event` takes none.                                                                                                                                                        | Same specialist verdict as row 3: keying on `message.id` guards nothing a re-sent job cares about; acking a duplicate loses the job when the first worker crashed; KV has no compare-and-swap so correctness stays in D1.                                                                                                                                                                                                                                                                                           |
| 5   | Kind names                                                                       | **`export.build` (plan 20's `export.generate` is amended) and `backup.run` with `{ date, cursor? }` (the stage's `backup.d1` is renamed).**                                                                                                                                                                                        | Decided by software architect sub-agent (confidence medium): no producer exists so a rename is free now and breaking later; `backup.d1` would name a D1 dump plan 20 cannot do, and `cursor` covers 20-S3's continuation message.                                                                                                                                                                                                                                                                                   |
| 6   | Where does the dispatch loop live, and what happens to a kind with no handler?   | **`src/server/queue/dispatch.ts` plus an exhaustive registry; an uninstalled handler throws and is retried to the DLQ; a missing entry is retried, never acked.**                                                                                                                                                                  | Decided by software architect sub-agent (confidence medium): `worker.ts` would otherwise be contested by plans 09, 19 and 20; the `workerd` entry cannot import the application, so only an importable dispatcher can be driven against real KV; silently acking a valid job is a deploy-order bug.                                                                                                                                                                                                                 |
| 7   | Does this stage write dead-lettered bodies to R2?                                | **No.** The key layout is fixed, `DEPLOY.md` §13 and `ARCHITECTURE.md` stop promising the writer, and it is recorded as a remaining part of `FND-26`.                                                                                                                                                                              | Decided by software architect sub-agent (confidence medium): two new DLQ consumers change production topology and are not exercised by the stage's verification. This run files no tickets (`afk-plan-to-spec`); `afk-to-tickets` or a person files the follow-up from `FND-26`.                                                                                                                                                                                                                                    |
| 8   | The stage's `wrangler dev` round trip                                            | **Replaced by a `workerd` vitest case that drives `handleTaskBatch` with the real `KV` binding and observes the marker.**                                                                                                                                                                                                          | There is no handler for any new kind to run under `wrangler dev`, and ADR 0015 makes the `workerd` project the repository's route to real bindings. A claim written and cleared in real KV is the observation the stage asked for.                                                                                                                                                                                                                                                                                  |
| 9   | `IMPORT_MAX_ROWS` and `EXPORT_MAX_ROWS`                                          | **The code constant (20 000) is the source; both wrangler `IMPORT_MAX_ROWS` values become 20 000; `EXPORT_MAX_ROWS` stays 250 000, unenforced and unpromised; a config test guards the drift.**                                                                                                                                    | Decided by product-owner sub-agent (confidence high): 20 000 is what plan 19 promises and the parser enforces; raising it would widen the promise and re-size the import chunking; no exporter exists to enforce an export cap, so writing enforcement would be speculation. Conditions applied: no hand edit of the generated type, any handler reads the constant, plan 20 gets a one-line note.                                                                                                                  |
| 10  | Does `storageBytes` also meter `imports/` and `exports/`?                        | **No.** The stage text is corrected to what `usage.ts` does: `attachments.byte_size` only.                                                                                                                                                                                                                                         | Widening a billing meter is Ask First (`AGENTS.md`) and nobody asked; imports are limited by the monthly `imports` metric and exports are time-boxed. The write-order rule is kept as a convention, which is already true of the two shipped writers.                                                                                                                                                                                                                                                               |
| 11  | Is there a runtime key-prefix check, and where?                                  | **Yes, in `getAttachmentForRead` as a `NotFoundError`, with `attachmentKeyPrefix`; `serve.ts` and the route are not edited. Implementation PR `risk-high`, second reviewer.**                                                                                                                                                      | Decided by security and tenancy reviewer sub-agent (confidence medium): the repository read is the whole authorisation decision (`SECURITY.md` §6.2) and the placement covers `HEAD`, which never reaches `serveAttachment`; no migration (Ask First); the check is the only runtime form of "organization is the second segment". Test conditions applied: real key from B, spy sees zero `get`, happy path kept, id-only logging.                                                                                 |
| 12  | The money-invariant claim and `organizationId` in an envelope                    | **Ids only, never a value that is also in a row; the test is structural over `taskMessageSchema.options`. `organizationId` and `userId` are a claim, not an authorisation: `memberScopeFor`, then a scoped lookup; mismatch is a permanent refusal. No role in an envelope.**                                                      | Decided by security and tenancy reviewer sub-agent (confidence medium): the stage's wording is false of `billing.event`, which carries only `eventId`; an unscoped re-derivation would be a third exception to SPEC §5.2.                                                                                                                                                                                                                                                                                           |
| 13  | Do the stage's Owned paths widen?                                                | **Yes, to the list in Architecture.**                                                                                                                                                                                                                                                                                              | Each added file is new or is the single place a decision above needs; without declaring them the scheduler could run another stage over them.                                                                                                                                                                                                                                                                                                                                                                       |
| 14  | Which numbers in this spec are measured?                                         | Vars `50000` / `250000` and the DLQ names: `unstable_readConfig` probe of `wrangler.jsonc` (both environments). `IMPORT_MAX_ROWS = 20_000`: `src/server/import/types.ts:64`. No `task:claim` in `src/`: `grep -rn task:claim src docs`. `storageBytes` is attachments-only: `src/server/repos/usage.ts:23`, `src/lib/plans.ts:98`. | `docs/SPEC.md` §7.7: every number written down came from a command whose output was read. Phase 7's evidence line re-measures what it quotes in its own pull request.                                                                                                                                                                                                                                                                                                                                               |
| 15  | `FND-26` and the `Delivered:` line                                               | **`FND-26` becomes `partial` with the handlers and the DLQ writer named; the stage gets a `Delivered:` line; the register's Open row is not edited.**                                                                                                                                                                              | `Delivered:` stops the Reconciler offering the stage again, which is the point once everything this stage owns is in; `Closed` in the register means every row is `→ done`, which `FND-26` is not, so the two statements are both true.                                                                                                                                                                                                                                                                             |
