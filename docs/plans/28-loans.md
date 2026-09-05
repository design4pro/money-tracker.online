# 28 — Loans

## Area brief

A loan is a borrowing tracked as more than a negative balance. This plan ships the loan model, the
integer-only amortisation engine, the materialised repayment schedule, the two loan screens, the
settlement of a scheduled instalment against a **real transaction**, extra repayments and the
settled state.

**It exists because a balance answers the wrong question.** `06-accounts.md` gives the `loan`
account category a balance and a credit limit, and that is all it gives: an account that says
`-184 000,00 zł` says nothing about when the borrowing ends, what it costs, or whether this month's
payment has been made. The three figures a person actually acts on — how much of the next payment is
interest, when the last one falls, and what an overpayment moves — are none of them derivable from a
balance.

**A payment is a transaction, and the schedule never becomes a second ledger.** The schedule is the
_plan_: what is expected, on which day, split into principal and interest. What actually happened is
a transaction on the loan's account, and an instalment is marked paid by **pointing at one**, the
way `13-recurring.md` marks a period paid. Nothing in this plan stores an amount that also lives in
the ledger, and no figure on either screen is accumulated from anything but rows that exist.

**The arithmetic is integer, end to end, and that is the hard part of this plan.** The textbook
annuity formula is a `pow()` over floats and is therefore unusable here (`docs/MONEY.md` §1.1). The
engine of `28-S1` solves for the instalment by integer search over an integer simulation instead,
rounds interest exactly once per period with the repository's one rounding function, and lets the
final instalment absorb the residue. That is what makes `Σ principal = principal` an equality rather
than an approximation.

**Two things are deliberately not here.** Depreciating assets with a value curve — the other half of
the old `BND-11` — stay deferred; nothing in this plan is shaped around them. And the interest model
is a **nominal annual rate divided by the number of payments in a year**, not an effective annual
rate: it is the number written on a loan agreement, and a person who cannot reconcile our schedule
against their bank's is not helped by a more defensible model. The choice is stated on the form.

---

## Stage 28-S1 — The amortisation engine, the loan model and the schedule

### Stage id

`28-S1` · Wave 8 · effort **L**.

### Reference rows

`LOAN-01 missing → done` — the loans repository with create, read, update, close and delete.
`LOAN-02 missing → done` — the integer-only amortisation engine, as a pure module.
`LOAN-03 missing → done` — the materialised schedule written in the same batch as the loan.
`LOAN-04 missing → done` — the `loans` namespace of the message catalogue, EN and PL.

### Owned paths

- `src/server/loans/amortise.ts` — new
- `src/server/loans/__tests__/amortise.test.ts` — new
- `src/server/repos/loans.ts` — new
- `src/server/repos/__tests__/loans.test.ts` — new
- `src/lib/i18n/messages/en.ts` — edit
- `src/lib/i18n/messages/pl.ts` — edit

The whole `loans` message namespace lands here, in one stage, including keys whose screens arrive in
`28-S2` and `28-S3`. The two catalogue files are single modules and both later stages sit in one
wave; one writer for the namespace is the only arrangement in which they cannot collide. Keys
without a consumer for one wave are inert, and the parity test (`docs/SPEC.md` §9) covers them from
the day they land.

### Data and migration

Three new tables, none of which exists in `src/server/db/schema.ts`. The schema edit and the
migration belong to `00-S17`; this section is the requirement it is built from.

- **`loans`** — `id` from `newId()`, `organization_id` leading, `account_id` (`references accounts`,
  `on delete cascade`, `not null`: a loan whose account is gone is not a loan), `name` `text(100)`,
  `principal_minor` and `ref_principal_minor` `integer not null`, `currency_code` `text(3)`
  referencing the catalogue, `annual_rate_e10` `integer not null` (the same integer-scaled-by-10^10
  convention as an exchange rate, and the reason no second scaling convention is invented here),
  `repayment_shape` and `payment_frequency` `text not null` with a `CHECK` per enum, `term_periods`
  `integer not null`, `opened_on` and `first_payment_on` calendar dates, `status` `text not null
default 'active'`, `note` `text(500)`, `created_at`, `updated_at`.
- **`loan_instalments`** — `organization_id` leading, `loan_id` (`cascade`), `sequence` `integer`,
  primary key `(loan_id, sequence)`, `due_on` calendar date, `principal_minor`, `interest_minor` and
  `closing_balance_minor` `integer not null` with non-negative `CHECK`s, `status` `text not null
default 'upcoming'`, `settled_transaction_id` (`references transactions`, `on delete set null`),
  `created_at`, `updated_at`. A `CHECK` that `status <> 'paid' or settled_transaction_id is not
null`, for the reason `recurring_periods` carries the same one: paid with nothing to point at is a
  claim with no evidence.
- **`loan_extra_repayments`** — `organization_id` leading, `loan_id` (`cascade`), `transaction_id`
  (`cascade`), `created_at`, primary key `(loan_id, transaction_id)`. A link table and nothing else;
  the amount is read from the transaction, never copied here.

Indexes, `organization_id` first in every one: `loans (organization_id, status)`, `loans
(organization_id, account_id)`, `loan_instalments (organization_id, due_on, status)`,
`loan_extra_repayments (organization_id, transaction_id)`.

Enums: `LOAN_STATUSES` = `active | settled | closed`; `LOAN_REPAYMENT_SHAPES` = `annuity |
linear_principal`; the payment frequency reuses `RECURRING_FREQUENCIES` **narrowed** to `monthly |
quarterly | semi_annual | annual`. The narrowing is the point: a per-period nominal rate is the
annual rate divided by the number of periods in a year, and a year does not contain a whole number
of weeks. A weekly loan would need a day-count convention this product does not have, so it is
refused at the Zod boundary with a message that says why rather than silently modelled as `1/52`.

Migration `drizzle/0006_loans.sql`, additive, backfilling nothing.

### Server (repo, server function, Zod)

- **`amortise.ts`** — the pure module, no scope, no database, no clock. It exports
  `buildSchedule({ principalMinor, currency, annualRateE10, paymentsPerYear, termPeriods, shape,
firstPaymentOn })` returning `{ instalments, totalInterestMinor, instalmentMinor }` and nothing
  else.
  - **Interest for one period** is `applyRatioMinor(openingBalance, annualRateE10, RATE_SCALE_E10 *
paymentsPerYear)` — the repository's existing half-to-even integer path (`docs/MONEY.md` §1.4),
    rounded exactly once, per period, on the opening balance.
  - **The annuity instalment is solved, not computed.** Binary search over the integer instalment in
    `[periodOneInterest + 1, principalMinor + totalInterestCeiling]` for the smallest value whose
    integer simulation closes the balance at or before the final period. No `pow`, no `Math`, no
    float anywhere on the path — the search compares integers produced by the same simulation that
    later writes the rows, so the answer and the schedule cannot disagree.
  - **`linear_principal`** takes its principal parts from `allocateEvenly(principalMinor,
termPeriods)`. There is one allocator in this repository and this stage does not add a second
    (`docs/SPEC.md` §8).
  - **The final instalment absorbs the residue**: its principal part is whatever balance remains and
    its closing balance is exactly `0`. This is the same shape as a split's remainder and it is what
    makes the sum an equality.
  - **A negative amortisation is refused, not modelled.** If the solved instalment would not cover
    the first period's interest, the module throws a named error carrying both figures. A schedule
    whose balance grows is a real loan and it is not one this product tracks in v1.
  - **Due dates come from `nextDueDates()`** in `src/server/recurring/schedule.ts`. "When is this
    next due" already has one owner in this product, including the month-end anchoring rule, and
    this stage calls it rather than re-deriving a calendar.
- **Repository.** `loans.ts`: `listLoans`, `getLoan`, `createLoan`, `updateLoan`, `deleteLoan`,
  `listInstalments(loanId)`. `createLoan` builds the schedule and inserts the loan and all of its
  instalments **in one batch**; a loan with no schedule is never observable.
  `updateLoan` refuses a change to `principal_minor`, `annual_rate_e10`, `term_periods`,
  `payment_frequency`, `repayment_shape` or `first_payment_on` once **any** instalment is paid, and
  the error names the paid instalment: rewriting the terms under a settled payment silently
  reinterprets money that already moved. Name, note and status stay editable throughout.
- **The loan's currency is the account's currency**, asserted in the repository against the fetched
  account rather than trusted from the input, and a `loan`-category account is required. A borrowing
  denominated differently from the account it is drawn on has no single balance to be right about.
- **Zod.** `z.strictObject()`; `principal_minor` `z.number().int().positive()`; `annual_rate_e10`
  `z.number().int().min(0)`; `term_periods` `z.number().int().min(1).max(600)`; `opened_on` and
  `first_payment_on` `z.iso.date()` with `first_payment_on >= opened_on`; the frequency is the
  narrowed enum, with the `error` parameter carrying the reason weekly is absent. Parsed again in
  the repository (`docs/SPEC.md` §6).
- **Authorisation.** `requireOrg()`. Every query is built on `tenantFilter()`.
- **Ledger batching.** This stage writes no transaction and changes no balance: a schedule is an
  expectation. **No rebuild is enqueued**, and that is stated here so a later reader does not add
  one defensively.

### UI (route, components)

None. This stage ships the engine, the repository and the copy; the screens are `28-S2` and `28-S3`.
The catalogue keys it lands are listed in the ticket so the two screen stages consume them rather
than minting near-duplicates.

### Quota

`createLoan` calls `assertWithinLimit(scope, 'loans', current + 1)` **inside the repository, before
the insert**. `loans` is a new metric: it does not exist in `resolveLimits()`
(`src/server/billing/limits.ts`) or in the catalogue (`src/lib/plans.ts`), so both are a
requirement on `00-S15`'s successor and the case is added to
`src/server/billing/__tests__/limits.test.ts` in the same change. Instalments are **not** metered —
they are a consequence of the term, and a person who cannot see the second half of their own
schedule has been sold a broken feature. Settled and closed loans count; the copy says so.

### Tenant isolation test

Added to `src/server/repos/__tests__/tenant-isolation.test.ts`: workspace A, in A's scope, reads,
lists, updates and deletes B's loans by id, lists B's instalments, and creates a loan parented onto
B's `account_id`. Every one is a `NotFoundError`, and B's loans and instalments are byte-identical
afterwards. Functions covered: all six exports.

### Money invariant

_The schedule sums to the principal, and no float touches it._ Cases in
`src/server/loans/__tests__/amortise.test.ts`, with the cross-layer cases in
`money-invariants.test.ts`:

- _`Σ instalments.principal_minor = loans.principal_minor`_ — exactly, for both shapes, over a
  matrix of terms, rates and a zero rate.
- _the final instalment's closing balance is `0`_, and no intermediate closing balance is negative.
- _interest is rounded once per period, half-to-even, on the opening balance_ — asserted against a
  hand-worked integer fixture, including a tie that half-up would round the other way.
- _the scale is `currencies.digits`_ — the same loan in a 0-digit and a 3-digit currency produces
  schedules that differ in scale and in nothing else, so no `2` is hard-coded on this path.
- _no float touches an amount_ — the module is asserted to contain no `Math.` call and no division
  outside `applyRatioMinor`/`allocateEvenly`, and every returned figure is `Number.isSafeInteger`.
- _`ref_principal_minor` is written once at `opened_on`'s rate and never recomputed_ (`docs/MONEY.md`
  §3.1).
- _a schedule that would not cover its first interest period throws_ rather than returning a
  growing balance.

### Verification

- Command gate, in order: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `amortise.test.ts`: the seven cases above, plus a one-period loan, a 600-period loan, and a loan
  whose principal is one minor unit.
- `loans.test.ts`: the batch insert, the immutability refusal with a paid instalment, the currency
  and category assertions, the quota call site, the isolation cases.
- No browser evidence and no axe run: this stage ships no surface. Item 4 of §7 does not apply and
  the ticket says so rather than leaving it unticked.
- Console silent.

### Definition of done

§7 items 1–3 and 5–7. Item 4 does not apply; the §2 clauses are ticked by `28-S2` and `28-S3`, which
own the surfaces.

### Blockers

**A dependency on `00-S17`**, which lands the three tables and `drizzle/0006_loans.sql`. It is a
wave-7 stage and this one is wave 8. No package is needed: the engine is integer arithmetic over
`src/lib/money.ts` and calendar arithmetic over `@internationalized/date`, both already pinned
(`docs/SPEC.md` §3).

---

## Stage 28-S2 — The loan list and the loan form

### Stage id

`28-S2` · Wave 9 · effort **M**.

### Reference rows

`LOAN-05 missing → done` — the loan list screen with the borrowing total.
`LOAN-06 missing → done` — the create and edit form, with a live schedule preview.

### Owned paths

- `src/server/fns/loans.ts` — new
- `src/routes/_app/loans/index.tsx` — new
- `src/routes/_app/loans/-ui/loan-card.tsx` — new
- `src/routes/_app/loans/-ui/loan-form.tsx` — new
- `src/routes/_app/loans/-ui/schedule-preview.tsx` — new
- `e2e/loans.visual.spec.ts` — new

### Data and migration

None. Every table this stage reads and writes landed in `00-S17`.

### Server (repo, server function, Zod)

- **Server functions.** `listLoans` (GET) returning each loan with its next unpaid instalment and
  its outstanding balance; `saveLoan` (POST) wrapping `createLoan`/`updateLoan`; `previewSchedule`
  (POST) returning the first twelve instalments and the totals for a form that has not been
  submitted. The preview calls the **same** `buildSchedule` the write path calls — a preview
  computed by a second implementation is a promise the product breaks at the moment of the write.
- **Zod.** The `28-S1` input schemas, imported, not restated. `previewSchedule` takes the create
  input minus the name.
- **Authorisation.** `requireOrg()` on all three. `previewSchedule` is a public endpoint like any
  other and validates the account the same way, even though it writes nothing.
- **Ledger batching.** No balance changes. No rebuild.

### UI (route, components)

- **Route.** `/loans`, SSR default.
- **Components.** Reuses `Card`, `Dialog`, `MoneyField`, `DatePicker`, `Select`, `NumberField`,
  `Meter`, `Badge`, `data-table` from `src/components/ui`. New: `loan-card.tsx`, `loan-form.tsx`,
  `schedule-preview.tsx`.
- **The card carries four figures and no more**: outstanding balance, the next payment with its
  date, the share of the term repaid as a `Meter`, and the total interest remaining. Every one is
  `tabular-nums` and end-aligned.
- **States.** Empty: _"No loans tracked yet"_, one line of explanation naming what a loan adds over
  an account balance, and one action. Skeleton: three cards with the meter's space reserved. Error:
  `ErrorPanel`, retryable. A loan whose outstanding balance failed to load shows `—`, never `0`,
  which would read as _repaid_.
- **The rate field is a rate, not an amount.** It is a `NumberField` in percent with a description
  stating the nominal-per-period model, and it is converted to `annual_rate_e10` at the boundary by
  `rateFromString` — the one place a decimal string becomes an integer in this repository.
- **Tokens.** None new. Outstanding debt uses the `expense` family, never a decorative red;
  a loan whose next payment is overdue adds a text state beside the colour.
- **Accessibility.** The `Meter`'s `aria-valuetext` reads the repaid and remaining amounts, not a
  bare percentage. The preview table is a real `<table>` with a caption, so it is the accessible
  equivalent from the start rather than a chart with a table bolted on. The form is keyboard-
  complete with a visible focus order that follows the reading order of the loan agreement it is
  copied from: principal, rate, term, frequency, first payment.

### Quota

No new metric. The ceiling is asserted inside `createLoan` (`28-S1`); this stage renders the
`QuotaExceededError` as the design system's upgrade affordance and never as a raw error.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: `listLoans`, `saveLoan` and `previewSchedule` in A's scope
against B's `loanId` and B's `account_id` — `NotFoundError` in every case, with no partial payload
and no schedule computed for a row A cannot see. Functions covered: the three server functions.

### Money invariant

_The preview and the write agree, and a percentage never becomes an amount._ Cases in
`money-invariants.test.ts`:

- _`previewSchedule` and the schedule written by `saveLoan` are identical_ for the same input,
  asserted row by row rather than on the totals — a total that reconciles does not vouch for the
  parts it was built from.
- _the rate field's decimal string becomes `annual_rate_e10` through `rateFromString` and back
  through `formatRateE10` without drift_, including a rate with more decimals than the field shows.
- _the outstanding balance is the last unpaid instalment's opening balance_, never a subtraction of
  formatted figures.
- _the list's total is a sum of `ref_` amounts_ (`docs/MONEY.md` §3), so two loans in two currencies
  add up to a figure that means something.

### Verification

- Command gate.
- Browser evidence: `/loans` with **one healthy loan, one with an overdue next payment and one
  settled**, both themes, at **360 / 1280 / 2560 px**; the **empty state**; and the form with the
  **schedule preview open**, which is the interaction state this stage is about — a resting form
  proves nothing about it.
- `e2e/loans.visual.spec.ts` runs `@axe-core/playwright` on `/loans` and on the open form: zero
  `serious`, zero `critical`. No `moderate` waiver is expected; one that appears is named here
  before it is accepted.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

**A dependency on `28-S1`** for the engine, the repository and the catalogue keys. It is wave 8 and
this stage is wave 9.

---

## Stage 28-S3 — The loan detail, the schedule table and settling an instalment

### Stage id

`28-S3` · Wave 9 · effort **L**.

### Reference rows

`LOAN-07 missing → done` — the loan detail screen with the full schedule.
`LOAN-08 missing → done` — settling an instalment against a real transaction, and unsettling it.
`LOAN-09 missing → done` — the principal and interest split reported per paid instalment and to
date.

### Owned paths

- `src/server/loans/settle.ts` — new
- `src/server/loans/__tests__/settle.test.ts` — new
- `src/routes/_app/loans/$loanId.tsx` — new
- `src/routes/_app/loans/-ui/schedule-table.tsx` — new
- `src/routes/_app/loans/-ui/settle-dialog.tsx` — new
- `src/routes/_app/loans/-server/detail.ts` — new
- `e2e/loan-detail.visual.spec.ts` — new

Disjoint from `28-S2` in the same wave: that stage owns `index.tsx`, its three `-ui` files and
`src/server/fns/loans.ts`; this one owns the detail route, its two `-ui` files and its own
`-server/detail.ts`.

### Data and migration

None. `settled_transaction_id` and its `CHECK` landed in `00-S17`.

### Server (repo, server function, Zod)

- **`settle.ts`** exports `settleInstalment({ loanId, sequence, transactionId })`,
  `unsettleInstalment({ loanId, sequence })` and `repaymentToDate(loanId)`.
- **What a settlement refuses**, each with an error that names both sides: a transaction on a
  different account from the loan's; a transaction in a different currency; an `income` transaction
  against a repayment; a transaction already linked to another instalment or to an extra repayment;
  an instalment already paid. Every one of these is a way a person's schedule and ledger quietly
  stop describing the same money.
- **What a settlement does not do is rewrite the schedule.** A payment larger or smaller than the
  instalment is linked as it is, and the difference is reported as a variance on the row. The
  schedule is what was agreed; the ledger is what happened; a product that edits the first to match
  the second has destroyed the only record of the discrepancy. Re-planning the remainder is
  `28-S4`'s, on an explicit action.
- **`repaymentToDate`** sums the **linked transactions**, not the schedule, and attributes each to
  principal and interest using the split of the instalment it settles. Paid-to-date is therefore a
  figure about money that moved, and the schedule is only the attribution key.
- **Overdue is derived, never stored.** An instalment is overdue when it is unpaid and `due_on` is
  before the workspace's today — read from `src/server/clock.ts`, so a test can make it a fixed day.
  A stored flag would need a cron to stay true and would be wrong between runs.
- **Server function.** `loadLoanDetail({ loanId })` (GET) returning the loan, its schedule page, the
  repayment-to-date attribution and the settlement candidates — unlinked transactions on the loan's
  account within a window around the due date, **offered, never linked automatically**. Automatic
  linking without confirmation reinterprets somebody's transaction.
- **Zod.** `z.strictObject({ loanId })`, and `{ loanId, sequence, transactionId }` with `sequence`
  `z.number().int().min(1)`. Parsed again in the repository.
- **Authorisation.** `requireOrg()`. A well-formed `transactionId` from the client is not an
  authorised one: the transaction is fetched in the tenant scope before it is linked.
- **Ledger batching.** Settling links an existing transaction and creates none, so no balance moves
  and **no rebuild is enqueued**. The write still runs inside `runWithLedgerBatch` because it reads
  balances the batch is serialising, and that is stated rather than assumed.

### UI (route, components)

- **Route.** `/loans/$loanId`, SSR default.
- **Components.** Reuses `Card`, `data-table`, `Dialog`, `Badge`, `Meter`, `Button`, `Pagination`.
  New: `schedule-table.tsx`, `settle-dialog.tsx`.
- **The schedule table** is one row per instalment: sequence, due date, principal, interest, total,
  closing balance, state. Amount columns are end-aligned and `tabular-nums`; the next unpaid row is
  marked with a badge **and** a text state, never colour alone. Long schedules page at 24 rows
  rather than scrolling 600.
- **States.** Empty is impossible by construction — a loan has a schedule from its first batch — so
  the table's empty branch renders the failure state, not a friendly nothing. Skeleton: the header
  card plus eight rows with the amount columns' width reserved, so the table does not reflow on
  arrival. Error: `ErrorPanel` per section, so a failed candidate lookup does not blank the
  schedule.
- **The settle dialog** lists candidate transactions with their amount and date and states the
  variance against the instalment before the person confirms it. It also offers "none of these",
  which opens the transaction entry form with the account, date and amount prefilled — the common
  case is that the payment has not been recorded yet.
- **Tokens.** None new. The variance uses the `warning` family with a sign and a text label.
- **Accessibility.** The table has a caption and scope-marked headers. The variance is a sentence in
  the row's accessible name, not a colour: _"paid 1 250,00 zł, 30,00 zł more than planned"_. The
  dialog returns focus to the row it was opened from.

### Quota

No countable row: a settlement is a link between two rows that were each counted when they were
created.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: `loadLoanDetail` with B's `loanId`; `settleInstalment` with A's
loan and B's `transactionId`, and with B's loan and A's transaction; `unsettleInstalment` on B's
loan. Every one a `NotFoundError`, and B's instalment statuses and links unchanged afterwards.
Functions covered: all three `settle.ts` exports and `loadLoanDetail`.

### Money invariant

_Paid-to-date is a sum of transactions, and settling never edits an amount._ Cases in
`settle.test.ts` and `money-invariants.test.ts`:

- _no settlement writes to any `*_minor` column_ — asserted by comparing the instalment row before
  and after, field by field, with only `status`, `settled_transaction_id` and `updated_at` allowed
  to differ.
- _`repaymentToDate` equals the integer sum of the linked transactions' `amount_minor`_, and its
  principal and interest attribution sums back to the same figure.
- _a variance is reported and never absorbed_: settling with an amount that differs from the
  instalment leaves both figures readable, and the schedule's closing balances unchanged.
- _unsettling restores the instalment exactly_, including a return to `overdue` when the due date
  has passed, so a mistaken link costs nothing to undo.
- _a cross-currency link is refused_, with both currency codes in the message.

### Verification

- Command gate.
- `settle.test.ts`: the five money cases, the five refusals, and the derived-overdue case against a
  fixed clock.
- Browser evidence: `/loans/$loanId` for a loan with **paid, upcoming and overdue instalments
  visible together**, both themes, at **360 / 1280 / 2560 px**; the **settle dialog open with
  candidates and a variance**, which is the interaction state that is the point of the stage; and
  the second page of a long schedule.
- `e2e/loan-detail.visual.spec.ts` runs axe on the route and on the open dialog: zero `serious`,
  zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

**A dependency on `28-S1`** (wave 8) for the repository and the copy. The settlement candidate
window reads the transaction query layer from `07-S3`, which is wave 2 and long closed.

---

## Stage 28-S4 — Extra repayments, the payoff projection and the settled loan

### Stage id

`28-S4` · Wave 10 · effort **M**.

### Reference rows

`LOAN-10 missing → done` — an extra repayment linked to the loan, and the re-plan it triggers.
`LOAN-11 missing → done` — the payoff projection from what has actually been paid.
`LOAN-12 missing → done` — the settled state and what it does to the account.

### Owned paths

- `src/server/loans/replan.ts` — new
- `src/server/loans/project.ts` — new
- `src/server/loans/__tests__/replan.test.ts` — new
- `src/server/loans/__tests__/project.test.ts` — new
- `src/routes/_app/loans/-ui/projection.tsx` — new
- `src/routes/_app/loans/-ui/extra-repayment-dialog.tsx` — new
- `src/routes/_app/loans/$loanId.tsx` — edit
- `e2e/loan-payoff.visual.spec.ts` — new

The edit to `$loanId.tsx` is a cross-wave edit of a file `28-S3` owns in wave 9. Disjointness is a
within-wave rule (`README.md`), and this stage is wave 10.

### Data and migration

None. `loan_extra_repayments` landed in `00-S17` and is written for the first time here.

### Server (repo, server function, Zod)

- **`replan.ts`** exports `addExtraRepayment({ loanId, transactionId, effect })` and
  `removeExtraRepayment`. `effect` is `shorten_term | reduce_instalment` — the two things an
  overpayment can buy, and the person chooses, because the answer is a preference and not a fact.
- **A re-plan never touches a paid instalment.** It rewrites only the unpaid tail, from the extra
  repayment's date forward, and the invariant it must hold is that the principal already attributed
  to paid instalments plus the principal of the new tail still equals the original principal. Paid
  history is not a draft.
- **`project.ts`** exports `projectPayoff({ loan, instalments, repayments, today })` returning
  `{ kind: 'on_schedule' | 'ahead' | 'behind' | 'settled' | 'insufficient_data', projectedDate?,
periodsSaved?, interestSavedMinor? }`. `insufficient_data` is a first-class result below three
  paid instalments: extrapolating a payoff date from one payment produces a confident, absurd
  answer.
- **The settled state.** When the last instalment is paid, or an extra repayment closes the
  remaining balance, `status` becomes `settled` in the same batch and a `loan.settled` notification
  is dispatched through plan `21`'s dispatcher. `settled` is set at the moment it happens, not
  derived on read, because the moment is the thing worth telling somebody about. The account is
  **not** archived automatically — that is the person's decision about their own account, and a
  product that archives an account on a balance reaching zero surprises somebody exactly once.
- **Zod.** `z.strictObject({ loanId, transactionId, effect })`, the effect a two-value enum with the
  `error` parameter naming both options. Parsed again in the repository.
- **Authorisation.** `requireOrg()`; the transaction is fetched in the tenant scope before linking.
- **Ledger batching.** The whole re-plan — the link, the tail rewrite and the status change — runs
  in one `runWithLedgerBatch` at the outermost boundary. A half-rewritten schedule is the one
  failure mode here that a person could not diagnose from the screen.

### UI (route, components)

- **Components.** Reuses `Card`, `Dialog`, `RadioGroup`, `Badge`, `Button`. New: `projection.tsx`,
  `extra-repayment-dialog.tsx`. The projection panel is added to the detail route.
- **The projection is a sentence, not a badge**: _"At this rate you finish in June 2031 — eight
  months early, saving 4 210,00 zł of interest."_ `insufficient_data` says what is missing rather
  than showing an empty panel.
- **The effect choice is explicit in the dialog**, with both outcomes stated in figures before the
  person commits: how much shorter, or how much smaller each remaining payment becomes.
- **States.** Skeleton: the projection panel reserves its two lines. Error: `ErrorPanel`, scoped to
  the panel, so a failed projection never blanks the schedule. A settled loan replaces the
  projection with the settled summary — total paid, total interest, the date it closed.
- **Tokens.** None new. `ahead` uses the `success` family with a text state beside it.
- **Accessibility.** The re-plan is announced in a live region after it completes, naming how many
  instalments changed — a table that silently rewrites 200 rows under a screen reader is a change
  nobody was told about. `prefers-reduced-motion` is honoured by the table's transition.

### Quota

No new metric. An extra repayment is a link, and the loan was counted at creation.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: `addExtraRepayment` in A's scope with B's `loanId` and with B's
`transactionId`, and `removeExtraRepayment` on B's link. Every one a `NotFoundError`, and B's
schedule, links and status untouched. Functions covered: both `replan.ts` exports.

### Money invariant

_A re-plan conserves the principal and never rewrites what was paid._ Cases in `replan.test.ts`,
`project.test.ts` and `money-invariants.test.ts`:

- _principal attributed to paid instalments + principal of the rewritten tail = the original
  `principal_minor`_ — the central case of this stage, asserted after one, two and three successive
  extra repayments.
- _no paid instalment's row changes across a re-plan_, field by field.
- _`shorten_term` keeps the instalment and removes periods; `reduce_instalment` keeps the count and
  lowers the payment_ — and both close at exactly `0`.
- _an extra repayment larger than the remaining balance is refused_, with the remaining figure in
  the message, rather than producing a negative final instalment.
- _`interestSavedMinor` is the difference between two integer schedule totals_, computed from the
  schedules themselves, never from a rate applied to a remaining balance.
- _the projection is pure_: it is passed frozen inputs and returns without writing.

### Verification

- Command gate.
- `replan.test.ts` and `project.test.ts`: the six cases above, plus a repayment on the day of an
  instalment, one on the final period, and a loan settled by overpayment.
- Browser evidence: `/loans/$loanId` **before and after an extra repayment**, both themes, at
  **360 / 1280 / 2560 px**; the dialog with **both effects and their figures**; and a **settled**
  loan's summary.
- `e2e/loan-payoff.visual.spec.ts` runs axe on the route with the projection panel and the dialog:
  zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

**A dependency on `28-S3`** (wave 9) for the detail route this stage edits and for
`repaymentToDate`. The `loan.settled` notification needs plan `21`'s dispatcher, which is wave 5 and
closed; if its channel set has changed by wave 10, the dispatch follows the dispatcher rather than
this text.
