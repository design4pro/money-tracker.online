# Settle and surface recurring periods

| Field              | Value |
| ------------------ | ----- |
| **Status**         | draft |
| **Issue**          | #363  |
| **Spec PR**        | none  |
| **Implementation** | none  |

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
   renders **Mark paid**, **Skip** and **Revert** as real buttons per row (lines 209-240), but the
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

**What is reused, unchanged:** `getUpcoming`, `markPaid`, `markSkipped` and `revertPeriod` in
`src/server/repos/recurring.ts`; the server functions in `src/server/fns/recurring.ts`
(`markPeriodPaid` and its siblings); `pageTransactions`, `countTransactions` and `sumTransactions`
in `src/server/repos/transaction-queries.ts`; the whole filter bar, virtualiser and keyboard map in
`src/routes/_app/transactions/-ui/transactions-screen.tsx`.

**What changes:**

- `src/components/app/transactions/types.ts` gains `ExpectationRow` and
  `type LedgerEntry = LedgerRow | ExpectationRow`, discriminated on a `kind` field. `LedgerRow` gains
  `kind: 'transaction'`; existing call sites set it in `toLedgerRow`.
- `src/routes/_app/transactions/-server/planned.ts` is new and composes `loadTransactions` with
  `getUpcoming`, merging the two lists by `bookedOn` / `dueOn` under the screen's current sort. It
  owns no SQL, which is what `docs/SPEC.md` §6.1 puts in `-server/` — the same justification the
  existing `-server/list.ts` docblock already gives for itself.
- `src/routes/_app/transactions/planned.tsx` reads from it instead of `loadTransactions` directly.
- The ledger list component renders an expectation row with the period's status word beside its
  colour, exactly as `period-grid.tsx` does, and the same mark-paid / skip actions.

**Data flow.** Route → `-server/planned.ts` → (`loadTransactions` | `getUpcoming`) → repositories.
Nothing reaches `recurring_periods` outside `src/server/repos/recurring.ts`, and nothing reaches
`transactions` outside `src/server/repos/`.

**Paging is the one real seam.** `pageTransactions` is cursor-paged; `getUpcoming` takes a
`{ within }` horizon and is not paged. Rather than invent a merged cursor, the expectations for the
window covered by the current page are fetched whole and merged into it, and the horizon is bounded
by the page's last `bookedOn`. A workspace with more expectations than fit one page sees the rest as
it scrolls, because the next page's horizon extends. This keeps `pageTransactions` untouched, which
is the property worth protecting.

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
  readonly currencyCode: CurrencyCode
  /** `YYYY-MM-DD`. The due date, a calendar date (`docs/MONEY.md` §1.5, §6.1). */
  readonly dueOn: string
  readonly status: 'upcoming' | 'paid' | 'overdue' | 'skipped'
  readonly accountId: string
  readonly categoryId: string | null
  readonly payeeId: string | null
}
```

There is deliberately no `refAmountMinor`, no `refCurrencyCode` and no `rateE10`. Their absence is
the type telling every downstream reader that this row cannot be summed with the others, and it is
what makes the totals rule below enforceable by the compiler rather than by review.

## 📝 API Contracts

One new server function, in `src/routes/_app/transactions/-server/planned.ts`:

```ts
loadPlannedScreen({
  policies: TransactionPolicies,   // parsed by the existing transactionPoliciesSchema
  filters: TransactionFilters,     // the existing filter shape, unchanged
  sort, cursor, limit,             // as loadTransactions
  today: string,                   // ISO date, so the derived-overdue rule is testable
}) => {
  ...TransactionListPage,          // rows, cursor, total, totals — unchanged shape
  expectations: ReadonlyArray<ExpectationRow>,
  /** Sum of expectations in view, per currency. Never folded into `totals`. */
  expectedByCurrency: ReadonlyArray<{ currencyCode: CurrencyCode; amountMinor: Minor }>,
}
```

Validation is Zod at the server-function boundary and again in the repository, per `AGENTS.md`;
`policies` reuses `transactionPoliciesSchema` verbatim rather than a parallel shape, and `getUpcoming`
already parses its own input through `upcomingSchema`. Authorisation is `requireOrg()` in the server
function, and every read below it takes the `TenantScope` first parameter (ADR 0002).

`expectedByCurrency` is a list rather than one figure because expectations are not converted. A
workspace with a EUR subscription and a PLN bill in view gets two figures and no arithmetic between
them.

## 📝 UI/UX

### `/recurring` — the upcoming panel gains actions

The `UpcomingPanel` table gains a final cell holding the same three buttons `period-grid.tsx` has
today, from the shared `period-actions.tsx`. The status column becomes unconditional rather than
appearing only when some row is not `upcoming`: with actions present, a row whose action set differs
must say why, and a column that appears and disappears is worse than one that is always there.

### The mark-paid picker's empty state

The paragraph stays and gains a button. Pressing it navigates to `/transactions/new` with the
period's account, direction, expected amount, currency, due date, category and payee as search
params, plus a return target naming the series and period. Saving the transaction returns to
`/recurring/$seriesId` with the picker reopened for that period, where the new row is now inside the
existing `±14` day window and selectable.

The dialog still never writes a transaction. That refusal is the module's documented reason to exist
and this spec does not touch it; what changes is that declining to create one is no longer the same
as refusing to help.

### `/transactions/planned` — expectation rows

- An expectation row is visually and semantically distinct: the series name where a payee would be,
  the amount in the series' own currency, the due date, and the period status as a **word** beside
  its colour (`Upcoming`, `Paid`, `Overdue`, `Skipped`) — the non-colour encoding `docs/plans/13-recurring.md`
  (`13-S1`) already requires of `period-grid.tsx`, held to here as well.
- Each carries the mark-paid and skip actions as real buttons, keyboard-reachable without hover.
- The row is not selectable for the ledger's bulk actions, because none of them mean anything applied
  to something that has not happened.
- `ListSummary` continues to total `transactions` only, and renders the expected figures beside the
  totals under their own label, one per currency, with copy that names them as expectations rather
  than as money.

### Reaching the screen

`/transactions` and `/transactions/planned` gain a segmented control switching between them, in the
composition `transactions-screen.tsx` already shares. No new bottom-nav destination: the nav table's
own docblock records that it was deliberately narrowed from "the whole eventual product", and a
second transactions entry would re-widen it for a mode rather than for an area.

### Accessibility

AA is the gate (`docs/ACCESSIBILITY.md`); nothing here widens the claim. Concretely: the expectation
row is a real table row in the same table, its status is text as well as colour, its actions are
buttons in the row rather than hover affordances, and the segmented control is a real radio group
with its current value announced. `pnpm e2e` runs axe over both routes at zero `serious` and zero
`critical`, as the existing `e2e/recurring.visual.spec.ts` does for `/recurring`.

## 📝 Edge Cases & Failure Scenarios

- **`getUpcoming` fails while the ledger page succeeds.** The screen renders the ledger and an inline
  notice in place of the expectations, rather than an `ErrorPanel` over the whole page. A person who
  came to read their planned transactions still gets them.
- **An expectation in a currency the workspace has no rate for.** It renders in its own currency and
  contributes to its own line in `expectedByCurrency`. Nothing is converted, so there is nothing to
  fail (`docs/MONEY.md` §2.3 is not reached on this path at all).
- **A period settled in another tab.** The next read returns it as `paid`; `markPaid` on an already-paid
  period is the repository's existing error, surfaced as a toast, and the list refreshes.
- **A filter that only `transactions` understands** — payment method, attachment count, split state.
  Expectations are suppressed whenever such a filter is active, with a line saying so, rather than
  silently ignoring the narrowing and showing rows that do not match it.
- **The `auto_record` race.** A series with `auto_record` posts its transaction after the due date; for
  the hours between the due date and the cron pass, the period shows as `overdue` and no transaction
  exists. This is the correct reading of the state and no special case is added for it.
- **Mark paid from the list with no linkable transaction.** Same empty state, same route out; the
  return target names the list rather than the series detail.
- **An empty `/transactions/planned`.** The existing empty state gains a line pointing at `/recurring`
  when the workspace has series but no planned rows — which is the state most workspaces are in today
  and the one that produced this issue.

## 📝 Risks & Impact Review

**Blast radius.** One new route-local server module, one widened view type, two touched routes, one
extracted component. No schema change, no new write path, no change to any repository function's
signature, and no change to what `pageTransactions`, `countTransactions` or `sumTransactions` return.

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
`AGENTS.md` rule as written. A case is added anyway for `loadPlannedScreen`: it is a new composition
of two scoped reads, and the cheap assertion that A's planned screen never returns B's expectations
is exactly the one a future refactor would break silently.

## 📝 Visual change expected

| Route                   | State                                                    | Themes      | Widths          |
| ----------------------- | -------------------------------------------------------- | ----------- | --------------- |
| `/recurring`            | Upcoming panel with actions, one row overdue             | light, dark | 360, 1280, 2560 |
| `/recurring/$seriesId`  | Mark-paid dialog, empty picker with the route out        | light, dark | 360, 1280       |
| `/transactions/planned` | Mixed list: planned transactions and expectation rows    | light, dark | 360, 1280, 2560 |
| `/transactions/planned` | Totals with a separate expected figure in two currencies | light, dark | 1280            |
| `/transactions/planned` | Empty, with the pointer to `/recurring`                  | light, dark | 360, 1280       |
| `/transactions`         | Segmented control in its ledger position                 | light, dark | 360, 1280       |

Frames go to `.ai/qa/artifacts_*/`, never into the repository (`AGENTS.md`).

## 📝 Copy

Every key lands in `src/lib/i18n/messages/en.ts` **and** `src/lib/i18n/messages/pl.ts` in the same
change (skill `i18n-messages`). EN text below; PL is the implementer's, written not translated.

| Key                                        | EN text                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `recurring.markPaid.record`                | `Record the payment`                                                    |
| `recurring.markPaid.recordHint`            | `We will bring you back here to link it.`                               |
| `transactions.planned.expected`            | `Expected`                                                              |
| `transactions.planned.expected.hint`       | `Not yet money. Expected payments are never added to the totals.`       |
| `transactions.planned.expected.suppressed` | `Expected payments are hidden while this filter is active.`             |
| `transactions.planned.expected.failed`     | `Expected payments could not be loaded.`                                |
| `transactions.planned.empty.recurring`     | `Nothing planned. Your recurring payments are on the recurring screen.` |
| `transactions.planned.fromRecurring`       | `From {series}`                                                         |
| `transactions.mode.actual`                 | `Ledger`                                                                |
| `transactions.mode.planned`                | `Planned`                                                               |
| `transactions.mode.label`                  | `Which entries to show`                                                 |

No plural machinery is needed: no key above counts anything. `transactions.planned.fromRecurring`
takes the series name as a parameter rather than concatenating, per `docs/I18N.md`.

## 📝 Resolved assumptions (autonomous defaults)

Every row below is a decision this run made without a human. Each is reversible before merge by
saying so on the spec PR.

| #   | Question                                                   | Decision                                                                                                                                                                         | Why                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | One spec, or split the settling UX from the planned merge? | **One spec, two phases; Phase 1 is severable and may merge without Q2 being answered.**                                                                                          | A fresh-context scope review returned `SPLIT` against this; the dissent is recorded above, with the two findings it produced that were applied. The document stays whole because `.ai/specs/AGENTS.md` expects one spec to span several implementation pull requests, one per phase.                                                                                                                                                    |
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
3. **Route out of the empty picker.** In `src/routes/_app/recurring/-ui/mark-paid-dialog.tsx`, add the
   button beside `recurring.markPaid.empty`, navigating to `/transactions/new` with the prefill and
   return target. Extend the new-transaction route's `validateSearch` to accept them. _Test:_ a unit
   test on the period → prefill mapping (amount stays integer minor units in the series' currency, the
   due date is passed as a calendar date); a Playwright case walks empty picker → form → save → picker
   reopened with the new row selectable.
4. **Copy.** Land `recurring.markPaid.record`, `recurring.markPaid.recordHint`,
   `transactions.mode.*` in EN and PL. _Test:_ the i18n parity test is green.
5. **Reach the screen.** Add the segmented control to
   `src/routes/_app/transactions/-ui/transactions-screen.tsx`, switching `/transactions` and
   `/transactions/planned` while preserving the current filter search params. _Test:_ a Playwright
   case switches modes and asserts the filters survive; axe on both routes.

### Phase 2 — gated on Q2

6. **Widen the row model.** Add `kind` to `LedgerRow`, add `ExpectationRow` and `LedgerEntry` to
   `src/components/app/transactions/types.ts`, and `toExpectationRow` to
   `src/routes/_app/transactions/-lib/rows.ts`. _Test:_ a unit test asserts `toExpectationRow` produces
   no reference amount and no rate, and preserves the series' own currency.
7. **Compose the screen's read.** Add `src/routes/_app/transactions/-server/planned.ts` with
   `loadPlannedScreen`, composing `loadTransactions` and `getUpcoming`, merging by date under the
   current sort, and returning `expectations` and `expectedByCurrency`. Zod on the input; `requireOrg()`
   at the boundary; no SQL. _Test:_ a unit test on the merge order with interleaved dates; a case in
   `src/server/repos/__tests__/tenant-isolation.test.ts` that A's planned screen returns none of B's
   expectations.
8. **Render the expectation rows.** Point `src/routes/_app/transactions/planned.tsx` at
   `loadPlannedScreen`, render the union in the ledger list with the status word and the row actions,
   exclude expectations from bulk selection, and suppress them under a transaction-only filter with
   the explanatory line. _Test:_ a Playwright case asserting a recurring period appears on
   `/transactions/planned` and is absent from `/transactions`; axe on the mixed list.
9. **Totals.** Render the expected figures beside `ListSummary` under their own label, one per
   currency. _Test:_ a case in `src/server/repos/__tests__/money-invariants.test.ts` asserting that a
   planned screen holding expectations returns byte-identical `totals` to the same screen without them,
   and that a two-currency expectation set produces two figures and no conversion.
10. **Copy and empty states.** Land the remaining `transactions.planned.*` keys in EN and PL, and the
    empty state pointing at `/recurring`. _Test:_ i18n parity; a Playwright case on the empty planned
    screen with series present.

Every step leaves the application working: steps 1-5 are additive to a screen that already renders,
and steps 6-10 add a row kind the list ignores until step 8 draws it.
