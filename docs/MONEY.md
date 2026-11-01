# money-tracker.online — The money contract

This is the most load-bearing document in the repository. Every rule below has a failure behind it
that is silent, arrives weeks after the code that caused it, and destroys a customer's trust in the
one number they came here for. Read it before you touch an amount, a rate, a currency or a date
bucket, and cite its section numbers rather than restating it.

`CONTEXT.md` names the concepts. This document defines the arithmetic. `docs/SPEC.md` §5 cites this
document as the money contract and does not duplicate it.

---

## 1. Representation

### 1.1 An amount is an integer number of minor units, plus a currency code

```
amount_minor    INTEGER  NOT NULL      -- minor units, signed by nothing: direction is a column
currency_code   TEXT(3)  NOT NULL      -- ISO 4217 alphabetic code
```

**There is no decimal amount anywhere in this system.** Not in the database, not in a server
function's return value, not in a query-cache entry, not in a chart's datum, not in a tooltip, not
in an export row, not in a test fixture. The only place a decimal exists is the string a human
reads, and that string is produced at the last possible moment by one formatter.

The TypeScript boundary types are branded so a bare `number` cannot be passed where an amount is
expected:

```ts
export type Minor = number & { readonly __minor: unique symbol }
export type RateE10 = number & { readonly __rateE10: unique symbol }
```

### 1.2 The scale is `currencies.digits`, never 2

Every currency row in the catalogue carries `digits`, the number of minor-unit digits ISO 4217
gives it. It is **not** always 2. "Currency" here means the catalogue: the scale the money functions
use is the static table `src/lib/money/currencies.ts`, and `currencies.digits` in D1 is its mirror,
pinned equal to it by the parity test in `src/server/catalog/__tests__/currencies.test.ts`.

| Currency | `digits` | 1 major unit is | Minor units in `1.00`-looking input |
| -------- | -------- | --------------- | ----------------------------------- |
| `PLN`    | 2        | 100 grosz       | 100                                 |
| `EUR`    | 2        | 100 cent        | 100                                 |
| `JPY`    | **0**    | 1 yen           | **1**                               |
| `KRW`    | **0**    | 1 won           | **1**                               |
| `HUF`    | 2        | 100 fillér      | 100                                 |
| `KWD`    | **3**    | 1000 fils       | **1000**                            |
| `BHD`    | **3**    | 1000 fils       | **1000**                            |

**Not everything with a code is a currency.** The precious metals (`XAU`, `XAG`, `XPT`, `XPD`), the
fund codes, `XDR` (special drawing rights), `XXX` (no currency) and `XTS` (testing) are not
currencies with minor units and are excluded from the catalogue: a metal stored with `digits: 0`
would silently behave like `JPY`. The exclusion is pinned by the lib test "carries no metal, fund or
placeholder code" (`src/lib/__tests__/currencies.test.ts`) and by the seeded-table test in
`src/server/catalog/__tests__/currencies.test.ts`.

A hard-coded `100` or `/ 100` in the money path is a defect **even when every currency in the test
fixture has two digits**, because that is exactly the condition under which the bug does not show
up. `src/lib/money.ts` is the only module allowed to know about the scale, and it reads it from the
currency, never from a constant.

For a zero-digit currency, "minor unit" and "major unit" are the same number. Any UI that assumes a
decimal separator will be present is wrong for JPY, and the formatter — not the caller — is
responsible for that.

### 1.3 Direction is a column, not a sign

`transactions.direction` is `income` or `expense`. `amount_minor` is **always non-negative**. There
is no negative amount in storage and no `-1` multiplier hidden in a repository.

The consequences are worth stating because they are what makes this choice pay:

- A sum over a filtered set never depends on remembering which rows were negative.
- Flipping a transaction's direction is a one-column update that cannot lose the magnitude.
- An import that reads a `-12.50` column maps the sign to `direction` at the parse boundary, once,
  and never again.

Rendering adds the sign: an expense reads `−12,50 zł`, an income `+12,50 zł`, using U+2212 MINUS
SIGN and not a hyphen.

### 1.4 Rounding is half-to-even

`roundHalfToEven` (banker's rounding) is the only rounding function in the repository. A second
rounding function is a defect, not a duplicate.

Half-up biases every tie upward. Over a portfolio of splits, allocations and conversions that bias
accumulates in exactly one direction and turns up as a workspace whose category totals sum to one
grosz more than the transactions they came from. Half-to-even has no systematic bias.

**Rounding happens exactly once**, at the boundary where a value is converted or allocated. A value
that is rounded, stored, read and rounded again has been rounded twice and is wrong.

### 1.5 Dates, times and instants are three different columns

| Kind          | Column type | Format       | Example         | Used for                                    |
| ------------- | ----------- | ------------ | --------------- | ------------------------------------------- |
| Calendar date | `text(10)`  | `YYYY-MM-DD` | `2026-03-14`    | `booked_on`, snapshot `date`, period bounds |
| Time of day   | `text(5)`   | `HH:MM`      | `23:30`         | reminder times                              |
| Instant       | `integer`   | epoch millis | `1773446400000` | `created_at`, `booked_at` intraday ordering |

They are never mixed and never stored in one column. A calendar date is not an instant with the
time zeroed; it is a date, and it has no timezone.

Calendar arithmetic goes through `@internationalized/date`. `date-fns` is for formatting only.

---

## 2. Exchange rates

### 2.1 A rate is an integer scaled by 10^10

```
rate_e10  INTEGER NOT NULL   -- the rate × 10_000_000_000
```

The rate is **major-per-major**: `rate_e10` for `(base=PLN, quote=EUR)` means `1 PLN = rate_e10 /
1e10 EUR`.

A float rate drifts. `0.2314` is not representable in binary floating point, and a product that
stores rates as `REAL` produces conversions that differ in the last minor unit depending on which
machine did the arithmetic and in what order. An integer scaled rate is exact, comparable, sortable
and reproducible.

10^10 was chosen because it holds a currency pair like `JPY → KWD` (a rate near `0.0000029`) with
four significant figures to spare while staying an order of magnitude inside `Number.MAX_SAFE_INTEGER`
for any realistic pair.

### 2.2 Converting minor units to minor units

Because the two currencies can have different `digits`, a conversion is **not** a multiply:

```
to_minor = roundHalfToEven(
  from_minor × rate_e10 × 10^(digits(to) − digits(from)) / 1e10
)
```

Worked, and this is the case that silently produces hundred-fold errors:

- `12 340` minor `JPY` (digits 0) = ¥12 340. Rate `JPY → PLN` = `0.0263` → `rate_e10 = 263_000_000`.
- `12_340 × 263_000_000 × 10^(2−0) / 1e10 = 12_340 × 263_000_000 × 100 / 1e10 = 32_454.2` →
  `32 454` minor `PLN` = **324,54 zł**.
- Omit the `10^(digits(to) − digits(from))` term and you get `324` minor `PLN` = **3,24 zł**: a
  hundred-fold error that every same-digit test in the suite passes over without noticing.

The conversion lives in exactly one function in `src/lib/money.ts`. Every caller uses it.

### 2.3 Where a rate comes from — resolution order

For a conversion of `(currency, date)` into the workspace base currency, in this order:

1. **A workspace flat rate**, if `organization_currencies.live_rate_update = false` for that
   currency **and** the quote is the workspace base currency: the `organization_exchange_rates` row
   whose `effective_from ≤ date` and (`effective_to IS NULL` or `effective_to ≥ date`).
   Workspace rates are **ranges, not points** — a flat rate that a person set in January applies
   until they change it, and a point-valued table cannot express that.
2. **The catalogue rate for that exact day**: `exchange_rates(base, quote, date)`.
3. **The most recent catalogue rate before that day**, up to a 7-day look-back. Markets close at
   weekends; a Saturday transaction uses Friday's rate and records that it did.
4. **Failure.** No rate is invented. The write is refused with a typed error naming the pair and the
   date, and the UI offers the person the chance to enter a rate themselves. A conversion at a made-up
   rate is worse than a conversion that did not happen, because it is invisible.

Every resolved rate is stored **on the row that used it**, so no later read has to repeat this
resolution and no later change to the catalogue can alter a historical figure.

### 2.4 Providers

Primary `@fawazahmed0/currency-api` (keyless, daily), fallback Frankfurter (ECB). Every
`exchange_rates` row records its `source`, so a bad day from one provider is identifiable and
re-fetchable without touching the other's rows. The nightly cron refreshes every pair any workspace
actually holds, and only those.

---

## 3. `amount`, `ref_amount` and the rate that joins them

Every transaction carries three money facts:

```
amount_minor       + currency_code        -- what happened, in its own currency
ref_amount_minor   + ref_currency_code    -- the same event in the workspace base currency
rate_e10                                   -- the rate that produced the second from the first
```

### 3.1 `ref_amount_minor` is historical and is never recomputed

`ref_amount_minor` is `amount_minor` converted at the rate of **`booked_on`**, written once at
write time.

**It is never recalculated.** Not by a report, not by a nightly job, not when the rate catalogue is
back-filled, not when a person changes the workspace's base currency. A March expense is a March
expense: it cost what it cost in March, and re-valuing it at today's rate makes last quarter's
report change every morning.

Reports sum `ref_amount_minor`. A report that recomputes a conversion is a defect, and a code review
that lets one through is the review's failure.

Loan reference amounts, including imported instalments, are anchored to the loan's `opened_on`,
not the instalments' future `due_on`. The opening rate follows §2.3, including its look-back limit;
a future opening date without an available rate is refused. `opened_on` is immutable. Editing a
loan amount uses its stored `rate_e10` (§3.2), leaving other reference amounts and the schedule
unchanged even when catalogue rates have since been back-filled.

The two legitimate ways `ref_amount_minor` changes:

- The transaction itself is edited (its amount, its currency or its `booked_on`), in which case the
  conversion is redone at the _new_ `booked_on`'s rate.
- The workspace base currency changes, which is a **deliberate, audited, whole-workspace
  re-denomination job**: every `ref_amount_minor` is recomputed at each row's own `booked_on` rate
  against the new base, in one queue job, with a before/after net-worth figure shown to the person
  who asked for it. It is not a background side effect of a settings toggle.

### 3.2 `rate_e10` on the row is not redundant

Storing the rate beside the amount duplicates catalogue data on purpose:

- A conversion is **auditable**: a person can see the rate that produced the figure.
- A conversion is **reproducible** without a join, which matters because the reporting queries are
  the hot path and D1 is not a warehouse.
- A conversion is **stable** if a catalogue row is later corrected — a correction fixes future
  writes, not past facts.

When a transaction's currency **is** the base currency, `rate_e10` is `10_000_000_000` (1.0) and
`ref_amount_minor === amount_minor`. That case is written explicitly rather than left null, so no
consumer has to branch on nullability.

---

## 4. Transfers

A transfer is **two transactions sharing `transfer_id`**: an `expense` on the source account and an
`income` on the destination. There is no third direction and no separate transfer entity. Every
downstream consumer — budgets, category statistics, cash flow, net worth — sees income and expense
and needs no exception branch.

### 4.1 The invariants

1. `transfer_kind` is `none` (an ordinary transaction), `internal` (**the only two-leg kind**),
   `external_out` or `external_in` (one leg; money left or entered the tracked world with no
   counter-account).
2. Editing one leg propagates to the other. Amounts may differ, because the two accounts may be in
   different currencies. **Dates may not differ.**
3. Deleting one leg deletes the other. There is no orphan-leg state.
4. A transaction with splits cannot become a transfer, and a transfer leg cannot gain splits.
5. A transaction with an active refund link cannot be deleted; the link is removed first.
6. **To change the nature of a transfer, unlink first.** There is no in-place conversion between
   `internal` and `external_*`, and no in-place flip of a leg's direction. The unlink-first path is
   the only path, from day one, because the alternative — mutating a two-row relationship through
   one row's form — is the single richest source of half-applied states in this domain.
7. `is_balance_adjustment` rows are real transactions with their own filter policy. A correction is
   never a silent overwrite of `current_balance_minor`.

### 4.2 The four reference-amount cases

Both legs must agree about what the transfer did to net worth. Four cases, and the rule is stated
for each:

| #   | Source currency | Destination currency | Rule                                                                                    |
| --- | --------------- | -------------------- | --------------------------------------------------------------------------------------- |
| 1   | **is** base     | is not base          | The destination's `ref_amount_minor` is set to the **source's** `ref_amount_minor`.     |
| 2   | is not base     | **is** base          | The **source's** `ref_amount_minor` is updated to the destination's amount. Both equal. |
| 3   | **is** base     | **is** base          | Both equal by construction.                                                             |
| 4   | is not base     | is not base          | Each leg converts independently. A real FX difference is accepted and surfaced.         |

**The invariant this buys: an internal transfer's net effect on net worth in the base currency is
exactly zero whenever either leg is in the base currency.** Cases 1–3 make it zero by construction.
Case 4 is the only one that can produce a non-zero residual, and that residual is a real FX
difference — it is shown to the person as one, not hidden.

Worked example of case 2, which is the one people get wrong:

- Base currency `PLN`. Source account in `EUR`, destination in `PLN`.
- Person moves €100,00 and 428,50 zł lands.
- The source leg is written `amount = 10_000 EUR minor`, and its `ref_amount_minor` is **not**
  computed from the catalogue rate — it is set to `42_850`, the destination's actual amount, with
  `rate_e10` back-derived as `42_850 / 10_000 × 1e10 = 42_850_000_000`.
- Net worth change in base: `−42 850 + 42 850 = 0`. Correct.
- If the source leg had instead been converted at the catalogue rate of `4,2803`, the transfer would
  have quietly changed the workspace's net worth by 20 grosz for no reason a person could see.

### 4.3 Splits

`Σ splits.amount_minor = parent.amount_minor`, exactly, in integer minor units, asserted in the
repository on every write. There is no tolerance and no "close enough".

Splits use a **surrogate primary key**, not `(transaction_id, category_id)`. A receipt with two
"Groceries" lines is a real receipt and must be representable. The cost is that every aggregation
over splits groups explicitly, and that a transaction with two lines in the same category
contributes to that category's budget **once, as the sum of its lines** — stated here so nobody
re-derives it per report.

Allocating a parent across splits, or a split across a rounding boundary, uses the **largest
remainder method**: allocate `floor` to each, then distribute the remaining minor units one at a
time to the lines with the largest fractional remainders, ties broken by `position`. This
guarantees the sum invariant holds for any number of lines and any currency scale.

### 4.4 Refunds

A refund is a transaction in the opposite direction linked to what it refunds. It may link to a
transaction, to a single split, or to **nothing** — a refund of a purchase that was never recorded
is a real event and the model represents it rather than forcing a fake original.

A refund reduces the effective spend of its target. Every aggregation that reports spend states
which of the two figures it is: **gross** (before refunds) or **net** (after). A screen that shows
one and labels it the other is a defect, and the pivot report exposes the choice to the reader.

### 4.5 Budget rollover

A budget period has four integers: the `limit` it was given, what it `carriedIn` from the period
before, what was `spent` against it, and the balance those three imply.

```
balance = limit + carriedIn - spent
```

`balance` is **signed**. Negative means the envelope was overspent. What happens to it at the
period boundary is a per-budget setting, `budgets.rollover_policy`, and there are exactly three
answers:

| policy          | `carriedOut`      | an overspent envelope                                |
| --------------- | ----------------- | ---------------------------------------------------- |
| `none`          | `0`               | forgotten. Every period starts at its bare limit.    |
| `carry_surplus` | `max(0, balance)` | **absorbed** — but reported, never silently dropped. |
| `carry_all`     | `balance`         | **carried**, as a negative opening balance.          |

A new budget defaults to `carry_surplus`: it is the policy that matches how most households
actually behave — an underspent month leaves something over, an overspent one is settled out of
the rest of the money and not held against next month — and it is the only one of the three that
is forgiving in one direction without being forgetful in the other.

**`carriedIn(n + 1) = carriedOut(n)`, always.** Two integer operations, no division, no rounding
step, so the chain telescopes: under `carry_all`, `carriedIn` at period _n_ equals `Σ limit − Σ
spent` over every period before it, exactly, and a reader can check a rollover ledger with a
pencil. The moment a rounding step enters that chain the ledger stops adding up and the product
has to choose which of two numbers to print.

**An overspend is absorbed, never hidden.** Under `none` and `carry_surplus` the arithmetic floors
at zero, and a policy that floors and reports nothing tells somebody their year balanced when it
did not. The rollover therefore returns the absorbed amount alongside the carry, and the ledger
prints both — _"0,00 zł · over by 400,00 zł"_. Under `carry_all` there is nothing to absorb,
because the overspend is the opening balance: spending 2 400,00 zł from a 2 000,00 zł envelope
means the next period opens at −400,00 zł and has 1 600,00 zł to spend.

**A closed period is never rewritten.** `budget_periods` stores the limit, the carry and the spend
_as they were_, and editing a budget's limit reaches the open period and every period after it and
not one period before it. When a transaction inside a closed period is edited afterwards, the
stored figure and what the dates now add up to diverge; that divergence is **reported as a
correction** against the open period and never written back. Retroactively rewriting a closed
period is the defect this table exists to make impossible.

Every figure above is an integer number of minor units in the budget's own currency. The limit is
converted to the workspace's base currency once, at the period's first day, for display only; the
transactions are never converted a second time (§3.1).

---

## 5. Balance history

### 5.1 It is a rebuild, not an accumulator

```
balance[day D] = (native units held on D) × (rate on D)
```

Not `balance[D−1] + Σ converted deltas on D`.

**The failure this prevents, verbatim, because it is the reason the rule exists.** Accumulate
converted deltas on a foreign-currency account and you get: a year-long gap with no transactions,
then one €5 expense, and the chart posts a one-day loss of twelve thousand euro with no transaction
behind it — because the accumulator was carrying a stale converted figure that suddenly re-based.
The same bug shows a natively-zero account holding twelve thousand euro. Both are the same
arithmetic error, and both are impossible under a rebuild.

### 5.2 The algorithm

`rebuildBalanceHistory({ accountId })`:

1. Decide whether the account is revalued: `isRevaluedAccount(a) = a.currency_code !==
org.base_currency_code`. A base-currency account still gets snapshots; it just needs no rate.
2. **Grid start** = `min(today, the day before the first transaction, the oldest existing snapshot)`.
   _The day before the first transaction is where `initial_balance_minor` lives_ — that is what makes
   the opening balance visible on the chart rather than folded into day one.
3. **Grid end** = `max(today, the last transaction date)`. Future-dated (planned) transactions are
   valued too, so the chart extends into the future when the person has planned rows.
4. Walk the grid day by day in **UTC**. For each day, carry the running native units, apply the day's
   transactions, resolve the day's rate (§2.3), and emit `(native_minor, ref_minor, rate_e10)`.
5. **Sparse output**: a day whose emitted triple is identical to the previous emitted day is omitted.
   The first day of the grid and today are **always** emitted, whatever they equal. Readers
   forward-fill from the last emitted day.
6. **Write is delete-range + insert, in one D1 `batch`.** A day the rebuild no longer emits must not
   survive: a stale row would be forward-filled as if it were a real measurement.
7. It **always rebuilds the whole history**, never a slice. This is what makes it idempotent. It
   returns `'rebuilt' | 'skipped'`.

### 5.3 Why the `LEDGER` Durable Object exists

The write is delete-range + insert. D1 has no interactive transactions and no advisory locks, so two
concurrent rebuilds of the same account can interleave their deletes and inserts into a hole — an
account with a gap in its history and no error anywhere.

`LEDGER` is a Durable Object addressed by `idFromName(accountId)`. It provides:

- **Serialisation**: one rebuild per account at a time.
- **Coalescing**: a rebuild request arriving during a rebuild sets a dirty bit rather than queueing
  a second pass, so a bulk import of 5 000 rows produces one rebuild per account, not 5 000.

It holds **no ledger data** — only a lock and a dirty bit. The rows live in D1. A direct write to
`account_balances` from anywhere outside `src/server/ledger` is a defect.

### 5.4 Batching every write path

`runWithLedgerBatch(fn)` opens an `AsyncLocalStorage` scope that collects touched account ids into a
`Set` and enqueues **one** rebuild per account after `fn` settles — **including when `fn` throws**,
because by then the transaction rows are already committed and the history is already stale.

It is opened in **every** server-function invocation, **every** cron body and **every** queue-handler
body. Not per repository call, not per route: at the outermost boundary, once.

### 5.5 The nightly sweep is the safety net, not the mechanism

`0 3 * * *` rebuilds every qualifying account. It exists to heal any write path that forgot to open
a ledger batch. It is **not** an excuse for a write path to skip one: a person who edits a
transaction and refreshes must see a correct chart immediately, not tomorrow.

---

## 6. Timezones and the day boundary

This is the subtlest rule in the document and getting it wrong produces off-by-one-day reports that
are extraordinarily hard to diagnose, because every individual number looks plausible.

There are two different "days" in this system and they are keyed differently on purpose.

### 6.1 `booked_on` is a calendar date the person chose

`transactions.booked_on` is a `YYYY-MM-DD` **calendar date with no timezone**. It is what the person
says the transaction happened on, and it is what every report groups by.

Its **default** when creating a transaction is _today in the person's own timezone_ — resolved on
the client, sent explicitly in the payload, and validated server-side as a well-formed date within a
sane window. It is **not** derived from the server's clock and it is **not** `new
Date().toISOString().slice(0,10)`.

The concrete case this settles: a person in Warsaw enters a transaction at 23:30 CET on 14 March.
UTC is already 22:30 on 14 March in winter — but in summer, at 23:30 CEST, UTC is 21:30, and at
01:30 CEST it is 23:30 of the _previous_ day. Deriving the date from a UTC instant puts a
late-evening or early-morning transaction on the wrong day roughly one entry in twelve, forever,
with no error message. The person chose 14 March; the row says 14 March.

**A settled row may not be dated after the latest calendar day on Earth** (UTC+14, computed from the
wall clock and never from the request or a development pin): such a row counts in balances at once
and freezes a borrowed look-back rate into `ref_amount_minor` for good (§2.3 rung 3, §3.1). The
server refuses it with a validation error at `bookedOn`, on every writer of a settled row
(`src/server/booking-rule.ts`). A planned row (§5.2) keeps any date. An update is judged on the
`(booked_on, is_planned)` pair it changes, so a note or amount edit of a row saved before the rule
existed still succeeds, but flipping a future-dated planned row to posted, or moving a settled row to
another future date, does not. A rule's `mark_planned: false` never settles such a row.

### 6.2 The snapshot grid is UTC-keyed

`account_balances.date` and the day-walk of §5.2 are **UTC**. So is any SQL date truncation.

They can be UTC precisely _because_ `booked_on` carries no timezone: the grid is a sequence of
calendar-date keys, and the transactions it buckets are already keyed by calendar date. "UTC" here
means "the day-stepping arithmetic is done in UTC so it is deterministic and DST-free", not "the
transactions are converted to UTC".

### 6.3 The three places the rule must hold, stated separately

1. **SQL date truncation and range predicates** — always on the `text(10)` column, compared as
   strings. Never `date(created_at / 1000, 'unixepoch', 'localtime')`, which is the server's
   locale and is meaningless.
2. **The midnight walk in `rebuildBalanceHistory`** — day stepping in UTC via
   `@internationalized/date`'s `CalendarDate`, never by adding 86 400 000 to an epoch value, which
   is wrong across a DST boundary in any zoned representation.
3. **The `date` column of every snapshot, period and aggregate** — a calendar date, never an
   instant, never an ISO string with a `T` in it.

### 6.4 Timezone shapes the civil clock, not the date grid

`organization_settings.timezone` (default `Europe/Warsaw` when the row is missing) and the person's
own preference affect:

- The **default** `booked_on` on a new transaction form.
- The rendering of _instants_ (`created_at`, audit trail entries, "2 hours ago").
- Cron "today" for due and overdue (`cronToday`): the workspace civil day in that timezone. It is
  not a report bucket and it is not `toISOString().slice(0, 10)` in UTC — around midnight a Warsaw
  household would otherwise see the previous UTC date.

They affect **nothing** about how a stored calendar date is bucketed, summed or charted. A workspace
that changes its timezone sees no report change, and that is correct. `booked_on` stays a
timezone-free calendar date (§6.1).

### 6.5 `booked_at` orders, it does not date

`booked_at` (epoch millis) exists for one job: ordering two transactions that share a `booked_on`,
so that "the coffee before the train" reads in that order. **Nothing groups, filters, buckets or
reports by `booked_at`.** A query that does is a defect.

---

## 7. Money at the boundaries

### 7.1 Parsing input

Amount input is parsed by `@internationalized/number`'s `NumberParser` bound to the active locale,
and it accepts what people actually type in both locales: `1 234,56`, `1234,56`, `1,234.56`,
`1234.56`, with a non-breaking or narrow-no-break space as a group separator. The parse produces a
decimal string, which is scaled to minor units by `digits` as an integer operation — **never by
`Math.round(value * 100)`**, which reintroduces the float we spent this whole document avoiding.

Input with more decimal places than the currency allows is **shown its stored value before submit**,
never silently truncated after it.

### 7.2 Formatting output

`Intl.NumberFormat` via `@internationalized/number`, with `minimumFractionDigits` and
`maximumFractionDigits` both set to the currency's `digits`. One formatter, in `src/lib/money.ts`.
Formatting is the only place a decimal separator exists.

Never abbreviate money (`1,2 tys.`, `€1.2M`) outside a chart axis tick — `DESIGN.md` → The
Never-Abbreviate-Money Rule.

### 7.3 Export and import

Exported CSV writes amounts as a **plain decimal string with a `.` separator and exactly `digits`
decimal places**, plus a separate currency column — never a locale-formatted string, never a
thousands separator, never a currency symbol glued to the number. Exports are read by machines and
by spreadsheets in unknown locales.

Imported amounts are parsed once, at the parse boundary, into minor units, with the file's detected
decimal and group separators recorded on the import batch's mapping so a re-run is reproducible.

### 7.4 What Sentry may see

**No amount, no payee name, no account name and no note ever leaves this system in an error
report.** The redaction middleware scrubs money-shaped fields by key **and** the failure envelope is
built from typed error codes rather than from interpolated messages. An exception message that
embeds an amount is a data-protection incident, not a debugging convenience.

---

## 8. The failure gallery

Kept here so nobody re-derives these the hard way. Each one is a real, observed failure mode in this
product category.

| #   | Failure                                                                                                            | Rule that prevents it                   |
| --- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| 1   | A phantom €12 000 one-day loss on an account with no transaction that day; a natively-zero account showing €12 000 | §5.1 rebuild, never accumulate          |
| 2   | JPY amounts a hundred times too small or too large after a conversion                                              | §1.2 `digits`, §2.2 scale term          |
| 3   | Category totals summing to one grosz more than their transactions                                                  | §1.4 half-to-even, rounded once         |
| 4   | Last quarter's report changing every morning                                                                       | §3.1 `ref_amount` is historical         |
| 5   | An internal transfer moving net worth by 20 grosz                                                                  | §4.2 case 2                             |
| 6   | A transaction entered at 23:30 landing on the wrong day, about one entry in twelve                                 | §6.1 `booked_on` is chosen, not derived |
| 7   | Two conversions of the same pair differing in the last minor unit depending on machine or order                    | §2.1 integer `rate_e10`                 |
| 8   | A gap in an account's balance chart after a bulk import, with no error anywhere                                    | §5.3 the `LEDGER` DO serialises         |
| 9   | A receipt with two "Groceries" lines that cannot be saved                                                          | §4.3 surrogate split key                |
| 10  | Splits that sum to one unit less than their parent for a three-way split of an odd amount                          | §4.3 largest remainder                  |
| 11  | A weekend transaction refusing to save because no rate exists for Saturday                                         | §2.3 rung 3, 7-day look-back            |
| 12  | A conversion silently invented at a made-up rate                                                                   | §2.3 rung 4, refuse and ask             |
| 13  | An amount appearing in a Sentry event                                                                              | §7.4                                    |
| 14  | Reports changing because someone changed the workspace timezone                                                    | §6.4                                    |

---

## 9. What a stage owes this document

Every stage in `docs/plans/` carries a mandatory `### Money invariant` heading. It names the
arithmetic property that stage must not break — "`Σ splits = parent`", "an internal transfer nets to
zero in base", "`ref_amount` is never recomputed", "no float touches an amount" — and the test file
that holds it, which is `src/server/repos/__tests__/money-invariants.test.ts` unless the stage says
otherwise and says why.

A stage that adds a write path touching an amount and adds no case there is not done. The money
boundary is a test surface exactly equal in weight to the tenant boundary.
