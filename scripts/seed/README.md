# The demo workspace

`seed.mjs` builds it, `verify.mjs` checks it. Both work directly against the database through
`wrangler d1 execute`.

> **This file used to specify three HTTP endpoints under `/api/internal/seed/`.** They were never
> written. The contract was drafted before the schema existed, and it outlived the uncertainty that
> justified it — by the time the schema landed, re-deriving it as three dev-only routes plus a
> deterministic-id override facility bought nothing that talking to D1 directly does not. Both
> scripts were rewritten against the real schema; this file now describes what they actually do.

---

## Why a seed is a first-class artefact here

Every screen in this product is a photograph of a dataset. The dashboard is a month of rows, the
budget bars are a division, the net-worth chart is eighteen months of balances. There is no
"empty state plus a bit of data" mode where the design can be judged: a fixture that is too small
makes a good layout look sparse, and a fixture that drifts by a day moves every chart.

So the fixture is deterministic in three separate senses, and all three are load-bearing:

1. **Fixed ids.** Every row's primary key comes from the dataset (`demo-acc-1`, `demo-tx-0417`,
   `demo-xfer-007-out`), never from `newId()`. A key the seed invented is a key that changes on
   every rebuild, and anything the UI derives from an id — a colour, an avatar, a sort tiebreak —
   repaints with it. The `demo-` prefix is also how a re-run finds last run's rows, wherever they
   ended up.
2. **Fixed dates.** Every date is an offset from the anchor day. `new Date()` appears nowhere in
   the dataset half of `seed.mjs`.
3. **Fixed amounts.** Integer minor units from a seeded PRNG with a constant seed, so the hundredth
   transaction is the same hundredth transaction on every machine. **Labels draw from a second
   generator**, so changing which rows carry a tag cannot move a single figure in the ledger.

The one thing that is **not** fixed is the organization id: it belongs to the account the auth layer
provisioned, so it is read back rather than invented.

---

## How it runs

Two halves, and the split is deliberate.

**1. The owner, through the real sign-up endpoint.** `POST /api/auth/sign-up/email`, so the
credential is hashed by Better Auth exactly as a real sign-up would hash it and the workspace is
provisioned by the real `user.create.after` hook. Re-implementing either here would be a second,
drifting copy of the sign-up path, and the first thing it would get wrong is the password hash —
which fails as "cannot sign in" with no explanation.

This is the only step that needs the dev server, and it only runs when the account is actually
missing: the database is asked first. Sign-up is rate-limited like any public endpoint, so a seed
that always POSTs is a seed that fails with `429` right after somebody has been clicking through the
auth screens — which is exactly when the seed gets reached for.

**2. The finance rows, as one SQL file** through `wrangler d1 execute`. Pure data with no behaviour
to exercise, inspectable before it runs, and one statement batch where six hundred HTTP round trips
would not be atomic.

```bash
pnpm dev                                    # in one shell, port 3010
node scripts/seed/seed.mjs                  # build it
node scripts/seed/verify.mjs                # check it
```

Both take `--db <name>` and `--remote`; `seed.mjs` also takes `--url <origin>` (default
`http://localhost:3010`). Sign in as `demo@money-tracker.online` with `money-demo-2026` — a
committed fixture credential for a local database, overridable with `DEMO_PASSWORD` or
`E2E_PASSWORD`.

`seed.mjs` finishes by _verifying_ that credential rather than assuming it. If the account already
exists with a different password — which happens after manual testing — it says so and prints the
one command that resets it, instead of printing a credential that returns 401.

---

## The dataset

Anchor day **`2026-09-30`**, eighteen months of history back from it and three months of planned
rows forward. Base currency **PLN**, with **EUR** and **USD** on accounts and transactions so every
screen exercises the base-currency boundary rather than the happy path.

| Counter              |  Value | What it is for                                                        |
| -------------------- | -----: | --------------------------------------------------------------------- |
| `accounts`           |      5 | current, savings (USD), credit card, cash, one foreign-currency (EUR) |
| currencies           |      3 | across those accounts: PLN base, EUR, USD                             |
| `accountGroups`      |      2 | so the grouped list and the group tree both have something to render  |
| `categories`         |     13 | two levels: 4 parents, 9 children, and every one of them is used      |
| `payees`             |     20 | ordinary Polish high-street names                                     |
| `payee_aliases`      |     10 | the statement strings the import matcher resolves to those payees     |
| `tags`               |      8 | on ~44% of the ledger, so no tag filter opens empty                   |
| `transactions`       |    624 | 600 settled + 24 planned                                              |
| internal transfers   |     58 | 116 legs, covering all four of `docs/MONEY.md` §4.2's cases           |
| `transaction_splits` |     11 | across 5 receipts                                                     |
| `refunds`            |      3 | full, partial, and one narrowed to a single split line                |
| `savings_goals`      |      2 | one still saving, one reached                                         |
| `recurring_series`   |      3 | 51 periods across all four statuses, 48 links                         |
| `rules`              |      2 |                                                                       |
| `import_batches`     |      1 | completed, with its imported rows stamped and countable               |
| `account_balances`   | ~510\* | the daily grid, sparse, across the whole span for all five accounts   |
| `budgets`            |      3 | one of them rolling                                                   |
| `budgetPeriods`      |     27 |                                                                       |
| `exchangeRates`      |   1282 | a rate per pair per day, so any day in the span can price a new row   |

\* the only count `verify.mjs` does not restate exactly: the grid is sparse, so its size follows from
how the generator distributed the spending. What is asserted instead is every property the number
exists for — full coverage, both ends of the span, sparsity, and agreement with the cached balance.

### The anchor ages, deliberately

The dashboard opens on "this month", so the anchor is the **last day of a month** — anchoring to the
last _closed_ month leaves that first screen, the one a demo is looked at through, completely empty.
The price is that the last few weeks of settled rows are dated after today. Nothing in the product
forbids that, but it is a property of the fixture rather than of the domain.

Once the wall clock leaves this month, bump `ANCHOR` in `seed.mjs` (and `EXPECTED_ANCHOR` in
`verify.mjs`) and re-run. Do not reach for a clock — that is the one thing determinism costs, and
paying it is cheaper than a suite of baselines that photographs whatever day it happened to be.

### Internal transfers, and the four reference-amount cases

The household's own money changing pockets — cash withdrawals, the card bill, the standing order
into savings, top-ups of the euro account — is written as **real two-leg transfers**: an `expense`
and an `income` sharing a `transfer_id`, exactly as `docs/MONEY.md` §4 defines one. (An earlier
version of this fixture faked them as unlinked `exclude_from_stats` pairs, because plan 10 had not
landed. It has.)

Both legs still carry `exclude_from_stats`, and that is not belt-and-braces: `sumTransactions`
excludes a row from the footer totals on **that flag and nothing else**, so an unflagged leg would
inflate both halves of every cash-flow figure by the size of the transfer.

The cadences are chosen so that all four of §4.2's cases appear, because three of them are
arithmetic the product only gets to prove on data that contains them:

| Case | Shape             | Where it comes from                  | Count |
| ---- | ----------------- | ------------------------------------ | ----: |
| 1    | base → foreign    | savings standing order, euro top-ups |    22 |
| 2    | foreign → base    | one euro sale at the bureau          |     1 |
| 3    | base → base       | cash withdrawals, card settlements   |    34 |
| 4    | foreign → foreign | one EUR→USD exchange                 |     1 |

Cases 1 and 2 are the interesting ones: the leg whose currency is not the base does **not** take the
catalogue rate. Its `ref_amount_minor` is dictated by its sibling and its `rate_e10` is
back-derived from the pair, which is what makes the transfer's effect on net worth exactly zero
instead of "zero plus twenty grosz nobody can explain". `rateFor()` does the derivation and then
re-checks itself in the same truncating integer arithmetic SQLite uses, so a rate that cannot
reproduce its own reference amount never reaches the file.

Case 4 is the only transfer in the fixture whose legs do not net to zero. The 6,80 zł left over is
the bureau's spread — a **real FX difference**, which §4.2 says is surfaced rather than hidden.
`verify.mjs` asserts the distinction: every transfer with a base-currency leg nets to exactly zero,
and no transfer with a base-currency leg is allowed a residual at all.

### The credit card is funded deliberately short

Every other funded account is topped up to 104% of what it spent, because money sits in a wallet or
a savings account. A card is settled a month in arrears, so its `coverage` repays all but
`1/HISTORY_MONTHS` of the tally and it ends the span **owing** money. The sign is the point:
`creditUtilisation` reads `used = balance < 0 ? |balance| : 0` and `AccountOverview.liabilitiesMinor`
is documented as negative-while-in-debt, so a card left in credit renders a 0% utilisation meter and
a _"what you owe"_ figure that is really a credit.

The wallet has the opposite constraint and needed two fixes rather than one: cash is excluded from
any expense over 400 zł (nobody pays two and a half thousand złotych out of a wallet) and opened
with enough in it to survive a heavy week before the next withdrawal. Both exist because the daily
balance grid now **draws** every day of it, and a cash account in the red is a state cash cannot be
in.

### The daily balance grid

`account_balances` is written for all five accounts across the whole span, **sparse** in the way
`docs/plans/09-balance-history.md` defines it: a day whose value repeats the previous day's is
omitted and forward-fill happens on read, with the first and last day of the grid always present so
a reader has both ends.

Two deliberate departures from what `grid.ts` will do when it lands, both because this is a fixture
and not a rebuild:

- **All five accounts share a left edge** — one day before the span, rather than one day before each
  account's own first transaction. Per-account edges would make the net-worth chart appear to grow
  simply because more accounts had started existing.
- **Only settled rows are summed.** The planned rows past the anchor are a projection, and a
  projection sitting in the balance table is indistinguishable on read from a measurement. Keeping
  them out is also what makes the grid's last row equal `accounts.current_balance_minor` exactly,
  which `verify.mjs` checks.

`ref_minor` is `native_minor` revalued at the day's rate, which is deliberately **not** the running
sum of the transactions' own `ref_amount_minor`. The two differ by the historical rate movement, and
the balance grid is the one place the current valuation is the right answer.

---

## What `verify.mjs` checks

Counts and span, then forty-seven invariants. Each publishes **how many rows it examined** as well as
how many broke it, and a check that examined zero rows **fails** — a query that has lost its subject
looks exactly like a passing check unless the count is published, and that is how a fixture rots
without anybody noticing. Both halves run as scalar subqueries of one statement, so an invariant
costs one round trip.

| Invariant                              | What a violation means                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `amountsAreIntegers`                   | an amount is not a whole number of minor units — a float reached a write path              |
| `fxRowsCarryRate`                      | an amount crossed the base-currency boundary without recording its rate                    |
| `fxConversionIsExact`                  | `ref_amount_minor` disagrees with `amount_minor × rate_e10 / 1e10`, back-derived rates too |
| `accountBalancesMatchLedger`           | a stored balance disagrees with the transactions behind it                                 |
| `everyRowIsScopedToTheWorkspace`       | a seeded row carries a foreign `organization_id`, so tenant scoping would hide it          |
| `foreignKeysResolve`                   | a transaction points at an account, category, payee, batch, series or goal that is gone    |
| `creditCardCarriesDebt`                | a credit card ends the span at or above zero, so its utilisation meter reads 0%            |
| `internalTransfersHaveTwoLegs`         | a transfer is not a linked pair — the orphan state the model cannot represent              |
| `transferLegsRunBothWays`              | both legs point the same way, so the transfer creates or destroys money                    |
| `transferLegsShareADate`               | the legs are booked on different days, which §4.1 forbids outright                         |
| `transfersWithABaseLegNetToZero`       | a case 1–3 transfer moved net worth — a leg took the catalogue rate instead of its sibling |
| `onlyForeignToForeignTransfersResidue` | a residual appeared somewhere it cannot be a real FX difference                            |
| `transferLegsCarryTheirId`             | an `internal` row has no `transfer_id`, so its sibling cannot be found                     |
| `transferLegsAreOutOfStatistics`       | a leg counts towards income or expense and inflates every cash-flow figure                 |
| `splitSumsMatchTheirParent`            | `Σ splits ≠ parent`, natively or converted — §4.3 allows no tolerance                      |
| `splitsHaveAtLeastTwoLines`            | a "split" of one line, which is a category                                                 |
| `splitParentsAreNotTransferLegs`       | a transfer leg gained splits, which §4.1 rule 4 forbids                                    |
| `splitsSpanMoreThanOneCategory`        | no receipt divides across two categories, so splits are never actually demonstrated        |
| `refundsDoNotExceedTheirOriginal`      | a refund gives back more than was spent                                                    |
| `refundedOriginalsAreFlagged`          | `refund_linked` is missing, so the delete guard never fires                                |
| `refundsRunOppositeTheirOriginal`      | a refund deepens the spend instead of giving it back                                       |
| `refundSplitLinksBelongToTheOriginal`  | a split-line refund points at a line of a different receipt                                |
| `aPartialRefundExists`                 | every refund is total, so the path with the arithmetic in it is never exercised            |
| `plannedRowsSitAfterTheAnchor`         | a planned row is dated in the past                                                         |
| `plannedRowsAreOutOfTheBalance`        | a forecast was folded into a cached balance                                                |
| `balanceGridCoversEveryAccount`        | an account has no snapshots, so net worth draws it as a flat zero                          |
| `balanceGridSpansTheWholeHistory`      | the snapshots do not reach both ends of the span                                           |
| `balanceGridEndsAtTheCachedBalance`    | the history and the cache disagree about the same number                                   |
| `balanceGridIsSparse`                  | a day repeats the previous day's value instead of being omitted                            |
| `balanceGridRefMatchesItsRate`         | `ref_minor` is not `native_minor` revalued at the rate stored beside it                    |
| `onlyCreditAccountsGoNegative`         | a wallet or a savings account holds a negative amount on some day                          |
| `theCardStaysInsideItsLimit`           | the card owes more than its limit on some day                                              |
| `balanceGridActuallyMoves`             | the balances never change, so the net-worth chart is a straight line                       |
| `goalCachesMatchTheirContributions`    | `contributed_minor` disagrees with the links that are its authority                        |
| `goalStatusFollowsProgress`            | a goal past its target still reads `active`, or one short of it reads `reached`            |
| `goalContributionsAreRealTransactions` | a link points at a transaction that does not carry the goal's id                           |
| `paidPeriodsHaveASettlement`           | "paid" with nothing to point at — a claim with no evidence                                 |
| `recurringPeriodStatesAreMixed`        | fewer than all four statuses, so overdue and skipped are invisible in the demo             |
| `recurringLinksPointAtTheirSeries`     | the series screen and the transaction screen disagree about what belongs to what           |
| `importedRowsMatchTheBatchCount`       | `imported_count` disagrees with the rows carrying the batch id, so undo's claim is wrong   |
| `importedRowsRecordTheirSource`        | an imported row has no source hash, so a re-import cannot see it is a duplicate            |
| `tagsCoverAMeaningfulShare`            | under 30% of rows carry a tag, so every tag filter opens near-empty                        |
| `everyTagIsUsed`                       | a tag nothing carries, which reads as a broken screen                                      |
| `payeeAliasesResolve`                  | an alias points at a payee that does not exist                                             |
| `everyExpenseCategoryIsUsed`           | a category no row uses, which is an empty slice in the donut                               |
| `budgetPeriodsMatchTheirLedger`        | a period's `spent_minor` disagrees with the transactions inside its own range              |
| `budgetCarryFollowsItsPolicy`          | an opening balance is not what the previous period's rollover policy produced              |

### What is still not asserted

`attachments`, `transaction_groups`, `notifications` and `import_row_errors` are not written and not
counted. They belong to plans this fixture does not yet have a reason to anticipate, and a counter
that fails on every run because nothing writes its table is a counter nobody reads.

The `conditions` and `actions` JSON on the two `rules` rows is **provisional**: its Zod shape is
`docs/plans/14-rules.md`'s to define, so what the seed writes is shaped from the closed field and
action lists that plan fixes and will need re-shaping when the schema lands. The rows exist so the
rules screen has something to render; they are not a contract.
