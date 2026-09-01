# The demo workspace, and the contract that builds it

`seed.mjs` and `verify.mjs` are clients. Neither knows the schema, neither opens the database, and
neither will need editing when a table is renamed. They speak to three HTTP endpoints the Worker
must implement, described here in full.

This file is the interface. The two halves are versioned together and deployed apart — the scripts
run on the host, the endpoints run inside the Worker — so anything not written down here is not
agreed.

---

## Why a seed is a first-class artefact here

Every screen in this product is a photograph of a dataset. The dashboard is a month of rows, the
budget bars are a division, the net-worth chart is eighteen months of balances. There is no
"empty state plus a bit of data" mode where the design can be judged: a fixture that is too small
makes a good layout look sparse, and a fixture that drifts by a day moves every chart.

So the fixture is deterministic in three separate senses, and all three are load-bearing:

1. **Fixed ids.** Every row's primary key comes from the dataset, not from `newId()`. A key the seed
   invented instead of reading is a key that changes on every rebuild, and anything the UI derives
   from an id — a colour, an avatar, a sort order — repaints with it.
2. **Fixed dates.** Every date is an offset from the dataset's anchor day, `2026-08-20`. Nothing in
   the seed path reads a clock.
3. **Fixed amounts.** Integer minor units, and the same ones every time. `verify.mjs` restates the
   counts it expects so a change to the fixture is a change to a committed file rather than a
   silent difference in what the baselines photographed.

The mechanism for (1) and (2) is `withSuppliedRowDefaults(defaults, write)` — the deterministic-clock
and `newId()` override, guarded by `import.meta.env.DEV`, with a source-reading test asserting there
is no second caller. A second caller would make the override a general facility, and a general
facility for forging ids and timestamps is not something this repo wants outside the seed.

---

## The endpoints

All three are mounted under `src/routes/api/internal/seed/`, all three are guarded by
`import.meta.env.DEV` so the production build folds them away, and all three answer
`application/json` and nothing else.

### `GET /api/internal/seed` — probe and status

Answers whether this server can seed, and whether it already has. `seed.mjs` uses it to find the
dev server among a range of ports, so it must be cheap and must never write.

```jsonc
{
  "ok": true, // this is a dev build with the seed path compiled in
  "seeded": true, // a marker row for the current dataset version exists
  "datasetVersion": "mt-demo-1",
  "marker": {
    // null when not seeded
    "datasetVersion": "mt-demo-1",
    "organizationId": "demo-workspace",
    "seededAt": "2026-08-20T00:00:00.000Z",
  },
}
```

`ok: false` (or any non-2xx) means "not a seedable server", and `seed.mjs` moves on to the next port.

### `POST /api/internal/seed` — build the workspace

Query parameters:

| Name    | Meaning                                                                    |
| ------- | -------------------------------------------------------------------------- |
| `email` | Owner address to seed. Defaults to `demo@money-tracker.online`.            |
| `force` | `1` rebuilds from scratch. Absent, an already-seeded workspace is skipped. |

Request headers:

| Header              | Meaning                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `x-mt-server-today` | Pins `serverToday()` for this request. `--today` sends it. Dev-only, as ever. |

Request body:

```jsonc
{ "password": "money-demo-2026", "keepPassword": false }
```

The password is in the body rather than the query string so it stays out of request logs. The
handler reconciles the owner's credential **before** the marker check, so a warm run that writes no
data still leaves the demo account signable-in — that is the run people make most often.

Response, HTTP 200:

```jsonc
{
  "ok": true,
  "skipped": false, // true when already seeded and --force was not passed
  "datasetVersion": "mt-demo-1",
  "organizationId": "demo-workspace",
  "ownerEmail": "demo@money-tracker.online",
  "ownerUserId": "demo-user-owner",
  "createdOwner": false,
  "credential": "unchanged", // "created" | "reset" | "unchanged" | "kept"
  "baseCurrency": "PLN",
  "anchorDate": "2026-08-20",
  "counts": {/* see the table below */},
  "dateSpan": { "earliest": "2025-02-20", "latest": "2026-11-20" },
  "durationMs": 4211,
}
```

On `skipped: true` only `datasetVersion`, `organizationId`, `ownerEmail`, `createdOwner` and
`credential` are required; the rest may be omitted.

A failure answers a non-2xx with `{ "ok": false, "error": "<one line>" }`. `seed.mjs` prints the
error verbatim and exits 1.

### `GET /api/internal/seed/summary` — counts and invariants

The whole of `verify.mjs`, and the assertion the sandbox e2e smoke test makes. Read-only.

```jsonc
{
  "ok": true,
  "datasetVersion": "mt-demo-1",
  "anchorDate": "2026-08-20",
  "baseCurrency": "PLN",
  "counts": {/* the same shape POST returns */},
  "dateSpan": { "earliest": "2025-02-20", "latest": "2026-11-20" },
  "invariants": {
    "transferPairsBalanced": { "checked": 24, "violations": 0 },
    "splitsSumToParent": { "checked": 40, "violations": 0 },
    "fxRowsCarryRate": { "checked": 137, "violations": 0 },
    "accountBalancesMatchLedger": { "checked": 5, "violations": 0 },
    "amountsAreIntegers": { "checked": 600, "violations": 0 },
    "plannedRowsAreFuture": { "checked": 30, "violations": 0 },
    "everyTransactionHasCategory": { "checked": 600, "violations": 0 },
  },
  "transactions": 600, // convenience mirror of counts.transactions, for a one-line curl
}
```

`checked` is required and is not decoration: `verify.mjs` fails an invariant that reports zero
violations over zero rows. A check that has lost its subject is how a fixture rots without anybody
noticing, and it looks exactly like a passing check unless the count is published.

---

## The dataset

Anchor day `2026-08-20`. History runs eighteen months back from it; planned rows run three months
ahead of it, so `dateSpan` is `2025-02-20 → 2026-11-20`.

Base currency **PLN**. Two more appear on accounts and transactions — **EUR** and **USD** — so every
screen exercises the base-currency boundary rather than the happy path.

| Counter               | Value | What it is for                                                                        |
| --------------------- | ----: | ------------------------------------------------------------------------------------- |
| `accounts`            |     5 | current, savings, credit card, cash, one foreign-currency account                     |
| `accountGroups`       |     2 | so the grouped list and the group tree both have something to render                  |
| `currencies`          |     3 | PLN base, EUR, USD                                                                    |
| `categories`          |    12 | two levels: 4 parents, 8 children                                                     |
| `payees`              |    20 | with `payeeAliases` for the import matcher to resolve                                 |
| `payeeAliases`        |    28 |                                                                                       |
| `tags`                |     8 |                                                                                       |
| `transactions`        |   600 | the whole span, every kind below included in the count                                |
| `transferPairs`       |    24 | 48 of the 600 rows: both legs of a double-entry transfer                              |
| `splitTransactions`   |    40 | parents carrying `splitRows` children                                                 |
| `splitRows`           |   104 |                                                                                       |
| `refundLinks`         |    12 | a refund pointing at the expense it refunds                                           |
| `plannedTransactions` |    30 | dated after the anchor, so the upcoming rail is never empty                           |
| `budgets`             |     3 | one of them rolling, so the rollover ledger has rows                                  |
| `budgetPeriods`       |    27 |                                                                                       |
| `recurringSeries`     |     4 | mixed period states: paid, due, overdue, skipped                                      |
| `recurringPeriods`    |    48 |                                                                                       |
| `goals`               |     2 | one on track, one behind, so the projection reads differently on each                 |
| `rules`               |     6 | enough to fill the reorderable list and exercise the live preview                     |
| `importBatches`       |     1 | completed, with `importRows` behind it and a duplicate among them                     |
| `importRows`          |   120 |                                                                                       |
| `attachments`         |     6 | receipts on transaction detail                                                        |
| `notifications`       |     9 | read and unread, across scopes                                                        |
| `members`             |     2 | the owner and one household member, so shared-workspace screens are not single-seated |

`verify.mjs` restates every number in that table. They move together or the run goes red.

---

## Using it

```bash
pnpm exec vite dev --port 3010 --strictPort --host   # in one shell
node scripts/seed/seed.mjs --url http://localhost:3010
node scripts/seed/verify.mjs --url http://localhost:3010
```

Inside a sandcastle sandbox `.sandcastle/setup-e2e.sh` does all three, in that order, and refuses to
continue when `verify.mjs` exits non-zero.

Sign in as `demo@money-tracker.online` with the password `money-demo-2026` — a committed fixture
credential for a local database, overridable with `DEMO_PASSWORD` or `E2E_PASSWORD`.

`seed.mjs` deletes `e2e/.auth/demo.json` on every successful run. A cached session outlives a
rebuild and points at a membership that no longer exists, which shows up as a 500 on the first
authenticated route rather than as anything that names the cause.

## Proving the fixture has no clock in it

```bash
node scripts/seed/seed.mjs --force --today 2025-01-01 && node scripts/seed/verify.mjs
node scripts/seed/seed.mjs --force --today 2027-06-30 && node scripts/seed/verify.mjs
```

Both must produce the same counts and the same `dateSpan`. If they do not, something in the seed
path read `new Date()` instead of the anchor, and every visual baseline recorded since is a
photograph of whatever day it happened to be.
