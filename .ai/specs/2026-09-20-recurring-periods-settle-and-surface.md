# Settle and surface recurring periods

| Field              | Value       |
| ------------------ | ----------- |
| **Status**         | in-progress |
| **Issue**          | #363        |
| **Spec PR**        | #364        |
| **Implementation** | #537, #564  |

## 📝 TLDR

A recurring period is an expected payment that has not happened yet, and today it is visible on
exactly one screen and settleable from exactly one other. This spec makes a due period settleable
from `/recurring` itself, gives the mark-paid picker a way forward when nothing is linkable yet, and
renders recurring periods on `/transactions/planned` as a distinct kind of row that is never summed
into the ledger's totals. It adds no table, no migration and no new write path: the bridge is a
read-time composition in the route's server layer, and the expectation stays an expectation.

## 📝 Problem Statement

This product has no bank connectors and never will (`docs/adr/0008-no-bank-connectors.md`), so a
recurring series is the only mechanism by which an expected payment appears before it happens. That
makes the recurring area load-bearing in a way it would not be in a connected product, and it is
currently load-bearing on one screen nobody is looking at.

Four separate defects were confirmed against `origin/develop`, and together they are what issue #363
reports:

1. **Settling a period requires navigating into the series.** `src/components/app/recurring/period-grid.tsx`
   renders real buttons per row (lines 209-240) — **Revert** for a settled period, **Mark paid** and
   **Skip** for one that is not, never all three at once — but the
   grid is imported only by `src/routes/_app/recurring/$seriesId.tsx`. The `UpcomingPanel` on
   `/recurring` (`src/routes/_app/recurring/index.tsx`, from line 341) draws due date, series name,
   expected amount and a conditional status badge, and offers no action at all. The person looking
   at the list of what is due must recognise the series, click through, find the period again and
   act there.

2. **The mark-paid picker dead-ends.** `src/routes/_app/recurring/-ui/mark-paid-dialog.tsx` reads
   settled transactions in a `±14` day window around the due date (`WINDOW_DAYS = 14`) under
   `{ planned: 'exclude', adjustments: 'exclude', transfers: 'exclude' }`. When that returns nothing
   it renders the `recurring.markPaid.empty` paragraph and stops: no route to `/transactions/new`, no
   prefill, no way back to the period. For the ordinary case — a bill paid before it was recorded —
   the action cannot be completed at all, which is what "no possibility to mark as paid" means from
   the outside.

3. **A recurring period is never a planned transaction.** `/transactions` reads
   `{ planned: 'exclude', … }` (`src/routes/_app/transactions/index.tsx:38`) and
   `/transactions/planned` reads `{ planned: 'only', … }` (`src/routes/_app/transactions/planned.tsx:33`);
   both resolve against `transactions` rows. A `recurring_periods` row becomes a transaction only
   through `src/server/recurring/auto-record.ts`, only for a series carrying `auto_record`, and only
   **after** `due_on` has passed (lines 147-163) — and the row it writes is settled, not planned.
   `grep -rn "isPlanned" src/server/recurring/` returns nothing. So no expected recurring payment is
   visible on either transactions screen before it settles.

4. **`/transactions/planned` is unreachable.** `src/components/app/nav/destinations.ts` carries a
   `recurring` entry (line 77) and no planned entry, and no `<Link to="/transactions/planned">`
   exists anywhere under `src/`. The one screen whose subject is what is coming works only if the
   URL is typed.

The deeper problem underneath all four is a violation of `docs/SPEC.md` §8, _one concept, one owner_:
**"an expected payment that has not happened yet" currently has two owners and is about to have
three.** `transactions.is_planned` owns it for rows a person typed ahead; `recurring_periods` owns it
for a series; and `docs/plans/28-loans.md` will add loan instalments, which `CONTEXT.md` already
defines with the same rule recurring periods use — _"paid only by pointing at a transaction"_. Three
tables, three screens, no shared read. Whatever this spec builds has to be the seam the third one
reuses rather than a fourth special case.

## 📝 Proposed Solution

Three changes, in dependency order, behind one idea: **an expectation is rendered beside the ledger,
never converted into it.**

- **Lift the period row actions into one component** and use it on both `/recurring` and
  `/recurring/$seriesId`, so the two surfaces cannot drift in the ways the plan's accessibility
  clause cares about (real buttons, keyboard-reachable without hover).
- **Give the empty mark-paid picker a route out**: navigate to `/transactions/new` prefilled from the
  period, and carry a return target so saving brings the person back to the period with the picker
  reopened. No new server surface — the new transaction simply falls inside the existing `±14` day
  window on return.
- **Compose the planned screen from two reads**: the existing planned `transactions` page, plus
  `getUpcoming` from `src/server/repos/recurring.ts`. Expectations render as their own row kind, are
  labelled as expectations, and are excluded from `LedgerTotals`.

### Why a read-time merge and not materialised planned rows

The alternative — writing `transactions` rows with `is_planned = true` ahead of the due date — was
considered and rejected for this spec, though it is the one assumption a human should confirm
(Q2 below). Against it:

- It makes a **second writer** into `transactions` that has to dedupe against both
  `src/server/recurring/auto-record.ts` and `src/server/recurring/match.ts`. The plan's own words on
  this path are that _"double-posting a rent payment is the worst failure this feature can have"_
  (`docs/plans/13-recurring.md`, `13-S2`), and it guards that today with a KV marker **and** a unique
  check. A third writer widens exactly that surface.
- It needs a **migration** and a link column, which `BACKWARD_COMPATIBILITY.md` allows only as an
  additive change, and it puts a stored money row where today there is a plan.
- It contradicts the documented refusal in `src/routes/_app/recurring/-ui/mark-paid-dialog.tsx` and in
  `src/server/repos/recurring.ts` (docblock item 4): _markPaid links; it never creates._

For it, honestly: the planned screen's filters, sorting, paging, detail route and bulk actions would
all work with no new code. That is a real saving and the reason Q2 is flagged rather than closed.

### Why the row model can carry it

`src/routes/_app/transactions/-lib/rows.ts` already states the property this design needs: the list
renders `LedgerRow`, _"a description of what a person reads rather than of what the database holds"_,
and its docblock anticipates that the two _"overlap today and will not tomorrow"_. The merge is
therefore a widening of an interface that was built to be widened, not a new abstraction.

It cannot be a plain `LedgerRow`, though, and that is the load-bearing detail. `LedgerRow` requires
`refAmountMinor`, `refCurrencyCode` and `rateE10` (`src/components/app/transactions/types.ts:125-153`).
A recurring period has none of them, because `docs/plans/13-recurring.md` (`13-S1`, Money invariant)
states that an expected amount _"has no `ref_amount_minor` because it has no rate and no booking date
until it settles"_, and that converting a plan at today's rate and showing only that _"is how a
person's expectations quietly change with the exchange rate"_. So the screen renders a **discriminated
union** — a settled or planned transaction row, or an expectation row that carries its own currency
and no reference amount — and never invents the missing three fields.

## 📝 Architecture

**Owner modules** (`docs/SPEC.md` §8), stated so the loans stage has something to reuse:

| Concept                                   | Owner                                                            |
| ----------------------------------------- | ---------------------------------------------------------------- |
| A recurring expectation as a readable row | `src/routes/_app/transactions/-lib/rows.ts` (`toExpectationRow`) |
| The union the ledger renders              | `src/components/app/transactions/types.ts` (`LedgerEntry`)       |
| Composing ledger page + expectations      | `src/routes/_app/transactions/-server/planned.ts` (new)          |
| Settling a period from any surface        | `src/components/app/recurring/period-actions.tsx` (new)          |

**What is reused, unchanged:** `markPaid`, `markSkipped` and `revertPeriod` in
`src/server/repos/recurring.ts`; the server functions in `src/server/fns/recurring.ts`
(`markPeriodPaid` and its siblings); `pageTransactions`, `countTransactions` and `sumTransactions`
in `src/server/repos/transaction-queries.ts`; the whole filter bar, virtualiser and keyboard map in
`src/routes/_app/transactions/-ui/transactions-screen.tsx`.

**What changes:**

- `src/components/app/transactions/types.ts` gains `ExpectationRow` and
  `type LedgerEntry = LedgerRow | ExpectationRow`, discriminated on a `kind` field. `LedgerRow` gains
  `kind: 'transaction'`; existing call sites set it in `toLedgerRow`.
- `getUpcoming` in `src/server/repos/recurring.ts` widens its projection: `UpcomingPeriod` gains the
  series' `accountId`, `categoryId` and `payeeId`, all three read from the `recurring_series` row the
  query already joins, and all three **nullable** — because the columns in `src/server/db/schema.ts`
  are (`onDelete: 'set null'`, no `.notNull()`), so a series whose linked account was deleted has
  none. The signature, the filter and the order are untouched; this is three more fields in an
  existing `select`.

  **This is Phase 2's need, not Phase 1's**, which is what keeps Phase 1 severable. On `/recurring`
  the prefill has the ids already: `loadRecurring` returns `rows: SeriesListRow[]` carrying the whole
  `series` beside `upcoming`, so the panel joins by `seriesId` against data the screen has loaded
  anyway, and `/recurring/$seriesId` has its one series outright. The planned screen is the caller
  with no series list in view, and widening the projection is cheaper for it than a second read.
  `/recurring` ignores the three new fields, because it already has better ones.

- `src/routes/_app/transactions/-server/planned.ts` is new and composes `loadTransactions` with
  `getUpcoming`. It owns no SQL, which is what `docs/SPEC.md` §6.1 puts in `-server/` — the same
  justification the existing `-server/list.ts` docblock already gives for itself.
- `src/routes/_app/transactions/planned.tsx` reads from it instead of `loadTransactions` directly.
- The ledger list component renders an expectation row with the period's status word beside its
  colour, exactly as `period-grid.tsx` does, and the same mark-paid / skip actions.

**Data flow.** Route → `-server/planned.ts` → (`loadTransactions` | `getUpcoming`) → repositories.
Nothing reaches `recurring_periods` outside `src/server/repos/recurring.ts`, and nothing reaches
`transactions` outside `src/server/repos/`.

**Paging: the expectations are not paged, and are not interleaved.** `pageTransactions` is
cursor-paged; `getUpcoming` takes a `{ today, within }` horizon and a `limit`, and is not paged.
Interleaving the two by date was considered and does not work: `getUpcoming` has no lower date bound
— it returns every unsettled period up to the horizon, overdue rows included "whatever their age"
per its own docblock — so widening the horizon for page 2 re-fetches a superset of page 1 rather
than a new slice. Worse, the screen's `DEFAULT_LEDGER_SORT` is `{ bookedOn, desc }`, under which a
page's **last** row is its **earliest**, so a horizon derived from it walks backwards as pages
advance; and three of the four `LEDGER_SORT_FIELDS` (`payee`, `category`, `account`) carry no date
to derive a horizon from at all.

So the expectations are read **once per screen load**, for a fixed horizon from `today`
(`{ within: 30, limit: 50 }`, the same window `loadRecurring` already uses for `/recurring`), and
render as **one group pinned above** the paged ledger rows — in the same table, ordered by `dueOn`
ascending, under a row-group header. The group does not change as pages advance, which is what makes
`expectedByCurrency` a figure that stays correct while somebody scrolls instead of growing with every
page. It is also well-defined under all four sort orders, because it does not depend on the ledger's
sort at all: what is expected is ordered by when it is due, and nothing else is a meaningful order
for it.

A workspace with more than 50 unsettled periods inside the horizon sees the 50 nearest — the cap
`getUpcoming` already enforces — and the group header says so, pointing at `/recurring` for the full
list. This keeps `pageTransactions` untouched, which is the property worth protecting.

## 📝 Data Model

**No schema change. No migration.** `recurring_series`, `recurring_periods` and `recurring_links`
exist from `00-S7` and are read exactly as `13-S1` left them; `transactions` is untouched.

`ExpectationRow` is a view type, not a table:

```ts
export interface ExpectationRow {
  readonly kind: 'expectation'
  /** `${seriesId}:${periodStart}` — the period's natural key, not a row id. */
  readonly id: string
  readonly seriesId: string
  readonly periodStart: string
  readonly seriesName: string
  readonly direction: LedgerDirection
  /** Strictly positive, integer minor units at `currencyCode`'s scale (`docs/MONEY.md` §1.1, §1.2). */
  readonly expectedAmountMinor: Minor
  /** `UpcomingPeriod.expectedCurrencyCode`, branded on the way out as `toLedgerRow` brands its own. */
  readonly currencyCode: CurrencyCode
  /** `YYYY-MM-DD`. The due date, a calendar date (`docs/MONEY.md` §1.5, §6.1). */
  readonly dueOn: string
  /**
   * `PeriodView.derivedStatus` — what today says, which is the one a screen renders.
   *
   * Two values, not four, and that is a fact about `getUpcoming` rather than a simplification:
   * it filters to the unsettled statuses (`upcoming`, `overdue`), so a settled or skipped period
   * is not in the result set to be rendered in the first place.
   */
  readonly status: 'upcoming' | 'overdue'
  /** All three from the series, all three nullable — see the projection note in Architecture. */
  readonly accountId: string | null
  readonly categoryId: string | null
  readonly payeeId: string | null
}
```

There is deliberately no `refAmountMinor`, no `refCurrencyCode` and no `rateE10`. Their absence is
the type telling every downstream reader that this row cannot be summed with the others, and it is
what makes the totals rule below enforceable by the compiler rather than by review.

`accountId` being nullable is not a defensive `null`: `recurring_series.account_id` is
`onDelete: 'set null'`, so deleting an account really does leave its series without one. The route
out of the empty picker prefills what it has and leaves the account picker empty in that case, where
`/transactions/new` already requires a choice — the same state a person typing a transaction from
scratch is in.

## 📝 API Contracts

One new server function, in `src/routes/_app/transactions/-server/planned.ts`:

```ts
loadPlannedScreen({
  policies: TransactionPolicies,   // parsed by the existing transactionPoliciesSchema
  filters: TransactionFilters,     // the existing shape; narrows the rows, and the group where it can
  sort, cursor, limit,             // as loadTransactions
}) => {
  ...TransactionListPage,          // rows, cursor, total, totals — unchanged shape
  /** The day the read was taken on, as `loadRecurring` and `loadSeriesDetail` already return it. */
  today: string,
  expectations: ReadonlyArray<ExpectationRow>,
  /**
   * The expected group's figures, per currency and split by direction. Never folded into `totals`,
   * never netted, never converted.
   */
  expectedByCurrency: ReadonlyArray<{
    currencyCode: CurrencyCode
    incomeMinor: Minor
    expenseMinor: Minor
  }>,
}
```

**`today` is read, not accepted.** It does not appear in the input: `loadPlannedScreen` calls
`serverToday()` itself and returns the day it read, exactly as every sibling in
`src/server/fns/recurring.ts` does — that file's docblock states the rule, "`today` enters here, once
per call, from `#/server/clock`". The `today` parameter on `upcomingSchema` is the layer below: it
exists so the _repository_ takes the day as a parameter and reads no clock ("a parameter, never a
clock read in a repository"), and the server function is what supplies it. Accepting it from a caller
would let a client pick which of its periods count as overdue, which is a permission question dressed
as a shape.

Validation is Zod at the server-function boundary and again in the repository, per `AGENTS.md`;
`policies` reuses `transactionPoliciesSchema` verbatim rather than a parallel shape, and `getUpcoming`
already parses its own input through `upcomingSchema`. Authorisation is `requireOrg()` in the server
function, and every read below it takes the `TenantScope` first parameter (ADR 0002).

**Why two figures per currency and not one.** `expectedByCurrency` is a list rather than one figure
because expectations are not converted — a workspace with a EUR subscription and a PLN bill in view
gets two rows and no arithmetic between them. Each row then carries income and expense separately,
because a recurring series can run in either direction and `expectedAmountMinor` is strictly positive
with the sign living in `direction`, exactly as `LedgerRow` holds it. `LedgerTotals` never collapses
that split either — it keeps `incomeMinor`, `expenseMinor` and `netMinor` apart — and adding an
expected salary to an expected rent would produce a figure that is neither, just a mixed magnitude.
No `netMinor` here, though: netting is a question the ledger's totals answer about money that moved,
and it is not one worth asking about money that has not.

## 📝 UI/UX

### `/recurring` — the upcoming panel gains actions

The `UpcomingPanel` table gains a final cell holding the shared `period-actions.tsx`, which renders
**Mark paid** and **Skip** here and nothing else. Not three buttons: `period-grid.tsx` renders
**Revert** _or_ the other two and never both, because Revert only means anything on a settled period
— and the panel is fed by `getUpcoming`, which returns only unsettled ones, so a Revert button on it
could never be reached. `period-actions.tsx` keeps all three cases; which it draws is a function of
the period it is given, and on this surface that function has one branch. `/transactions/planned`
carries the same two for the same reason, so the two unsettled-only surfaces agree.

The status column becomes unconditional rather than appearing only when some row is not `upcoming`:
`upcoming` and `overdue` are both reachable here and they carry different urgency, so a column that
appears and disappears is worse than one that is always there.

### The mark-paid picker's empty state

The paragraph stays and gains a button. Pressing it navigates to `/transactions/new` with the
period's account, direction, expected amount, currency, due date, category and payee as search
params, plus a return target naming the series and period. Saving the transaction returns to
`/recurring/$seriesId` with the picker reopened for that period, where the new row is now inside the
existing `±14` day window and selectable. A series whose account, category or payee is `null` — the
columns are `onDelete: 'set null'` — prefills the rest and leaves that field for the person to pick,
which is the state the form is in for any transaction typed from scratch.

The dialog still never writes a transaction. That refusal is the module's documented reason to exist
and this spec does not touch it; what changes is that declining to create one is no longer the same
as refusing to help.

### `/transactions/planned` — the expected group

- The expectations render as **one group at the top of the list**, above the paged planned
  transactions, under a row-group header that names it and says how far ahead it looks. The group is
  ordered by due date, ascending — soonest first — and keeps that order whichever way the ledger
  below it is sorted, because the ledger's sort is a question about what was booked and this group
  holds nothing that has been.
- An expectation row is visually and semantically distinct: the series name where a payee would be,
  the amount in the series' own currency, the due date, and the period status as a **word** beside
  its colour (`Upcoming`, `Overdue`) — the non-colour encoding `docs/plans/13-recurring.md`
  (`13-S1`) already requires of `period-grid.tsx`, held to here as well. Those are the only two
  statuses the group can hold, because a settled or skipped period is not in `getUpcoming`'s result.
- Each carries the mark-paid and skip actions as real buttons, keyboard-reachable without hover.
- The row is not selectable for the ledger's bulk actions, because none of them mean anything applied
  to something that has not happened.
- `ListSummary` continues to total `transactions` only, and renders the expected figures beside the
  totals under their own label — one line per currency, expected-in and expected-out each named —
  with copy that names them as expectations rather than as money.

### Reaching the screen

`/transactions` and `/transactions/planned` gain a segmented control switching between them, in the
composition `transactions-screen.tsx` already shares. No new bottom-nav destination: the nav table's
own docblock records that it was deliberately narrowed from "the whole eventual product", and a
second transactions entry would re-widen it for a mode rather than for an area.

### Accessibility

AA is the gate (`docs/ACCESSIBILITY.md`); nothing here widens the claim. Concretely: the expectation
row is a real table row in the same table, the expected group is a real row group with a header row
rather than a styled gap, its status is text as well as colour, its actions are buttons in the row
rather than hover affordances, and the segmented control is a real radio group with its current value
announced. `pnpm e2e` runs axe over both routes at zero `serious` and zero `critical`, as the
existing `e2e/recurring.visual.spec.ts` does for `/recurring`.

## 📝 Edge Cases & Failure Scenarios

- **`getUpcoming` fails while the ledger page succeeds.** The screen renders the ledger and an inline
  notice in place of the expectations, rather than an `ErrorPanel` over the whole page. A person who
  came to read their planned transactions still gets them.
- **An expectation in a currency the workspace has no rate for.** It renders in its own currency and
  contributes to its own line in `expectedByCurrency`. Nothing is converted, so there is nothing to
  fail (`docs/MONEY.md` §2.3 is not reached on this path at all).
- **A period settled in another tab.** `markPaid` on an already-paid period is the repository's
  existing error, surfaced as a toast, and the list refreshes. On that refresh the row **disappears**
  rather than turning `paid`: `getUpcoming` filters to the unsettled statuses, so a settled period
  leaves the expected group entirely. That is the right reading — the group's subject is what is
  still outstanding — but it means the screen must not promise a `paid` state it can never render,
  which is why `ExpectationRow.status` has two values and not four. The settled transaction itself
  appears on `/transactions` under the ordinary ledger rules.
- **A filter the expected group can honour.** Most of `LedgerFilters` has a counterpart on
  `ExpectationRow`, and those narrow the group rather than hiding it: `text` over `seriesName`,
  `from` / `to` over **`dueOn`** (not `bookedOn` — the group has no booking date), `accountIds`,
  `categoryIds` against the same resolved descendant set the ledger read uses, `payeeIds`,
  `direction`, and the amount window over `expectedAmountMinor` when `amountCurrency` matches the
  row's own currency. The narrowing happens in memory in `-server/planned.ts`, over the ≤50 rows
  already fetched — no SQL, no change to `getUpcoming`'s signature. A row whose `accountId`,
  `categoryId` or `payeeId` is `null` does not match a filter naming ids: absence is not a match.
- **A filter the expected group cannot honour** — `accountGroupIds`, `tagIds`, `paymentMethods`,
  `hasAttachment`. There is no counterpart to narrow by, so the whole group is **suppressed** with
  the explanatory line, rather than silently ignoring the narrowing and showing rows that do not
  match it.
- **A narrow filter against a capped group.** The cap is applied by `getUpcoming` and the narrowing
  after it, so a workspace holding more than 50 unsettled periods can filter to a match that sits
  outside the 50 nearest and see an empty group. The capped line stays visible whenever the group was
  capped, which is what stops that reading as "nothing matches" rather than "nothing matches here,
  yet". Pushing the filters into SQL would fix it and costs `getUpcoming` its signature and a filter
  translation layer; at 50 rows against a workspace's active series that is not a trade worth making
  now, and this edge case is the record of the choice.
- **The `auto_record` race.** A series with `auto_record` posts its transaction after the due date; for
  the hours between the due date and the cron pass, the period shows as `overdue` and no transaction
  exists. This is the correct reading of the state and no special case is added for it.
- **More unsettled periods than the group's cap.** `getUpcoming`'s `limit` is 50 and the group is read
  once, so a workspace with more shows the 50 nearest by due date. The group header says it is
  showing the nearest 50 and links to `/recurring`; `expectedByCurrency` sums exactly the rows shown,
  so the figure and the list never disagree. A paged expected group was rejected in Architecture
  above, and this cap is the price of that.
- **Mark paid from the list with no linkable transaction.** Same empty state, same route out; the
  return target names the list rather than the series detail.
- **An empty `/transactions/planned`.** The existing empty state gains a line pointing at `/recurring`
  when the workspace has series but no planned rows — which is the state most workspaces are in today
  and the one that produced this issue.

## 📝 Risks & Impact Review

**Blast radius.** One new route-local server module, one widened view type, two touched routes, one
extracted component, and one widened repository projection. No schema change, no new write path, no
change to any repository function's **signature**, and no change to what `pageTransactions`,
`countTransactions` or `sumTransactions` return. `getUpcoming` is the one repository function whose
**return shape** grows — three nullable ids added to `UpcomingPeriod` — which is additive, and
`/recurring`, its only other caller, ignores them.

**Protected surfaces** (`BACKWARD_COMPATIBILITY.md`):

- _Message catalogue_ — new keys only, EN and PL in the same change (skill `i18n-messages`). No stored
  row references a removed key, because none is removed.
- _Public URLs_ — `/transactions/planned` already exists; it gains a link, not a new address.
- _Stored money_ and _D1 schema_ — untouched. This is the single strongest argument for the chosen
  bridge, and the thing a human confirming Q2 is trading away if they prefer materialised rows.

**The money risk, stated plainly.** The one way this change can show a person a wrong number is by
folding an expected amount into `LedgerTotals`. The design prevents it three times over: the union
member has no reference amount to sum, `sumTransactions` is not passed the expectations at all, and a
case in `src/server/repos/__tests__/money-invariants.test.ts` asserts that a planned screen holding
expectations returns the same `totals` as the same screen without them.

**Rollback.** Phase 1 is reverted by reverting its commit; nothing persists. Phase 2 the same — no
data is written, so there is no backfill to undo and no state to migrate back. That reversibility is
a property of the read-time design and would not survive the materialised alternative.

**Tenant isolation.** No new repository function, so `tenant-isolation.test.ts` gains no case by the
`AGENTS.md` rule as written. Two are added anyway: one for `loadPlannedScreen`, which is a new
composition of two scoped reads and where the cheap assertion that A's planned screen never returns
B's expectations is exactly the one a future refactor would break silently; and one for
`getUpcoming`'s widened projection, because three new ids leaving a repository is three new ways to
leak a row id across tenants if the join ever loses its `tenantFilter`.

## 📝 Visual change expected

| Route                   | State                                              | Themes      | Widths          |
| ----------------------- | -------------------------------------------------- | ----------- | --------------- |
| `/recurring`            | Upcoming panel with actions, one row overdue       | light, dark | 360, 1280, 2560 |
| `/recurring/$seriesId`  | Mark-paid dialog, empty picker with the route out  | light, dark | 360, 1280       |
| `/transactions/planned` | Expected group above the paged planned rows        | light, dark | 360, 1280, 2560 |
| `/transactions/planned` | Totals with expected in and out, in two currencies | light, dark | 1280            |
| `/transactions/planned` | Empty, with the pointer to `/recurring`            | light, dark | 360, 1280       |
| `/transactions`         | Segmented control in its ledger position           | light, dark | 360, 1280       |

Frames go to `.ai/qa/artifacts_*/`, never into the repository (`AGENTS.md`).

## 📝 Copy

Every key lands in `src/lib/i18n/messages/en.ts` **and** `src/lib/i18n/messages/pl.ts` in the same
change (skill `i18n-messages`). EN text below; PL is the implementer's, written not translated.

The catalogue's own household-words rule governs the **displayed** text, not the key: `en.ts` states
the surface says `expense` or `entry` rather than `transaction`, and **never `ledger`**. So the two
modes read `Recorded` and `Planned`; the keys stay `transactions.mode.*`, because the rule is about
what a person reads. This document uses "ledger" freely in its own prose — that is the codebase's
word for the surface, and none of it is shown to anybody.

| Key                                        | EN text                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `recurring.markPaid.record`                | `Record the payment`                                                    |
| `recurring.markPaid.recordHint`            | `We will bring you back here to link it.`                               |
| `transactions.planned.expected`            | `Expected`                                                              |
| `transactions.planned.expected.group`      | `Expected in the next {days} days`                                      |
| `transactions.planned.expected.capped`     | `Showing the {count} soonest. See all on the recurring screen.`         |
| `transactions.planned.expected.hint`       | `Not yet money. Expected payments are never added to the totals.`       |
| `transactions.planned.expected.in`         | `Expected in`                                                           |
| `transactions.planned.expected.out`        | `Expected out`                                                          |
| `transactions.planned.expected.suppressed` | `Expected payments are hidden while this filter is active.`             |
| `transactions.planned.expected.failed`     | `Expected payments could not be loaded.`                                |
| `transactions.planned.empty.recurring`     | `Nothing planned. Your recurring payments are on the recurring screen.` |
| `transactions.planned.fromRecurring`       | `From {series}`                                                         |
| `transactions.mode.actual`                 | `Recorded`                                                              |
| `transactions.mode.planned`                | `Planned`                                                               |
| `transactions.mode.label`                  | `Which entries to show`                                                 |

`transactions.planned.fromRecurring` takes the series name as a parameter rather than concatenating,
per `docs/I18N.md`. Two keys count and therefore carry plural machinery rather than an `if (n === 1)`:
`transactions.planned.expected.group` over `{days}` and `transactions.planned.expected.capped` over
`{count}`, both authored with the catalogue's plural form in EN and PL (PL has more categories than
EN, which is the whole reason the machinery exists — skill `i18n-messages`). No other key above
counts anything.

## 📝 Resolved assumptions (autonomous defaults)

Every row below is a decision this run made without a human. Each is reversible before merge by
saying so on the spec PR.

| #   | Question                                                   | Decision                                                                                                                                                                         | Why                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | One spec, or split the settling UX from the planned merge? | **One spec, two phases; Phase 1 is severable and may merge without Q2 being answered.**                                                                                          | A fresh-context scope review returned `SPLIT` against this; the dissent is recorded below, in Scope dissent, with the two findings it produced that were applied. The document stays whole because `.ai/specs/AGENTS.md` expects one spec to span several implementation pull requests, one per phase.                                                                                                                                  |
| Q2  | Which bridge — materialise, merge at read, or no merge?    | **Merge at read time.** ⚠ NEEDS HUMAN CONFIRMATION                                                                                                                               | It adds no writer, no migration and no stored money, and it is the only option that upholds `13-S1`'s rule that an expectation has no reference amount. But it forecloses the materialised option, under which the planned screen's filters, paging and bulk actions would work with no new code — and reversing this choice after Phase 2 is a rewrite of Phase 2, not an edit. On a `risk-high` money surface that is a human's call. |
| Q3  | Totals when an expectation row is in view?                 | **Totals stay over `transactions` only**; expectations shown separately, one figure per currency.                                                                                | `docs/plans/13-recurring.md` (`13-S1`) states that `expected_amount_minor` is never summed into a report. A combined figure would be money that has not moved, under a heading that says it has.                                                                                                                                                                                                                                        |
| Q4  | Does `/transactions` show expectations too?                | **No expectation rows and no change to its totals.** `LEDGER_POLICIES` keeps `planned: 'exclude'`. The ledger does gain the mode switch of Q7, which is navigation, not content. | Smallest scope that ships something working. The forecast case already has a designed shape (`{ visibleTo }`) and deserves its own decision rather than arriving as a side effect of this one.                                                                                                                                                                                                                                          |
| Q5  | Does the route out of the empty picker come back?          | **Yes** — a return target in the search params reopens the picker for that period.                                                                                               | It costs only search params, adds no server surface, and without it the feature is "leave, remember what you were doing, come back and start again".                                                                                                                                                                                                                                                                                    |
| Q6  | Generalise the row model for loan instalments now?         | **No.** Name the seam and the owner module; implement recurring only.                                                                                                            | Loans are unbuilt (`docs/plans/28-loans.md`, no repository or route exists). Generalising against one caller invents an abstraction; `docs/SPEC.md` §8 is satisfied by naming the owner so the loans stage extends rather than duplicates.                                                                                                                                                                                              |
| Q7  | Nav destination, or a cross-link?                          | **A segmented control on the transactions screen.**                                                                                                                              | `destinations.ts` records that the nav table was deliberately narrowed; a second entry for a mode rather than an area re-widens it. A segmented control also makes the two modes visibly two modes.                                                                                                                                                                                                                                     |

## 📝 Scope dissent (recorded, not resolved)

A fresh-context reviewer was given this file and nothing else, and returned **`VERDICT: SPLIT`**. Its
argument, in its own terms: Phase 1 and Phase 2 are two independently deployable scopes; Phase 2 is
gated on `Q2` while Phase 1 is not, so one unanswered architectural question blocks exactly half the
plan and leaves the other half shippable; and `Q1`'s justification - a shared component and a risk of
two different mark-paid affordances - argues code reuse rather than an indivisible capability, both
of which survive a split if the second spec simply points at `period-actions.tsx`.

That reasoning is accepted as far as it goes, and two of its findings were applied: `Q4` no longer
claims the ledger is untouched when the Visual-change table shows a mode switch on it, and `Q1` now
states that Phase 1 is severable rather than implying the two phases travel together.

It is not accepted as a reason to split the document, for a reason the reviewer was deliberately
denied: in this repository a spec is **expected** to span several independently merged
implementation pull requests. `.ai/specs/AGENTS.md` requires the `Implementation` row to list them
"in the order they merged" and to be appended to "when a phase merges - every phase, not only the
last". One spec with two phases is the shape that convention describes; two specs would either
duplicate the SPEC section 8 analysis that both phases rest on, or leave Phase 1's spec without the
reason it exists.

One reviewer finding is rejected on the facts: it reports that the filter-suppression rule in Edge
Cases appears in no implementation step. Step 8 carries it.

## 📋 Phasing

**Phase 1 — settle a period from where it is visible.** Fixes defects 1, 2 and 4. No new server
module, no change to the transactions read path. Independently shippable and independently useful:
after it, a person can mark a period paid from the list, can get to the payment form when nothing is
linkable, and can find `/transactions/planned` at all.

**Phase 2 — expectations on the planned screen.** Fixes defect 3. Depends on Phase 1 only for the
extracted action component. Gated on Q2 being confirmed.

## 📋 Implementation Plan

**Copy lands in the step that renders it, never in a later one.** `MessageKey` is derived from
`en.ts`'s own keys (`src/lib/i18n/types.ts`), so a component referencing a key that has not been
added yet is a typecheck failure, and `pnpm typecheck` is in the gate. A step that draws a label
therefore lands that label's EN and PL entry in the same commit; there is no separate "copy" step.

### Phase 1

1. **Extract the period row actions.** Create `src/components/app/recurring/period-actions.tsx` from
   the action cell in `src/components/app/recurring/period-grid.tsx` (lines 209-240), taking the
   period and the three callbacks. Point `period-grid.tsx` at it. _Test:_ the existing
   `e2e/recurring.visual.spec.ts` passes unchanged and the series detail screen is pixel-identical.
2. **Give `UpcomingPanel` the actions.** In `src/routes/_app/recurring/index.tsx`, render
   `period-actions.tsx` in a new final cell and make the status column unconditional. Wire the
   callbacks to the existing `markPeriodPaid` and its siblings in `src/server/fns/recurring.ts`, and
   to `MarkPaidDialog`. _Test:_ a Playwright case marks a period paid from `/recurring` without
   visiting the detail route; axe stays at zero `serious` / zero `critical`.
3. **Route out of the empty picker, with its copy.** In
   `src/routes/_app/recurring/-ui/mark-paid-dialog.tsx`, add the button beside
   `recurring.markPaid.empty`, navigating to `/transactions/new` with the prefill and return target.
   Extend the new-transaction route's `validateSearch` to accept them. Land
   `recurring.markPaid.record` and `recurring.markPaid.recordHint` in EN **and** PL in this same
   step, because the button that reads them ships here. _Test:_ a unit test on the period → prefill
   mapping (amount stays integer minor units in the series' currency, the due date is passed as a
   calendar date, a `null` account leaves the field unset rather than inventing one); the i18n parity
   test is green; a Playwright case walks empty picker → form → save → picker reopened with the new
   row selectable.
4. **Reach the screen.** Add the segmented control to
   `src/routes/_app/transactions/-ui/transactions-screen.tsx`, switching `/transactions` and
   `/transactions/planned` while preserving the current filter search params, landing
   `transactions.mode.*` in EN and PL in the same step. _Test:_ a Playwright case switches modes and
   asserts the filters survive; i18n parity; axe on both routes.

### Phase 2 — gated on Q2

5. **Widen `getUpcoming`'s projection.** Add the series' `accountId`, `categoryId` and `payeeId` —
   nullable — to the `select` and to `UpcomingPeriod` in `src/server/repos/recurring.ts`. No change
   to the signature, the filter, the order or the limit. _Test:_ a case in
   `src/server/repos/__tests__/tenant-isolation.test.ts` asserting the three new ids never cross a
   tenant boundary; the existing `/recurring` tests pass unchanged.
6. **Widen the row model.** Add `kind` to `LedgerRow`, add `ExpectationRow` and `LedgerEntry` to
   `src/components/app/transactions/types.ts`, and `toExpectationRow` to
   `src/routes/_app/transactions/-lib/rows.ts`. _Test:_ a unit test asserts `toExpectationRow` produces
   no reference amount and no rate, preserves the series' own currency, and maps `derivedStatus` to
   the two-value `status`.
7. **Compose the screen's read.** Add `src/routes/_app/transactions/-server/planned.ts` with
   `loadPlannedScreen`: `loadTransactions` for the paged rows, one unpaged `getUpcoming`
   (`{ today: serverToday(), within: 30, limit: 50 }`) for the expected group, then narrowing that
   group in memory by the filters it has a counterpart for and suppressing it entirely under the ones
   it does not (Edge Cases above lists both sets). Returns `today`, `expectations` and
   `expectedByCurrency`. Zod on the input; `requireOrg()` at the boundary; no SQL;
   no `today` in the input. _Test:_ unit tests that each shared filter narrows the group and each
   transaction-only filter suppresses it, that a `null` `accountId` does not match an `accountIds`
   filter, that `from` / `to` are read against `dueOn` and not `bookedOn`, that the expected group is
   ordered by `dueOn` ascending
   and is byte-identical across all four `LEDGER_SORT_FIELDS` and both directions, that advancing the
   cursor to page 2 returns the same `expectedByCurrency` as page 1 (the regression the paging design
   exists to prevent), and that `expectedByCurrency` splits income from expense per currency; a case
   in `src/server/repos/__tests__/tenant-isolation.test.ts` that A's planned screen returns none of
   B's expectations.
8. **Render the expected group.** Point `src/routes/_app/transactions/planned.tsx` at
   `loadPlannedScreen`, render the group above the paged rows with its header, the status word and the
   row actions (mark paid and skip — never revert, which unsettled data cannot reach), exclude
   expectations from bulk selection, and suppress them under a transaction-only
   filter with the explanatory line. Land `transactions.planned.expected.group`, `.capped`, `.hint`,
   `.suppressed`, `.failed` and `transactions.planned.fromRecurring` in EN and PL here, with the
   plural forms for `{days}` and `{count}`. _Test:_ a Playwright case asserting a recurring period
   appears on `/transactions/planned` and is absent from `/transactions`; i18n parity; axe on the
   mixed list.
9. **Totals.** Render the expected figures beside `ListSummary`, one line per currency with
   `transactions.planned.expected.in` and `.out` — landed in EN and PL in this step. _Test:_ a case in
   `src/server/repos/__tests__/money-invariants.test.ts` asserting that a planned screen holding
   expectations returns byte-identical `totals` to the same screen without them, that a two-currency
   expectation set produces two lines and no conversion, and that an expected income and an expected
   expense in one currency stay two figures and are never netted.
10. **Empty states.** Land `transactions.planned.empty.recurring` in EN and PL with the empty state
    that reads it, pointing at `/recurring`. _Test:_ i18n parity; a Playwright case on the empty
    planned screen with series present.

Every step leaves the application working and typechecking: steps 1-4 are additive to a screen that
already renders, step 5 widens a projection nobody reads yet, steps 6-7 add a row kind and a read the
list ignores until step 8 draws it, and every step that renders a key lands that key.

## Amendment — what Phase 2 shipped differently (#535)

Recorded so the design above and the product do not quietly disagree. The body is left as written.

1. **The expected group is its own table, not rows of the ledger grid.** The Accessibility section
   says "a real table row in the same table". The ledger is a virtualised `role="grid"` with one tab
   stop, and the group's rows each carry two real buttons that must be reachable by Tab, so putting
   them in the grid would break its keyboard model or need a second one. The group is a captioned
   `<table>` (header row, the series name as the row header, the status as a word) under its own
   heading, rendered inside `TransactionList`'s container through its `leading` slot so the
   virtualiser re-measures where its rows start when the group changes height. An independent
   accessibility specialist chose this over the same-table option (confidence high); the AA claim is
   unchanged.
2. **The per-currency expected figures are not in this phase.** Step 7 describes an
   `expectedByCurrency` field and step 9 renders the figures beside `ListSummary`. Issue #535 split
   them out to #563 (blocked by #535), so `loadPlannedScreen` returns the group
   (`ExpectationGroup`: `shown | suppressed | failed`) and no totals, the keys
   `transactions.planned.expected.in` and `.out` are not landed here, and the group's hint is the
   only statement about totals. Step 9's guard is kept: a planned screen holding expectations
   returns byte-identical `totals` to the same screen without them.
3. **When the last row of the group is settled the group stays on screen** with
   `transactions.planned.expected.none`, so the heading that focus recovery falls back to still
   exists (WCAG 2.4.3). A group that never held a row is not drawn.
4. **Plural machinery selects its branch from `count`.** `transactions.planned.expected.group` is
   therefore parameterised `{count}` (days) and not `{days}`.
5. **`transactions.planned.fromRecurring` was not added.** The series name is the row header, so
   nothing would read it.
6. **A third return origin, `planned`.** Mark paid from the planned screen sends the entry form's
   Save back to `/transactions/planned?markPaid=…&series=…`, which reopens the picker once the group
   has loaded. The brief's "list" origin returns to `/recurring`, which is the wrong screen here.
7. **The empty state's pointer is a link under the description**, always shown on the empty planned
   screen, because the screen does not know whether the workspace has series.
8. **The per-currency expected figures shipped in #563, with the group and computed in the
   component layer.** Step 9 says they sit beside `ListSummary` and step 7 says the planned read
   returns an `expectedByCurrency` field. They are drawn inside the expected group, under their own
   label (`transactions.planned.expected.figures`), so they also appear when the ledger is empty and
   `ListSummary` is not drawn, and `expectedFiguresByCurrency` sums the rows the group lists, so the
   figure and the table cannot disagree and a capped group's figures cover the listed rows only.
   Nothing is added to the server payload, the repository layer or `LedgerTotals`, so step 9's test
   home in `money-invariants.test.ts` no longer applies: the byte-identical `totals` case stays, and
   the two-currency and never-netted cases live in
   `src/components/app/transactions/__tests__/expectation-figures.test.ts`. A currency whose sum
   overflows is left out of the figures rather than reaching render.
