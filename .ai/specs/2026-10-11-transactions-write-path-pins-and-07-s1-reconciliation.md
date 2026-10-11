# The transaction write path's isolation and handler pins, and plan stage 07-S1 reconciled

| Field              | Value                                      |
| ------------------ | ------------------------------------------ |
| **Status**         | ready                                      |
| **Issue**          | none                                       |
| **Spec PR**        | #TBD                                       |
| **Implementation** | none                                       |
| **Plan**           | 07-S1 (docs/plans/07-transactions-core.md) |

## 📝 TLDR

Plan stage `07-S1` (`docs/plans/07-transactions-core.md`, "The write path, policies and `ref_amount`")
was written before the code, and the code has since delivered nearly all of it in a different shape:
the four policies, `applyPolicies`, `computeRefAmount`, `createTransaction` / `updateTransaction` /
`deleteTransaction` / `getTransaction` and their Zod schemas all live in one module,
`src/server/repos/transactions.ts`, the four server functions are in `src/server/fns/transactions.ts`,
and the seven money invariants are cases 1 to 7 of `src/server/repos/__tests__/money-invariants.test.ts`.
Three owned paths of the plan do not exist and will not (`transaction-policies.ts`,
`transactions/ref-amount.ts`, `ref-amount.test.ts`), and four things the stage promises are not pinned.
This spec covers what is left. Phase 1 is tests only: a transactions write-path section in
`tenant-isolation.test.ts`, and a first test of the four server-function handlers
(`src/server/fns/__tests__/transactions.test.ts`). Phase 2 amends the stage block to what the code is
and records it as delivered. No behaviour change, no schema change, no migration, no new dependency.

## 📝 Problem Statement

Verified against the repository at the time of writing (commands in Resolved assumptions row 9).

**What the code already delivers**

- `src/server/repos/transactions.ts` (826 lines): `PlannedPolicy`, `BalanceAdjustmentPolicy`,
  `TransferPolicy`, `CompletenessPolicy` and the `TransactionPolicies` object whose four fields are all
  required, with no default constant; `applyPolicies(policies)` (returns `Array<SQL>`);
  `assertPolicySatisfied`; `computeRefAmount(input, conversion)`; the create and update Zod schemas
  (`z.strictObject`, `amountMinor` `z.number().int().positive()`, `bookedOn` `z.iso.date()`);
  `createTransaction`, `updateTransaction`, `deleteTransaction`, `getTransaction`, `findTransaction`;
  `toTransaction` branding. Both writes call `assertScopedWrite` on the predicate list they build, and
  the parents (`account`, `category`, `payee`) are checked in scope before any insert or update.
- `src/server/fns/transactions.ts`: `getTransaction` (GET), `createTransaction`, `updateTransaction`,
  `deleteTransaction` (POST). Each write is `runWithLedgerBatch(async () => { requireOrg() … })`, each
  input carries a required `policies` object, and the repository parses the payload a second time.
- The ledger side: `touchLedgerAccount` in the write functions, `runWithLedgerBatch` in
  `src/server/ledger/batch.ts` (one rebuild per account, flushed in a `finally`), pinned by
  `src/server/ledger/__tests__/batch.test.ts`.
- Tests that pass today: `pnpm vitest run src/server/repos/__tests__/transactions.test.ts` is 37 tests
  and `…/money-invariants.test.ts` is 67 (104 together). They cover: the policy argument is required
  (two `@ts-expect-error` fixtures), parent authorisation (a foreign account, category and payee on
  create; a foreign id on get, update and delete), a negative and a fractional amount rejected, the
  conversion written at `booked_on`'s rate, a missing rate throwing, the identity case, no
  `exchange_rates` in the SQL of `getTransaction` and `findTransaction`, an update re-anchoring only
  when the amount, currency or `booked_on` moves, both deletion guards, ledger touches (once per
  account, none when a write was refused) and half-to-even rounding.
- Plan rows `TXN-01`, `TXN-02` and `TXN-03` are therefore met in substance.

**What does not hold**

1. **Three owned paths do not exist.** `src/server/repos/transaction-policies.ts`,
   `src/server/transactions/ref-amount.ts` and `src/server/transactions/__tests__/ref-amount.test.ts`
   are absent; `src/server/transactions/` holds only `ledger-page.ts` (`07-S2`'s). Splitting the module
   to match the plan would touch 26 non-test files that import `#/server/repos/transactions` (6 of them
   use `computeRefAmount`) for no behaviour. The plan is what is stale. The names and
   signatures differ too: `applyPolicies(policies)` returns the predicates a query composes rather than
   wrapping a query, and `computeRefAmount` takes a `ConversionContext` (`{ baseCurrencyCode,
resolveRate }`, built by `conversionContextFor(scope)` in `workspace-currencies.ts`), not a `scope`.
2. **`tenant-isolation.test.ts` has no case for the transactions write path.** `AGENTS.md` ("Always")
   requires one for every new repository function. The cases exist, in `transactions.test.ts`
   ("parent authorisation"), but they assert only that each call raises `NotFoundError` and that B's
   `note` is still empty; the file that is the single place a reviewer looks for isolation has the
   structural scan ("no repository forks the tenant predicate"), the budgets and the ledger read, and
   nothing for `createTransaction`, `updateTransaction`, `deleteTransaction` or `getTransaction`.
   The patch path is also thinner than the create path: an `updateTransaction` that re-points a row of
   A's at B's account or payee is not tried.
3. **No test runs the four handlers.** `src/server/fns/__tests__/` has none for `fns/transactions.ts`.
   Nothing pins that each of the three writes is wrapped in `runWithLedgerBatch` (a handler that lost
   the wrapper would still compile, pass every repository test, and silently stop enqueueing rebuilds,
   which `docs/MONEY.md` calls the worst failure the product has), nor that the Zod layer in front of
   them refuses a negative amount or a field the strict schema does not name. The technique for running
   a handler exists: `src/server/fns/__tests__/attachments.test.ts`.
4. **The plan's `transfer_id` case is obsolete in shape.** "A `transfer_id` belonging to B, supplied by
   A, … is a `NotFoundError` before the insert" assumes `createTransaction` accepts a `transfer_id`. It
   does not: `createTransactionSchema` is a `z.strictObject` with no `transferId`, no `transferKind`,
   no `refundLinked`, no `importBatchId`, no `importSourceHash` and no `categorizationSource`
   (`transfers.ts`, `refunds.ts`, the rule applier and the future importer write those). The invariant
   is real, its form is "the key is refused by the schema", and nothing says so.
5. **`assertScopedWrite` cannot fire through the exported API, and the plan asks for a test that it
   does.** `updateTransaction` and `deleteTransaction` build `[eq(transactions.id, id),
…applyPolicies(policies)]`, so the list is never empty; the assertion is a backstop. The backstop
   itself is pinned against the account repository in `tenant-isolation.test.ts` ("the write backstop").
6. **The stage text is stale in four more places.** The "Columns written here" list names six columns
   `createTransaction` does not write (`transfer_kind`, `transfer_id`, `refund_linked`,
   `import_batch_id`, `import_source_hash`, `categorization_source`) and omits one it does
   (`exclude_from_stats`). The booking-date rule `assertBookable` (`src/server/booking-rule.ts`, #661)
   is not mentioned although `createTransaction` and `updateTransaction` call it first. The Quota
   section's "not metered" is right for these writes but silent about the `transactions` plan metric
   (free plan 5 000) and its declared owner, `QUOTA_METRIC_OWNERS.transactions` in `src/lib/plans.ts:97`,
   which names `src/server/fns/import-mapping.ts — commitImport`; `commitImport` exists nowhere in
   `src` (`grep -rn commitImport src` finds only that string), and the only `assertWithinLimit('transactions')`
   call is the import preview's warning, which says "Enforcement is `19-S3`'s". Plan `19-S3`
   (`docs/plans/19-import.md`, Quota) says enforcement is "per chunk inside the write path" and that
   the importer writes through `createTransaction` "so every … quota check … applies"; `createTransaction`
   calls no `assertWithinLimit`. So today the free-plan ceiling is enforced nowhere, and the plans
   disagree about where it will be (`docs/ARCHITECTURE.md` line 66 shows a third answer, an
   `assertWithinLimit(scope, 'transactions', 1)` inside a write handler).
7. **The stage carries no `Delivered:` line**, so `backlog-status.mjs --plan` keeps offering it.

A stage with unpinned invariants and absent owned paths is not delivered, so it is not marked delivered
today (`afk-plan-to-spec` § 2a). It gets this spec.

## 📝 Proposed Solution

Two phases. Stage `07-S1` is this whole spec.

- **Phase 1 (tests only).** Add the transactions write-path section to
  `src/server/repos/__tests__/tenant-isolation.test.ts`; add
  `src/server/fns/__tests__/transactions.test.ts` for the four handlers; add one small case and one
  comment to `transactions.test.ts` that record why `assertScopedWrite` is a backstop here. No file
  under `src/server` outside `__tests__` changes.
- **Phase 2 (documents).** Amend the `07-S1` block of `docs/plans/07-transactions-core.md` to the code
  (rows 1, 4, 5 and 6 above), state the quota position and its hand-off to `19-S3`, and add the
  `Delivered:` line last, after Phase 1 has merged.

Out of scope, and why: splitting `transactions.ts` into the plan's files (churn across the money write
path for no behaviour, row 1 of the assumptions; a later refactor stays available); an
`assertWithinLimit` in `createTransaction` (a billing-adjacent behaviour change on the
highest-blast-radius write path, `AGENTS.md` Ask First, and contrary to the stage's stated intent, row
2); fixing `QUOTA_METRIC_OWNERS` or `19-S3`'s wording (not this stage's files or plan, row 3); a
`transferId` on the create schema (plan `10` owns transfers); the read functions and the list (`07-S2`);
the entry form (`07-S3`); any UI.

## 📝 Architecture

- **Owner module** of the transaction write path stays `src/server/repos/transactions.ts`, and of its
  server functions `src/server/fns/transactions.ts` (`docs/SPEC.md` §6.1, §8). The ledger batch stays
  `src/server/ledger/batch.ts`. Nothing moves.
- **Seams the tests use, not new ones.** The isolation section uses the two-workspace world of
  `budget-harness.ts` (`createBudgetWorld`, `seedCategory`, `seedTransaction`), which the budgets
  section of the same file already uses, plus a direct `payees` insert as the file already does. The
  handler test uses the mocking technique of `attachments.test.ts` (`createServerFn` replaced by a
  builder that returns the handler with the validator still running; `requireOrg` returning the
  world's scope; `cloudflare:workers` mocked) and drives the real `setLedgerBatchPorts` with a fake
  namespace, the seam `batch.test.ts` uses.
- **Why the handler test is a handler test.** The repository cannot know whether its caller opened a
  batch; the wrapper is the only thing that makes a write enqueue a rebuild, so the only place the
  wrapper can be pinned is the handler.
- **`assertScopedWrite` on these writes.** Because the id predicate is always present, a collapse is
  unreachable through the exported API (row 5). The spec keeps the assertion, tests the precondition
  of the argument (`applyPolicies` of an all-`include` set is the empty list, so the id predicate is
  the only thing scoping the statement, and the tenant filter still stands), and records the reasoning
  in the plan and in a test comment. It does not fabricate a predicate list to make the assertion fire
  (a test of a list the code never builds), and it does not change `updateTransaction` or
  `deleteTransaction` so that the list the assertion sees is the caller-composed part only (a change to
  the money write path to satisfy a test).

## 📝 Data Model

No schema change and no migration. `transactions` exists from `00-S5`; `drizzle/` is not touched and
`pnpm db:generate` must leave the diff clean. Stated so nobody looks for one.

## 📝 API Contracts

No contract changes. The shapes this spec pins, as they are today:

```ts
// src/server/fns/transactions.ts - unchanged
getTransaction // GET  { transactionId, policies }
createTransaction // POST { policies, input: createTransactionSchema }        in runWithLedgerBatch
updateTransaction // POST { transactionId, policies, patch: updateTransactionSchema } in runWithLedgerBatch
deleteTransaction // POST { transactionId, policies }                         in runWithLedgerBatch
```

- **Zod.** `amountMinor` positive integer, `bookedOn` ISO date, `z.strictObject` everywhere; the
  handler test asserts the refusals listed in step 3, and that none reaches `requireOrg` or the
  database.
- **Authorisation.** `requireOrg()` in every handler; no workspace id is accepted from the client, and
  the test sends `organizationId` to prove the strict schema refuses it.
- **Money.** No amount is computed or changed by this spec. The tests supply integer minor units and
  compare to hand-computed integers; no float arithmetic.

## 📝 UI/UX

None. No route, component, state or token. The list and the entry form are `07-S2` and `07-S3`.

## 📝 Edge Cases & Failure Scenarios

- **A refused write enqueues nothing.** A handler call that raises `NotFoundError` (a foreign
  account) must leave the batch empty and the fake namespace untouched; the test asserts zero fetches.
- **A move between accounts.** `updateTransaction` with a new `accountId` enqueues two rebuilds, one
  per account, once each.
- **A patch aimed across the boundary.** A's own row patched to B's account, then to B's payee, then to
  B's category: each is `NotFoundError` and A's row is byte-identical afterwards (the whole row, not
  one column).
- **A workspace B row compared whole.** After every hostile call B's complete `transactions` rows and
  B's `account_balances`-adjacent state are re-read; the test snapshots `transactions` for `org-b`
  with `select()` and compares with `toEqual`, because a write that matched no row but changed one
  anyway is the failure a return-value assertion misses (the budgets section's own rule).
- **A handler that loses its wrapper.** The test fails: a create that returns normally with zero
  rebuilds enqueued is the regression it exists to catch.
- **`transferId` and its siblings.** `createTransaction` with `transferId`, `transferKind`,
  `refundLinked`, `importBatchId`, `importSourceHash`, `categorizationSource`, `organizationId` or
  `createdByUserId` is a schema rejection; the row count does not move.

## 📝 Risks & Impact Review

- **Narrowing or deleting a test** is Ask First. This spec adds tests and one comment, and removes or
  loosens none. The `@ts-expect-error` lines already in `transactions.test.ts` stay; the new files add
  no `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip`, `.only`, `.todo` or `.fixme`.
- **A test that mocks the framework** is a sanctioned exception for the `server` project
  (`vitest.config.ts` comment; `attachments.test.ts` was the first). The new file follows it and adds
  no other mock of repository code: the database is a real SQLite built from `drizzle/*.sql`.
- **The plan amendment is the only change a later stage reads.** `10-S1`, `11-S1`, `13`, `19-S3` and
  `26` cite `07-S1`'s `createTransaction`; Phase 2 keeps every name they cite and corrects only what
  the code never did. Plan `19-S3` is not edited (row 3); its disagreement with the amended Quota
  section is recorded, with the exact lines, in the `07-S1` block so the `19-S3` spec writer meets it.
- **Tenancy.** The change is tests that attack the tenant boundary; they can only fail if the
  boundary is already broken. No production code changes, so there is nothing to widen.
- **Time.** A test that books a row uses fixed dates (`2026-03-15`, the harness `NOW`) and never the
  wall clock; the booking rule (`assertBookable`) is satisfied by a past date, so the new tests do not
  depend on the day they run.

## 📝 Visual change expected

None. This change is tests and plan text; no route or state changes on screen, in light or dark, on
desktop or mobile, and no browser evidence is owed.

## 📝 Copy

None. This change adds no user-facing string, so no key lands in the EN or PL catalogue
(`i18n-messages` skill).

## 📋 Phasing

| Phase | Delivers                                                                                                      | Files                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1a    | The transactions write-path isolation section; the `applyPolicies` precondition case and the backstop comment | `src/server/repos/__tests__/tenant-isolation.test.ts`, `src/server/repos/__tests__/transactions.test.ts` |
| 1b    | The four handlers run: ledger wrapper, strict-schema refusals, no workspace id from the client                | `src/server/fns/__tests__/transactions.test.ts`                                                          |
| 2     | The `07-S1` block amended to the code, the quota hand-off to `19-S3`, and the `Delivered:` line               | `docs/plans/07-transactions-core.md`                                                                     |

Three tickets; 1a and 1b touch disjoint files. The slicer may merge 1a and 1b into one pull request.
Phase 2 depends on 1a and 1b (it cites them); if the slicer merges all three into one pull request,
step 8 says what to do.

## 📋 Implementation Plan

### Phase 1a

1. **Write the section first** (`tdd` skill). In `src/server/repos/__tests__/tenant-isolation.test.ts`
   add `describe('the transaction write path cannot reach or be aimed across a workspace boundary')`
   after the budgets section, using `createBudgetWorld()` (its `scope` is A, `otherScope` is B) and
   `seedCategory` / `seedTransaction` for B (`organizationId: 'org-b'`, `accountId: 'acc-b'`), plus a
   `payees` insert for each workspace as the file's later sections do. The calls are the real
   `createTransaction`, `updateTransaction`, `deleteTransaction`, `getTransaction` and `findTransaction`
   from `../transactions` with a `policies` object written out in full (the all-`include` set) and a
   `ConversionContext` whose resolver answers `null` (every row is PLN, the identity case, so no rate
   is asked for). Cases:
   - _reads_: `getTransaction` on B's id is `NotFoundError`; `findTransaction` is `null`; B's row is
     really there through B's scope, so the refusal is isolation and not an empty fixture.
   - _writes by id_: `updateTransaction` and `deleteTransaction` on B's id are `NotFoundError`.
   - _foreign parents on create_: `createTransaction` with B's `accountId`, then B's `categoryId`, then
     B's `payeeId` (valid own account) is `NotFoundError` each time and writes no row.
   - _foreign parents on update_: A's own row patched with B's `accountId`, B's `categoryId`, B's
     `payeeId` is `NotFoundError` each time.
   - _nothing moved_: after the whole group, `select()` of `transactions` where `organization_id =
'org-b'` equals the snapshot taken before (the whole row, every column), the count of A's rows
     equals the count before the hostile calls plus the one fixture row of its own, and A's patched
     row is `toEqual` to its pre-patch self.
   - _the error discloses nothing_: the `NotFoundError` thrown for B's id has the same `entity` and
     `code` as for an id that exists nowhere (the file's "the failure a read produces discloses nothing
     about the row" rule), so the response does not confirm B's row.
   - _the strict schema is the tenant column's door_: `createTransactionSchema.safeParse` of a payload
     carrying `organizationId: 'org-b'` fails (the repository stamps the tenant from the scope, so the
     key must not exist), and so does one carrying `transferId`; this is the plan's "B's `transfer_id`"
     case in the only form it can now take.
2. **In `src/server/repos/__tests__/transactions.test.ts`** add, to the file's `parent authorisation`
   or `updating` describe, one case: `applyPolicies` of the all-`include` set is the empty list, and
   an `updateTransaction` / `deleteTransaction` of a row of A's under that set still touches only that
   row of A's (B's row count unchanged). Above the two writes' `assertScopedWrite` mention, a comment
   in the test states why the assertion cannot be driven through the exported API (the id predicate is
   always in the list) and where the backstop is pinned (`tenant-isolation.test.ts`, "the write
   backstop"). No existing case is edited.
3. **Run the section alone** (`pnpm vitest run src/server/repos/__tests__/tenant-isolation.test.ts
src/server/repos/__tests__/transactions.test.ts`), then the gate (step 9). The new cases should pass
   against today's code; to prove they bite, break the tenant predicate on a scratch copy of
   `updateTransaction` locally and see the section fail, then revert (never commit that).

### Phase 1b

4. **Write `src/server/fns/__tests__/transactions.test.ts`** with the mocking technique of
   `attachments.test.ts` (`vi.mock('@tanstack/react-start')` with the builder that keeps the validator,
   `vi.mock('#/server/auth/guards')` returning the world's scope, `vi.mock('cloudflare:workers')` as
   that file does) over `createBudgetWorld()`. Install `setLedgerBatchPorts({ namespace: () => fake })`
   in `beforeEach` with a fake `LedgerNamespace` that records the account id of each rebuild request
   (`idFromName` / `get().fetch`, as `batch.test.ts` does) and `setLedgerBatchPorts(null)` in
   `afterEach`. Cases:
   - _create enqueues exactly one rebuild, for its account_: two `createTransaction` handler calls in
     one `runWithLedgerBatch` are not what a request does; one call, one rebuild for `acc-a`.
   - _update across accounts enqueues one per account_: a row moved from `acc-a` to a second account of
     A's enqueues exactly two rebuilds, once each.
   - _delete enqueues one rebuild for the row's account_.
   - _a refused write enqueues nothing_: `createTransaction` with B's `accountId` raises
     `NotFoundError` and the fake saw zero requests.
   - _the validator refuses before anything runs_: for each of a negative `amountMinor`, a fractional
     one, a `bookedOn` that is not a date, `policies` missing, `policies` with one field missing, and
     the extra keys `organizationId`, `transferId`, `transferKind`, `refundLinked`, `importBatchId`,
     `importSourceHash`, `categorizationSource`, `createdByUserId` the handler rejects, `requireOrg` was
     not called (a spy on the mocked guard) and the `transactions` row count did not move.
   - _`getTransaction` is read-only_: it enqueues nothing and returns the row under the policies sent.
5. **Do not mock repository code.** The handler runs the real `createTransactionRow` over the real
   SQLite; `conversionContextFor` reads the world's `organization_currencies` and `exchange_rates`
   (the base is PLN and every fixture is PLN, so no rate is read; if a case uses EUR, seed the one
   `exchange_rates` row it needs rather than stubbing the resolver).
6. **Run** `pnpm vitest run src/server/fns/__tests__/transactions.test.ts`, then the gate (step 9).
   Prove the wrapper test bites the same way as step 3: remove the `runWithLedgerBatch` wrapper from one
   handler locally, see that case fail, revert.

Tenant-isolation test: steps 1 and 2 are the stage's, in the file the rule names. Money invariant:
unchanged, cases 1 to 7 of `money-invariants.test.ts` already hold the stage's seven; no new write path
is added, so no further case.

### Phase 2

7. **Amend the `07-S1` block** of `docs/plans/07-transactions-core.md`, sweeping the whole block so no
   plan-only name survives (every `###` heading of the template stays, `98-verification-protocol.md`
   §1):
   - _Owned paths_: `src/server/repos/transactions.ts` (policies, `computeRefAmount`, writes, schemas),
     `src/server/fns/transactions.ts`, `src/server/repos/__tests__/transactions.test.ts`,
     `src/server/repos/__tests__/money-invariants.test.ts`,
     `src/server/repos/__tests__/tenant-isolation.test.ts` (the write-path section) and
     `src/server/fns/__tests__/transactions.test.ts`; drop the three absent paths with one sentence on
     why (one module; 26 importers; the split is a later refactor, not a deliverable).
   - _Data and migration_: the "Columns written here" list becomes the columns `createTransaction`
     writes, with `exclude_from_stats` added; the other six are named as written by plan `08`, `10`
     and `19` through their own functions. Add one sentence that `assertBookable` (the booking-date
     rule) runs first on create and on update.
   - _Server_: `applyPolicies(policies)` returns predicates; `computeRefAmount(input, conversion)` with
     `ConversionContext` from `conversionContextFor(scope)`; the read function is `getTransaction` /
     `findTransaction`; the `assertScopedWrite` bullet states the id-predicate reasoning of row 5.
   - _Tenant isolation test_: the section of step 1, with the `transfer_id` case restated as the
     strict-schema refusal and the sentence that transfer parenting is `10-S1`'s.
   - _Money invariant_ and _Verification_: the seven cases keep their wording; the `assertScopedWrite`
     "fires on a collapsed list" line is replaced by the backstop-and-precondition pair of steps 1 and
     2; the verification names the two new test files; the `ref-amount.test.ts` line points at the
     `computeRefAmount` cases in `transactions.test.ts` and section 7 of `money-invariants.test.ts`.
   - _Quota_: two sentences. `createTransaction` is unmetered, for manual entry and for the recurring
     auto-recorder; the `transactions` metric of `src/lib/plans.ts` (free plan 5 000) applies to import
     only and is `19-S3`'s to enforce. Then the hand-off, as plain facts for the `19-S3` spec writer:
     `QUOTA_METRIC_OWNERS.transactions` names `commitImport`, which does not exist; the import preview
     only warns; `docs/plans/19-import.md` Quota says "inside the write path" and that the importer
     writes through `createTransaction`, which checks no quota, so `19-S3` must either check per chunk
     in the importer or this stage's position must change by a decision of its own.
   - Change nothing outside the `07-S1` block (not `07-S2`, `07-S3`, not `19-import.md`, not
     `docs/plans/README.md`).
8. **Add the `Delivered:` line** directly under `## Stage 07-S1`:
   `Delivered: <YYYY-MM-DD> - <evidence>`, dated the day Phase 2 is written, naming the paths of step 7,
   the Phase 1 pull requests, and the counts read from commands run in that pull request
   (`pnpm vitest run` of the four files; the numbers at spec time were 37, 67 and the two new files').
   If the slicer merged the phases into one pull request, name the paths and tests and add the pull
   request number in a final commit once it is known.
9. **Run the gate** on the staged tree, in the order printed by
   `node -e "require('./.ai/agentic.config.json').validation.commands.forEach(c=>console.log(c))"`,
   plus `pnpm exec prettier --check docs/plans/07-transactions-core.md` and the changed test files.
   Wait on `pnpm test` with `timeout: 600000` and its output in a file.

## 📝 Resolved assumptions (autonomous defaults)

Every row is a decision this run made without a human, or a default it applied. Each is reversible
before merge by saying so on the spec PR.

| #   | Question                                                                                           | Applied default                                                                                                                                                                                                                                                                                                                                                         | Why                                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Split `transactions.ts` to the plan's `transaction-policies.ts` and `ref-amount.ts`?               | **No. Keep the module; Phase 2 amends the plan's owned paths and signatures to the code.**                                                                                                                                                                                                                                                                              | Decided by the software architect sub-agent (confidence medium): `computeRefAmount` and `ConversionContext` are used by six other files and the module is imported by 26, so a split is pure churn in the money write path; the 03-S1 and 05-S2 precedents amended the plan to the code. |
| 2   | Meter `createTransaction` with `assertWithinLimit('transactions')`?                                | **No. Manual entry and recurring auto-record stay unmetered; the `transactions` ceiling is import-only.**                                                                                                                                                                                                                                                               | Decided by the product owner sub-agent (confidence medium): keeps the plan's stated intent, avoids a billing change on the highest-blast-radius write path (Ask First), and is fully reversible because `19-S3` can add a check later.                                                   |
| 3   | Fix `QUOTA_METRIC_OWNERS.transactions` and plan `19-S3`'s "inside the write path" wording?         | **Not here. Phase 2 records the facts in the `07-S1` Quota section; no other stage's plan or `plans.ts` is edited.**                                                                                                                                                                                                                                                    | Decided by the product owner and the software architect sub-agents: the pointer and the wording belong to `19-S3` (and plan `22`); this spec edits no other stage. The facts are written where the `19-S3` spec writer will meet them.                                                   |
| 4   | Pin the plan's "`assertScopedWrite` fires on a collapsed list" for transactions?                   | **No fabricated list and no code change. Test the precondition (`applyPolicies` of all-`include` is empty, the id predicate scopes the statement), add a comment, and record the reasoning in the plan.**                                                                                                                                                               | Decided by the software architect sub-agent (confidence medium): a test of a list the code never builds proves nothing, and changing the money write path to satisfy a test is the wrong direction; the backstop is already pinned at the base ("the write backstop").                   |
| 5   | Add the isolation section to `tenant-isolation.test.ts` although `transactions.test.ts` has cases? | **Yes: the file `AGENTS.md` names, asserting B's whole rows unchanged and A's patch to B's parents.**                                                                                                                                                                                                                                                                   | Decided by the software architect sub-agent: a standing `AGENTS.md` obligation, and the existing cases assert only the error and one column.                                                                                                                                             |
| 6   | Treat the stage as delivered (mark it) or give it a spec?                                          | **A spec for what is left.**                                                                                                                                                                                                                                                                                                                                            | Decided by the software architect and product owner sub-agents: item 2 of the problem is a standing rule the stage has not met, and three owned paths are absent; § 2a marks only what the evidence proves.                                                                              |
| 7   | Does Phase 2 add the `Delivered:` line, and when?                                                  | **Yes, as its last step, after Phase 1 has merged.**                                                                                                                                                                                                                                                                                                                    | A marker nothing re-checks must follow the evidence it cites (`afk-plan-to-spec` § 2a); the 03-S1 and 05-S2 specs do the same.                                                                                                                                                           |
| 8   | Does the handler test mock repository code?                                                        | **No. Only the framework seams (`createServerFn`, `requireOrg`, `cloudflare:workers`), as `attachments.test.ts` does.**                                                                                                                                                                                                                                                 | A mocked repository would agree that the wrapper is present whether or not it is; the point is the real write under the real batch.                                                                                                                                                      |
| 9   | Which numbers in this spec are measured?                                                           | `826` lines, `37` and `67` tests (104 together, one run), `26` importers, `6` users of `computeRefAmount`, `5 000` free-plan ceiling.                                                                                                                                                                                                                                   | Read from the commands below, run while writing this spec at HEAD `1e6d8ab`.                                                                                                                                                                                                             |
| 10  | Product owner: approve this spec?                                                                  | **Round 1: approve with conditions, applied** (stray `account_balances` phrase dropped; `loadTransactions` named as `07-S2`'s and left out; `acc-a-hidden` named; the quota hand-off made findable from `19-S3`).                                                                                                                                                       | Decided by the product owner sub-agent (confidence medium): the right slice, no production change, deferrals cited.                                                                                                                                                                      |
| 11  | Software architect: approve this spec?                                                             | **Round 1: approve with conditions, applied** (`env` mock and port override stated; garbled first case reduced; circular count replaced; row 9 table repaired; step 8 wording; `NotFoundError` compared on `entity` and `code` only).                                                                                                                                   | Decided by the software architect sub-agent (confidence high): respects `docs/SPEC.md`, owner modules named, harness supports both phases, three tickets.                                                                                                                                |
| 12  | Security and tenancy reviewer: approve this spec?                                                  | **Round 1: approve with conditions, applied** (disclosure check extended to the three parents; positive controls; whole-row snapshots of `transactions`, `accounts`, `categories`, `payees`; two handler cases for a rejecting `requireOrg` and for update and delete on B's id; the Quota wording made a statement of fact with `docs/ARCHITECTURE.md` line 66 named). | Decided by the security and tenancy reviewer sub-agent (confidence medium): tests only, no production change, no guarantee weakened; no `ESCALATE`.                                                                                                                                      |

The commands behind row 9:

```bash
wc -l src/server/repos/transactions.ts
pnpm vitest run src/server/repos/__tests__/transactions.test.ts       # Tests  37 passed
pnpm vitest run src/server/repos/__tests__/money-invariants.test.ts   # Tests  67 passed
{ grep -rl "#/server/repos/transactions'" src --include='*.ts' --include='*.tsx'; \
  grep -l "from '\./transactions'" src/server/repos/*.ts; } | grep -v '__tests__\|\.test\.' | sort -u | wc -l
grep -rl computeRefAmount src --include='*.ts' --include='*.tsx' | grep -v '__tests__\|\.test\.' | grep -v repos/transactions.ts
grep -n "transactions: 5_000" src/lib/plans.ts
```
