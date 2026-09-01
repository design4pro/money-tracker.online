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

1. **Fixed ids.** Every row's primary key comes from the dataset (`demo-acc-1`, `demo-tx-0417`),
   never from `newId()`. A key the seed invented is a key that changes on every rebuild, and
   anything the UI derives from an id — a colour, an avatar, a sort tiebreak — repaints with it.
   The `demo-` prefix is also how a re-run finds last run's rows, wherever they ended up.
2. **Fixed dates.** Every date is an offset from the anchor day. `new Date()` appears nowhere in
   the dataset half of `seed.mjs`.
3. **Fixed amounts.** Integer minor units from a seeded PRNG with a constant seed, so the hundredth
   transaction is the same hundredth transaction on every machine.

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

Anchor day **`2026-09-30`**, eighteen months of history back from it. Base currency **PLN**, with
**EUR** and **USD** on accounts and transactions so every screen exercises the base-currency
boundary rather than the happy path.

| Counter         | Value | What it is for                                                        |
| --------------- | ----: | --------------------------------------------------------------------- |
| `accounts`      |     5 | current, savings (USD), credit card, cash, one foreign-currency (EUR) |
| currencies      |     3 | across those accounts: PLN base, EUR, USD                             |
| `accountGroups` |     2 | so the grouped list and the group tree both have something to render  |
| `categories`    |    12 | two levels: 4 parents, 8 children                                     |
| `payees`        |    20 | ordinary Polish high-street names                                     |
| `transactions`  |   600 | the whole span                                                        |
| `budgets`       |     3 | one of them rolling                                                   |
| `budgetPeriods` |    27 |                                                                       |
| `exchangeRates` |  1282 | a rate per pair per day, so any day in the span can price a new row   |

`verify.mjs` restates every number. They move together or the run goes red.

### The anchor ages, deliberately

The dashboard opens on "this month", so the anchor is the **last day of a month** — anchoring to the
last _closed_ month leaves that first screen, the one a demo is looked at through, completely empty.
The price is that the last few weeks of rows are dated after today while carrying `is_planned = 0`:
settled transactions with a future booking date. Nothing in the product forbids that, but it is a
property of the fixture rather than of the domain.

Once the wall clock leaves this month, bump `ANCHOR` in `seed.mjs` (and `EXPECTED_ANCHOR` in
`verify.mjs`) and re-run. Do not reach for a clock — that is the one thing determinism costs, and
paying it is cheaper than a suite of baselines that photographs whatever day it happened to be.

### Internal movements

The household's own money changing pockets — cash withdrawals, the card bill, top-ups of the two
foreign accounts — is written as **paired rows** carrying `exclude_from_stats`: a credit on the
funded account and the matching debit on the current account. Without them the fixture is
arithmetically fine and financially nonsense, because the salary lands in one account while the
spending is spread over five: the wallet drifts tens of thousands negative, the card sinks past its
own limit, and the current account balloons.

**The credit card is the one account funded deliberately short.** Every other funded account is
topped up to 104% of what it spent, because money sits in a wallet or a savings account. A card is
settled a month in arrears, so its `coverage` repays all but `1/HISTORY_MONTHS` of the tally and it
ends the span **owing** money. The sign is the point: `creditUtilisation` reads
`used = balance < 0 ? |balance| : 0` and `AccountOverview.liabilitiesMinor` is documented as
negative-while-in-debt, so a card left in credit renders a 0% utilisation meter and a *"what you
owe"* figure that is really a credit. `verify.mjs` asserts the card ends negative
(`creditCardCarriesDebt`) so this cannot regress quietly.

They are excluded from statistics because a transfer is neither income nor expense, and counting it
would inflate both halves of every cash-flow chart by the same amount. Real transfers — a linked
pair sharing a `transfer_id` — belong to plan 10; until that lands this is the honest
approximation, using the one flag the repository already honours. `verify.mjs` asserts the pairs net
to exactly zero.

---

## What `verify.mjs` checks

Counts and span, then these invariants. Each publishes **how many rows it examined** as well as how
many broke it, and a check that examined zero rows **fails** — a query that has lost its subject
looks exactly like a passing check unless the count is published, and that is how a fixture rots
without anybody noticing.

| Invariant                        | What a violation means                                                            |
| -------------------------------- | --------------------------------------------------------------------------------- |
| `amountsAreIntegers`             | an amount is not a whole number of minor units — a float reached a write path     |
| `fxRowsCarryRate`                | an amount crossed the base-currency boundary without recording its rate           |
| `fxConversionIsExact`            | `ref_amount_minor` disagrees with `amount_minor × rate_e10 / 1e10`                |
| `accountBalancesMatchLedger`     | a stored balance disagrees with the transactions behind it                        |
| `everyRowIsScopedToTheWorkspace` | a seeded row carries a foreign `organization_id`, so tenant scoping would hide it |
| `foreignKeysResolve`             | a transaction points at an account, category or payee that does not exist         |
| `creditCardCarriesDebt`          | a credit card ends the span at or above zero, so its utilisation meter reads 0%   |
| `internalMovementsBalance`       | the excluded transfers do not net to zero — money is being created or destroyed   |

Counters for rows no plan in this slice writes — splits, refunds, recurring series, import batches,
attachments, notifications — are **not** asserted. The previous version demanded all of them, so
every run failed on all of them at once and the signal was worthless. They return with the plans
that own them.
