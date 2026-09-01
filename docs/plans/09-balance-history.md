# 09 — Balance history

## Area brief

The daily balance grid, and the algorithm that produces it. This is the plan `docs/MONEY.md` §5 was
written for, and it is the one place in the product where getting the _shape_ of the computation
wrong produces numbers that look plausible and are catastrophically false.

**Balance history is a rebuild, not an accumulator.** `balance[day D] = native units held on D ×
rate on D`. Accumulating converted amounts produces the failure recorded in `docs/MONEY.md` §8: a
year-long gap followed by a small transaction posts a one-day five-figure loss with no transaction
behind it, and a natively-zero account shows a five-figure balance.

Three mechanisms make it safe: the rebuild is **whole-history and idempotent**; writes are
**serialised per account by the `LEDGER` Durable Object**; and a **nightly sweep** rebuilds every
qualifying account, healing any write path that forgot.

---

## Stage 09-S1 — The snapshot store and the rebuild algorithm

### Stage id

`09-S1` · Wave 2 · effort **XL**.

### Reference rows

`BAL-01 missing → done` — the `account_balances` repository with the sparse-output rule.
`BAL-02 missing → done` — `rebuildBalanceHistory` with its grid bounds and UTC bucketing.
`BAL-03 missing → done` — `isRevaluedAccount` and the revaluation path.

### Owned paths

- `src/server/repos/balance-history.ts` — new
- `src/server/ledger/rebuild.ts` — new
- `src/server/ledger/grid.ts` — new
- `src/server/ledger/__tests__/rebuild.test.ts` — new
- `src/server/ledger/__tests__/grid.test.ts` — new
- `src/server/repos/__tests__/balance-history.test.ts` — new

### Data and migration

`account_balances` exists from `00-S5`: PK `(organization_id, account_id, date)`, `native_minor
integer`, `ref_minor integer`, `rate_e10 integer`. No schema change.

**The table is sparse by design.** A day whose value repeats the previous day's is **omitted**. The
first day of the grid and today always survive, so a reader always has both ends. Forward-fill
happens on read, and only on read.

### Server (repo, server function, Zod)

- **Repository.** `balance-history.ts`: `getSeries({ accountId, from, to })` (forward-filling on
  read), `getSeriesForAccounts`, `replaceRange({ accountId, from, to, rows })` — the only write, and
  it is **delete-range + insert in one D1 `batch`**.
- **`grid.ts`** computes the bounds, and each bound has a reason:
  - **start** = `min(today, the day before the first transaction, the oldest existing snapshot)`.
    The day before the first transaction is where `initial_balance` lives; without it the opening
    balance has nowhere to be.
  - **end** = `max(today, the last transaction date)`. Future-dated transactions are valued too,
    because a planned transaction next month is part of the projection people look at.
  - The walk is **UTC day buckets**, exactly as `docs/MONEY.md` §6 requires, and the person's
    timezone is applied only at render.
- **`rebuild.ts`** exports `rebuildBalanceHistory({ accountId, scope })`, which **always rebuilds the
  whole history**, never a slice, and returns `'rebuilt' | 'skipped'`. Whole-history is what makes it
  idempotent and is what makes a missed rebuild recoverable by the nightly sweep.
  - `isRevaluedAccount(a)` = `a.currency_code !== org.base_currency_code`. A base-currency account's
    `ref_minor` equals its `native_minor` at every point, with `rate_e10 = 1e10`, and no rate lookup
    happens at all.
  - For a revalued account, each day's `ref_minor` = `native_minor × rate(day)` — **the rate of that
    day**, resolved through `03-S3`'s `resolveRate`. A day with no rate available forward-fills the
    last known rate and **records that it did** via `source` on the row, rather than skipping the day.
  - `replaceRange` is delete-then-insert because **a day the rebuild no longer emits must not
    survive**: forward-fill on read would treat a stale row as a real measurement.
- **Server function.** None user-facing; `17-S1` reads the series and `06-S2` renders it.
- **Zod.** `z.strictObject({ accountId, from: z.iso.date(), to: z.iso.date() })` on the read.
- **Authorisation.** `requireOrg()` at every caller; the repository is tenant-scoped.
- **Ledger batching.** This stage is the _target_ of the batch, not a user of it. The `LEDGER` DO that
  serialises `replaceRange` is `09-S2`; until it lands, `rebuild.ts` calls `replaceRange` directly
  and `rebuild.test.ts` carries a case asserting the direct path is used **only** in tests.

### UI (route, components)

- **Route.** None. The history tab is `06-S2`'s surface and the charts are plan `16`.
- **Components.** None.
- **States.** Not applicable.
- **Tokens.** None.
- **Accessibility.** None at this layer. What it owes downstream: `getSeries` returns dates and
  amounts as data, so `16-S1`'s visually-hidden table has something exact to render — a chart's text
  equivalent must not be re-derived from pixel positions.

### Quota

Snapshots are **not metered** — they are derived data the person did not choose to create. What they
do consume is D1 storage, and the sparse rule is the control: `docs/ARCHITECTURE.md` §7 states the
ceiling and the sparse rule is what keeps a 15-year, 10-account workspace far from it. A change that
makes the output dense is a cost-model change and needs a `00-foundations.md` conversation, not a
quiet commit.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A, in A's scope, calls `getSeries`, `getSeriesForAccounts` and
`replaceRange` for B's `accountId`. Reads return empty, `replaceRange` is a `NotFoundError`, and B's
snapshots are unchanged. Functions covered: all three.

**Plus:** `rebuildBalanceHistory` in A's scope for B's account is a `NotFoundError` **before** any
delete happens — a rebuild that deletes first and authorises second would destroy B's history even
while failing.

### Money invariant

**This stage is the largest concentration of money invariants in the product.** Cases in
`money-invariants.test.ts`:

- _balance is a rebuild, never an accumulation._ An account with a transaction on day 1, a
  twelve-month gap, and a small transaction on day 400 has **no** spurious movement on day 400 in
  base currency beyond the transaction's own value. This is the recorded failure of
  `docs/MONEY.md` §8 and it is the single most important case in the suite.
- _a natively-zero account reports zero in base on every day_, at any rate.
- _the rebuild is idempotent_: running it twice produces byte-identical rows and the second returns
  `'skipped'` when nothing changed.
- _a day the rebuild no longer emits does not survive_ — delete-range is verified by rebuilding after
  deleting a transaction and asserting the previously-emitted day is gone, not stale.
- _the sparse rule holds_: a run of unchanged days emits one row, and the first and last day of the
  grid are always present.
- _day bucketing is UTC_: a transaction booked on `2026-03-15` lands in the `2026-03-15` bucket
  regardless of the workspace timezone, while the person's `booked_on` default came from their
  timezone (`docs/MONEY.md` §6, both halves asserted in one test so the pair cannot drift).
- _`ref_minor` uses that day's rate, not today's_, and re-running the rebuild after a rate for an old
  day is corrected **does** change that day — this is the one place a historical conversion legitimately
  moves, and it moves because the rate was wrong, not because time passed.
- _no float_: every arithmetic step is integer, and the daily `native × rate` uses `mulRate` with
  half-to-even at the single final step.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `grid.test.ts`: each bound, including an account with only future-dated transactions, an account
  with no transactions at all (grid = `[today - 1, today]`), and an account whose oldest snapshot
  predates its oldest transaction.
- `rebuild.test.ts`: the eight money cases above, plus a 5 000-transaction / 3-year fixture asserting
  the rebuild completes within the Worker CPU budget and emits a sparse row count far below the day
  count.
- `balance-history.test.ts`: forward-fill on read, `replaceRange` as one batch, the isolation cases.
- No browser evidence and no axe run: this stage ships no surface. The chart that renders this data is
  `16-S1` and the history tab is `06-S2`; both cite this stage's fixtures.

### Definition of done

§7 items 1–3, 5 and 6. Item 4 does not apply (no surface).

### Blockers

None.

---

## Stage 09-S2 — The `LEDGER` Durable Object and `runWithLedgerBatch`

### Stage id

`09-S2` · Wave 2 · effort **L**.

### Reference rows

`BAL-04 missing → done` — the `AccountLedger` DO with its lock and dirty bit.
`BAL-05 missing → done` — `runWithLedgerBatch` via `AsyncLocalStorage`.
`BAL-06 missing → done` — the ledger queue handler.

### Owned paths

- `src/server/do/account-ledger.ts` — new
- `src/server/ledger/batch.ts` — new
- `src/server/queue/handlers/ledger.ts` — new
- `src/server/do/__tests__/account-ledger.test.ts` — new
- `src/server/ledger/__tests__/batch.test.ts` — new

### Data and migration

No table. The DO holds **no ledger data** — it holds a lock and a dirty bit and calls back into D1.
That is the whole design (`docs/adr/0010-ledger-durable-object-for-balance-history.md`): D1 has no
interactive transactions and no advisory locks, and a rebuild is delete-range + insert, so two
concurrent rebuilds of one account can interleave into a hole.

The DO class and the `v1` migration tag are declared in `wrangler.jsonc` by `00-S2`; this stage
implements the class those bindings already name.

### Server (repo, server function, Zod)

- **`AccountLedger`**, addressed by `idFromName(accountId)`. Its protocol is two methods:
  `requestRebuild({ organizationId, accountId })` and `status()`.
  - A rebuild request arriving **while a rebuild is running** sets a **dirty bit** and returns
    immediately; it does not queue a second pass. When the running rebuild finishes and the bit is
    set, it clears the bit and runs once more. This coalescing is what keeps an import of 5 000 rows
    from scheduling 5 000 rebuilds.
  - The DO calls back into D1 through the same tenant-scoped repository as everything else. It is a
    lock, not a privileged path.
- **`runWithLedgerBatch(fn)`** uses `AsyncLocalStorage` to collect touched account ids into a `Set`
  and enqueues **one** rebuild per account after `fn` settles — **including when `fn` throws**,
  because the rows are already committed. It is opened at the outermost boundary of every server
  function, every cron body and every queue-handler body. Nesting is a no-op: an inner call joins the
  outer batch rather than starting a second.
- **`src/server/queue/handlers/ledger.ts`** consumes the `ledger.rebuild` envelope, calls the DO, and
  acks. Its idempotency marker in KV is keyed on `(accountId, dirtyGeneration)` so a retried message
  does not force a redundant rebuild.
- **Zod.** The envelope's discriminant and payload are parsed before dispatch.
- **Authorisation.** The queue handler constructs a scope from the envelope's `organizationId` and
  goes through the same repository as a request would.

### UI (route, components)

None.

### Quota

No countable row. The **cost** is DO invocations and queue messages, both bounded by the coalescing
above; `docs/ARCHITECTURE.md` §7 carries the line.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: the ledger queue handler, given an envelope naming B's
`accountId` under A's `organizationId`, rebuilds **nothing** and acks with an error log. A DO
addressed by an account id it does not own must not become a way to write into another tenant's
snapshots. Function covered: the handler's `handleLedgerRebuild`.

### Money invariant

_Two concurrent rebuilds of one account never interleave, and a coalesced rebuild never loses a
write._ Cases in `money-invariants.test.ts`:

- _concurrency_: 20 concurrent `requestRebuild` calls for one account produce a final snapshot set
  identical to a single sequential rebuild, with no missing days.
- _coalescing does not lose a write_: a transaction inserted **after** a rebuild started and before it
  finished is present in the final snapshots, because the dirty bit forces the second pass.
- _a throwing `fn` still flushes the batch_: rows committed before the throw are rebuilt.
- _nesting joins_: a nested `runWithLedgerBatch` enqueues one rebuild per account, not two.

### Verification

- Command gate.
- `account-ledger.test.ts`: the lock, the dirty bit, the coalescing, and the concurrency case above
  run against the DO test harness.
- `batch.test.ts`: the flush-on-throw case, the nesting case, and that a batch with no touched
  accounts enqueues nothing.
- A local `wrangler dev` run showing one rebuild message for a 200-row import, not 200.
- No browser evidence and no axe run: no surface.

### Definition of done

§7 items 1–3, 5 and 6. Item 4 does not apply (no surface).

### Blockers

None.

---

## Stage 09-S3 — The nightly healing sweep

### Stage id

`09-S3` · Wave 2 · effort **M**.

### Reference rows

`BAL-07 missing → done` — the `0 3 * * *` cron branch that revalues every qualifying account.

### Owned paths

- `src/server/cron/nightly-revaluation.ts` — new
- `src/server/cron/__tests__/nightly-revaluation.test.ts` — new

### Data and migration

None.

### Server (repo, server function, Zod)

- The `0 3 * * *` branch (dispatched from `00-S2`'s `scheduled.ts`) runs, **in this order**:
  1. FX rate refresh (`03-S2`) — rates first, so the sweep sees today's.
  2. **This sweep**: for every workspace, for every account where `isRevaluedAccount(a)` is true or
     whose snapshots are older than its newest transaction, enqueue a `ledger.rebuild`.
  3. The other nightly jobs (backup, export prune) — plans `20` and `00-S12`.
- The sweep **enqueues, never rebuilds inline**: a cron invocation has a CPU budget and a workspace
  with 40 accounts would exhaust it. Enqueuing lets the DO's coalescing absorb the burst.
- It iterates **per workspace, constructing a scope per workspace**, and never runs a cross-tenant
  query. The one query that legitimately spans tenants is the workspace list itself, and it lives in
  a platform repository with its own audit expectation.
- **Ledger batching.** The cron body opens `runWithLedgerBatch`, so a sweep that also writes anything
  flushes correctly. In practice it only enqueues.

### UI (route, components)

None.

### Quota

No countable row. The sweep's cost is one queue message per qualifying account per night, which is
the line in `docs/ARCHITECTURE.md` §7 and the reason the qualifying predicate is narrow rather than
"every account".

### Tenant isolation test

Added to `tenant-isolation.test.ts`: the sweep, run against a fixture with workspaces A and B, emits
envelopes whose `organizationId` always matches the `accountId`'s owner. A single mismatched pair is a
failure. Function covered: `runNightlyRevaluation`.

### Money invariant

**This sweep is the product's self-healing property, and the invariant is that it is not needed for
correctness on the happy path but always restores it.** Cases:

- _the sweep is a no-op on a healthy workspace_: after a clean rebuild, running the sweep produces
  byte-identical snapshots and `'skipped'` for every account.
- _the sweep heals a skipped rebuild_: delete an account's snapshots directly, run the sweep, and the
  snapshots return identical to the pre-delete state.
- _the sweep heals a corrected rate_: correcting a historical rate and running the sweep updates that
  day's `ref_minor` and no other day's.
- _base-currency accounts are not swept unless their snapshots are stale_, so the nightly cost scales
  with foreign-currency accounts rather than with all accounts.

### Verification

- Command gate.
- `nightly-revaluation.test.ts`: the four money cases, the per-workspace scoping, and that the sweep
  enqueues rather than rebuilding inline (asserted on the queue spy and on the absence of any
  `replaceRange` call).
- A local `wrangler dev --test-scheduled` invocation for `0 3 * * *` showing the ordering — rates,
  then sweep — in the structured log.
- No browser evidence and no axe run: no surface.

### Definition of done

§7 items 1–3, 5 and 6. Item 4 does not apply (no surface).

### Blockers

None.
