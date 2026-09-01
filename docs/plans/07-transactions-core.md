# 07 — Transactions core

## Area brief

The transaction is the product's atom, and this is the plan with the highest blast radius: every
later plan reads through its query layer and writes through its policies.

Four things ship here: the **write path** with explicit policies and `assertScopedWrite`; the
**`ref_amount` computation** that fixes an amount to its booking date's rate forever; the **query
layer** (filters, sorting including the correlated-subquery name sorts, keyset pagination); and the
two screens — the virtualised list and the entry form.

**Policies are explicit, never defaulted.** A read or write of `transactions` must state its
`PlannedPolicy` (`only | exclude | { visibleTo }`), `BalanceAdjustmentPolicy`, `TransferPolicy` and
`CompletenessPolicy`. A query that forgets one does not compile. This prevents the single largest bug
class in a ledger: a report that silently includes planned rows, or a balance that silently excludes
adjustments.

What this plan does not own: transfers and their four ref-amount cases (plan `10`), splits (plan
`11`), categories, tags and payees (plan `08`), and balance history (plan `09`).

---

## Stage 07-S1 — The write path, policies and `ref_amount`

### Stage id

`07-S1` · Wave 2 · effort **XL**.

### Reference rows

`TXN-01 missing → done` — the transactions repository with create, update and delete.
`TXN-02 missing → done` — the four policy types and `assertScopedWrite` on every transactions query.
`TXN-03 missing → done` — `ref_amount_minor` and `rate_e10` written at `booked_on`'s rate.

### Owned paths

- `src/server/repos/transactions.ts` — new
- `src/server/repos/transaction-policies.ts` — new
- `src/server/transactions/ref-amount.ts` — new
- `src/server/fns/transactions.ts` — new
- `src/server/repos/__tests__/transactions.test.ts` — new
- `src/server/repos/__tests__/money-invariants.test.ts` — new
- `src/server/transactions/__tests__/ref-amount.test.ts` — new

### Data and migration

`transactions` exists from `00-S5`. No schema change.

Columns written here: `account_id`, `direction`, `amount_minor`, `currency_code`, `ref_amount_minor`,
`ref_currency_code`, `rate_e10`, `booked_on`, `booked_at`, `category_id`, `payee_id`,
`payee_locked`, `note`, `payment_method`, `transfer_kind`, `transfer_id`, `is_planned`,
`is_balance_adjustment`, `refund_linked`, `import_batch_id`, `import_source_hash`,
`categorization_source`, `created_by_user_id`.

`booked_on` is a **calendar date the person chooses**, defaulted from their timezone
(`docs/MONEY.md` §6). `booked_at` is epoch-ms and exists only for intraday ordering — it is never a
day bucket, and no query truncates it to a date.

### Server (repo, server function, Zod)

- **Repository.** `src/server/repos/transactions.ts`: `createTransaction`, `updateTransaction`,
  `deleteTransaction`, `getTransaction`, and the read functions of `07-S2`.
- **`transaction-policies.ts`** exports the four policy types and `applyPolicies(query, policies)`.
  Every exported function of `transactions.ts` takes a `policies` argument with **no default**. A
  caller that wants everything says so explicitly with `{ planned: 'include', adjustments:
'include', transfers: 'include', completeness: 'any' }`, and that call is greppable.
- **`assertScopedWrite`** (from `04-S2`) runs on every write. A dynamically-built predicate list that
  collapses to empty throws _"refusing to write to every transactions row"_.
- `src/server/transactions/ref-amount.ts` exports `computeRefAmount({ amountMinor, currencyCode,
bookedOn, scope })`, returning `{ refAmountMinor, refCurrencyCode, rateE10 }`. It calls
  `resolveRate` from `03-S3` for `booked_on` — **not today** — and throws `RateUnavailableError`
  rather than defaulting.
- **Server function.** `createTransaction`, `updateTransaction`, `deleteTransaction` (POST),
  `getTransaction` (GET).
- **Zod.** `amountMinor` is `z.number().int().positive()` — the **sign lives in `direction`**, not in
  the amount, so there is exactly one representation of "spent 20". A negative amount is a schema
  rejection. `bookedOn` is `z.iso.date()`. The input is parsed a second time in the repository.
- **Authorisation.** `requireOrg()`; the `account_id` is validated to belong to the scope in the
  repository, because a well-formed id from the client is not an authorised id.
- **Ledger batching.** All three writes run inside `runWithLedgerBatch` at the server-function
  boundary. The batch collects touched account ids and enqueues **one** rebuild per account after the
  function settles — **including when it throws**, because rows may already be committed.
- **Deletion guards.** `deleteTransaction` refuses when `refund_linked` is true (the refund link must
  be removed first) and when the row is one leg of a transfer with `transfer_kind = 'internal'`
  (deleting a leg is `10-S1`'s paired delete, not a single-row delete).

### UI (route, components)

- **Route.** None. Screens are `07-S2` and `07-S3`.
- **Components.** None.
- **States.** Not applicable.
- **Tokens.** None.
- **Accessibility.** None at this layer.

### Quota

Transactions are **not metered** — a person's own history is not a thing to ration, and a quota on it
would make the product useless at exactly the moment it becomes valuable. Stated in one sentence
rather than left implicit, because every other write path in this plan set has a quota heading with a
metric in it and a reader will wonder.

What **is** bounded: `IMPORT_MAX_ROWS` per batch (plan `19`), which is a job size, not a quota.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A, in A's scope, attempts `getTransaction`,
`updateTransaction` and `deleteTransaction` on B's transaction ids, and `createTransaction` with B's
`account_id`, B's `category_id` and B's `payee_id`. Every one is a `NotFoundError`, and B's rows are
unchanged. Functions covered: all four write-path exports.

**Plus the parenting case that matters most here:** a `transfer_id` belonging to B, supplied by A,
does not link A's new row to B's transfer — it is a `NotFoundError` before the insert.

### Money invariant

**This stage creates `money-invariants.test.ts`** and seeds it with the cases every later stage
extends. The invariants it holds:

- _`ref_amount_minor` is written once, at `booked_on`'s rate._ Creating a transaction on 2026-03-15
  and later changing the rate for that date does **not** change the stored `ref_amount_minor`.
  Re-reading returns the original.
- _no read path recomputes a conversion._ `transactions.test.ts` asserts no exported read joins
  `exchange_rates`.
- _`rate_e10` is stored on the row_, so the conversion is auditable and reproducible without a rate
  join.
- _an amount is a positive integer and the sign is `direction`._ A negative `amount_minor` cannot be
  created through any path.
- _a transaction in the base currency has `ref_amount_minor === amount_minor` and `rate_e10 === 1e10`
  exactly_ — no rounding drift on the identity conversion.
- _changing `booked_on` recomputes `ref_amount_minor` at the new date's rate_, because the date is
  what the rate is anchored to. This is the one sanctioned recomputation and it is a **write**, not a
  read.
- _no float touches the path_: `computeRefAmount` composes integer arithmetic and its result equals a
  hand-computed integer exactly, with half-to-even rounding at the single final step.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `transactions.test.ts`: the policy argument is required (a `@ts-expect-error` fixture proves a
  policy-free call does not compile); `assertScopedWrite` fires on a collapsed predicate list; the two
  deletion guards; the ledger batch enqueues one rebuild per touched account, once, including on
  throw.
- `ref-amount.test.ts`: EUR→PLN at a known rate produces a hand-computed integer; a missing rate
  throws rather than defaulting; the base-currency identity case; a 0-digit currency (JPY) and a
  3-digit currency (KWD) both round correctly at the single final step.
- `money-invariants.test.ts` with the seven cases above.
- No browser evidence and no axe run: this stage ships no surface.

### Definition of done

§7 items 1–3, 5 and 6. Item 4 does not apply (no surface).

### Blockers

None.

---

## Stage 07-S2 — The query layer and the transaction list

### Stage id

`07-S2` · Wave 2 · effort **XL**.

### Reference rows

`TXN-04 missing → done` — the filter, sort and keyset-pagination query layer.
`TXN-05 missing → done` — the virtualised transaction list with the filter bar and bulk select.

### Owned paths

- `src/server/repos/transaction-queries.ts` — new
- `src/routes/_app/transactions/index.tsx` — new
- `src/routes/_app/transactions/-server/list.ts` — new
- `src/routes/_app/transactions/-ui/transaction-row.tsx` — new
- `src/routes/_app/transactions/-ui/filter-bar.tsx` — new
- `src/routes/_app/transactions/-ui/bulk-actions.tsx` — new
- `src/routes/_app/transactions/-lib/filters.ts` — new
- `src/server/repos/__tests__/transaction-queries.test.ts` — new
- `e2e/transactions.visual.spec.ts` — new

### Data and migration

No schema change. The covering indexes this query layer needs on `transactions` are a
`00-foundations.md` requirement and land in `00-S11`; until then the queries are correct and slower,
which is the right order — an index added for a query that does not exist is a guess.

### Server (repo, server function, Zod)

- **Repository.** `transaction-queries.ts`: `pageTransactions({ filters, sort, cursor, policies })`,
  `countTransactions`, `sumTransactions`.
- **Filters:** date range on `booked_on`, account, account group, category (including descendants),
  tag, payee, direction, amount range (in **minor units**, in a stated currency), payment method,
  `transfer_kind`, planned, has-attachment, free-text over `note` and payee name.
- **Sorting.** `booked_on` then `booked_at` then `id` is the default and every sort ends in `id`, so
  the keyset cursor is total. **Sorting by account, category or payee name uses a correlated
  subquery** with `NULLS LAST` and the same `id` tie-breaker — a join would multiply rows against
  `transaction_tags`, and `NULLS LAST` is explicit because SQLite's default puts nulls first, which
  puts every uncategorised row at the top of a "sort by category" and looks like a bug.
- **Pagination** is keyset on the sort tuple, never `OFFSET`. `DEFAULT_PAGE_SIZE = 25`,
  `MAX_PAGE_SIZE = 100` from `04-S2`.
- **Server function.** `loadTransactions` (GET) returning `{ rows, nextCursor, totals }` where
  `totals` are computed by `sumTransactions` **over the whole filtered set**, not the page — a footer
  total that only sums the visible page is worse than no total.
- **Zod.** The filter object is `z.strictObject` with every field optional; unknown keys are a
  rejection, so a stale client sending a removed filter fails loudly instead of being ignored.
- **Authorisation.** `requireOrg()`; policies are supplied explicitly by the route
  (`{ planned: 'exclude', adjustments: 'include', transfers: 'include', completeness: 'any' }` for
  the default list, and the filter bar can change them).
- **Ledger batching.** Reads only; none.

### UI (route, components)

- **Route.** `/transactions` (`src/routes/_app/transactions/index.tsx`), SSR default. Filters live in
  the **URL search params** with a Zod `validateSearch`, so a filtered view is shareable and the back
  button works.
- **Components.** Reuses `data-table` (`00-S8`, virtualised via `@tanstack/react-virtual`),
  `filter-bar`, `Checkbox`, `Menu`, `Badge`, `Popover`, `DateRangePicker`, `MoneyField`. New:
  `transaction-row.tsx`, `filter-bar.tsx` (the product-level composition), `bulk-actions.tsx`.
- **States.** Empty (no transactions at all): the onboarding empty state shared with `26-S1`. Empty
  (filters match nothing): a **different** state — _"No transactions match these filters"_ with a
  Clear filters action, because offering "Add transaction" to somebody whose filter is too narrow is
  the wrong help. Skeleton: twelve rows at the real row height, so the scroll position does not jump
  when data arrives. Error: `ErrorPanel` retryable, with the filters preserved.
- **Tokens.** None new. Amounts are `tabular-nums`, end-aligned; income and expense use the two
  reserved semantic hues **plus a sign and a direction icon**, never colour alone.
- **Accessibility.** The list is a real `<table>` with `<th scope="col">` and a caption naming the
  active filters. Virtualisation keeps `aria-rowcount` and `aria-rowindex` accurate so a screen reader
  is told the true size. Bulk select is a header checkbox with a live-region announcement of the
  count. Every row's action menu is keyboard-reachable without hover. The filter bar's active filters
  render as removable `Tag`s with accessible names that include the value.

### Quota

No countable row: this stage reads. `analyticsHistoryMonths` (a plan module) bounds how far back a
**free** workspace may filter, and the ceiling is applied in the repository by clamping the date
range and returning the clamp in the response so the UI can say so — silently returning fewer rows
than asked for is a defect.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A, in A's scope, filters by B's `account_id`, B's `category_id`,
B's `tag_id` and B's `payee_id`. Each returns an **empty page**, not an error and not B's rows — a
filter is a filter, and a `NotFoundError` here would confirm the id exists. `sumTransactions` under
the same filters returns zero. Functions covered: `pageTransactions`, `countTransactions`,
`sumTransactions`.

### Money invariant

_Totals sum the stored `ref_amount_minor` and are integer arithmetic end to end._ Cases:

- _the footer total equals the sum of every matching row's `ref_amount_minor`_, computed in SQL as an
  integer `SUM`, not in JavaScript over a page.
- _a mixed-currency filtered set totals in base only_, and the UI labels it with the base code — a
  total with no currency, or a total that adds two native amounts, is the failure this guards.
- _a transaction excluded by `exclude_from_stats` on its account is excluded from the total but
  present in the list_, because the list is a record and the total is a statistic.
- _changing the sort never changes the total._

### Verification

- Command gate.
- `transaction-queries.test.ts`: keyset paging returns every row exactly once across pages with
  concurrent inserts; `NULLS LAST` on all three name sorts; the correlated subquery does not multiply
  rows for a transaction with three tags; the date clamp is reported; the four money cases.
- Browser evidence: `/transactions` on the seeded ~600-row workspace, both themes, at **360 / 1280 /
  2560 px**, plus **the filter bar with four active filters**, **the no-match empty state**, and
  **bulk select with 12 rows chosen** — three interaction states that are the point of the stage.
- `e2e/transactions.visual.spec.ts` runs axe on `/transactions` in the resting and the bulk-select
  states: zero `serious`, zero `critical`. A `moderate` waiver is anticipated for the virtualised
  table's `aria-rowcount` on WebKit and, if it appears, is named here with its reason before merge.
- Console silent through scroll, filter, sort and select.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 07-S3 — The entry form and the detail screen

### Stage id

`07-S3` · Wave 2 · effort **L**.

### Reference rows

`TXN-06 missing → done` — the full-page entry form, mobile-first.
`TXN-07 missing → done` — the transaction detail screen.
`TXN-08 missing → done` — the planned-transactions view.

### Owned paths

- `src/routes/_app/transactions/new.tsx` — new
- `src/routes/_app/transactions/$transactionId.tsx` — new
- `src/routes/_app/transactions/planned.tsx` — new
- `src/routes/_app/transactions/-ui/transaction-form.tsx` — new
- `src/routes/_app/transactions/-ui/detail-summary.tsx` — new
- `src/routes/_app/transactions/-server/detail.ts` — new
- `e2e/transaction-form.visual.spec.ts` — new

### Data and migration

None.

### Server (repo, server function, Zod)

- **Server function.** `loadTransactionDetail({ transactionId })` (GET) returning the row plus its
  tags, its transfer pair if any, its refund links, its attachments and its audit trail —
  one call, because a detail screen that fetches five things renders in five steps.
- **Zod.** The form's schema is the same object `createTransaction` validates, built by a factory
  taking `{ t, locale }` so its messages are localised (`02-S2`'s pattern).
- **Authorisation.** `requireOrg()` in the server function.
- **Ledger batching.** Submits go through `07-S1`'s writes, which already batch.

### UI (route, components)

- **Route.** `/transactions/new` and `/transactions/$transactionId`, SSR default; `/transactions/
planned` is the list filtered to `{ planned: 'only' }` and is a distinct route rather than a
  search param because it is a distinct mental mode.
- **Components.** Reuses `MoneyField` (`00-S10`), `DatePicker`, `Select`, `ComboBox`, `TagGroup`,
  `TextArea`, `Switch`, `Button`, `Form`, `FieldError`. New: `transaction-form.tsx`,
  `detail-summary.tsx`.
- **States.** The form's states are pristine / dirty / submitting / server-error, with the entered
  values preserved through a server error. The detail screen's empty sub-sections (no tags, no
  attachments, no refunds) each say so in one line rather than disappearing, so the screen's shape is
  stable. Skeleton: the summary block plus three sections. Error: `ErrorPanel` retryable.
- **Tokens.** None new.
- **Accessibility.** **The amount field is the first focusable control** and is focused on mount for
  `/transactions/new`, because that is the field every entry starts with. `inputmode="decimal"` with
  the numeric keypad on mobile (`27-S2` extends this). The direction control is a RAC `RadioGroup`
  with visible labels — not a colour-coded toggle. The date field accepts typing as well as the
  calendar, and the calendar is fully keyboard operable via RAC. Every field has a persistent visible
  label; placeholders are never the only label. `docs/ACCESSIBILITY.md` §3's **1.4.8** claim (visual
  presentation) is checked on this form: line length, spacing and no justified text.

### Quota

No countable row — transactions are unmetered (`07-S1`). Attachments are metered against
`storageBytes` and belong to `11-S3`.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: `loadTransactionDetail` with B's id, in A's scope, is a
`NotFoundError` with no partial payload. Function covered: `loadTransactionDetail`.

### Money invariant

_The amount the person typed is the amount stored, converted exactly once._ Cases:

- _the form emits `Minor` from `MoneyField` and never a string or a float_ — the submit handler's
  parameter type is branded, so a raw number does not compile.
- _the displayed conversion preview equals the stored `ref_amount_minor`_ after submit. A preview
  computed with a different rounding than the write is a two-cent discrepancy nobody can explain, so
  the preview calls `computeRefAmount` (through a server function) rather than approximating in the
  browser.
- _the rate and its date are shown as text beside the preview_, per `03-S2`'s recorded requirement.
- _editing a transaction and saving without changing anything writes no new `ref_amount_minor`_ — a
  no-op save must not re-anchor the row to today's rate.

### Verification

- Command gate.
- Unit: the branded-type fixture; the preview/write equality; the no-op save case; the localised
  schema factory.
- Browser evidence: `/transactions/new` in **both locales**, both themes, at 360 / 1280 / 2560 px,
  plus **the foreign-currency conversion preview**, **a field-level validation error**, and the
  detail screen of a transaction that has tags, an attachment and a refund link.
- `e2e/transaction-form.visual.spec.ts` runs axe on all three routes: zero `serious`, zero
  `critical`.
- Console silent through entry, validation and submit.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.
