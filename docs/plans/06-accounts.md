# 06 — Accounts

## Area brief

The account is where money sits. This plan ships the account model, groups and ordering, the archive
lifecycle, the credit limit, `exclude_from_stats`, the balance adjustment as a **real transaction**,
and the two account screens.

**There is no `type` column.** With no bank connectors every account is manual, so the entire
"external account, restricted fields" branch of the reference model does not exist here. That is a
simplification worth naming, because it removes a whole editability matrix and the bugs that live in
it (`00-S5`'s schema comment says the same thing at the table).

`vehicle` is deliberately absent: `ACCOUNT_CATEGORIES` has eight members and a vehicle is not one of
them, so a car is an `other` account with a balance somebody adjusts. The depreciation flow that
would justify its own category is deferred (`99-boundaries-and-blockers.md` BND-11).

`loan` was shallow here too, and is no longer: `28-loans.md` hangs the terms, the amortisation
schedule and the settlement of an instalment off the account row this plan ships. **Nothing in this
plan changes** — the loan row still carries `category`, `credit_limit_minor` and a note, and plan
`28` adds tables beside it rather than columns to it.

---

## Stage 06-S1 — The account model, the repository and the list

### Stage id

`06-S1` · Wave 2 · effort **L**.

### Reference rows

`ACCT-01 missing → done` — the accounts repository with create, read, update, archive and delete.
`ACCT-02 missing → done` — the account list screen with the overview totals.
`ACCT-03 missing → done` — `exclude_from_stats` and `status`.

### Owned paths

- `src/server/repos/accounts.ts` — new
- `src/server/fns/accounts.ts` — new
- `src/routes/_app/accounts/index.tsx` — new
- `src/routes/_app/accounts/-ui/account-card.tsx` — new
- `src/routes/_app/accounts/-ui/account-form.tsx` — new
- `src/routes/_app/accounts/-ui/overview-card.tsx` — new
- `src/server/repos/__tests__/accounts.test.ts` — new
- `e2e/accounts.visual.spec.ts` — new

### Data and migration

`accounts` exists from `00-S5`. No schema change and no migration.

The columns this stage reads and writes: `name`, `category`
(`general|cash|current|credit_card|savings|investment|loan|other`, `CHECK`-constrained),
`currency_code`, `initial_balance_minor`, `ref_initial_balance_minor`, `current_balance_minor`,
`ref_current_balance_minor`, `credit_limit_minor`, `ref_credit_limit_minor`, `status`
(`active|archived`), `exclude_from_stats`, `position`, `logo_domain`, `logo_initials`, `logo_color`,
`note`.

### Server (repo, server function, Zod)

- **Repository.** `src/server/repos/accounts.ts` on the tenant-scoped base: `listAccounts({ status,
includeExcluded })`, `getAccount(id)`, `createAccount(input)`, `updateAccount(id, patch)`,
  `archiveAccount(id)`, `restoreAccount(id)`, `deleteAccount(id)`, `reorderAccounts(ids)`.
- **`deleteAccount` refuses when the account has transactions**, and the error names the count. An
  account is archived, not deleted, once it has history; deleting one would orphan the other legs of
  its transfers. `archiveAccount` is the reversible path and is what the UI offers first.
- **Server function.** `listAccounts` (GET, returns the list plus the overview totals in one call, so
  the header does not cost a second round trip), `createAccount`, `updateAccount`, `archiveAccount`,
  `restoreAccount`, `deleteAccount`, `reorderAccounts` (POST).
- **Zod.** `z.strictObject` per input; `currency_code` must be a code the **workspace** holds, not
  merely a valid ISO code — validated in the repository against `organization_currencies`, because it
  is a data question.
- **Authorisation.** `requireOrg()` in every server function. `updateAccount` and `deleteAccount`
  additionally require `owner | admin` when the workspace has more than one member.
- **Ledger batching.** `createAccount` (with a non-zero `initial_balance_minor`), `updateAccount`
  (when `currency_code` or `initial_balance_minor` changes) and `restoreAccount` all run inside
  `runWithLedgerBatch`, which enqueues one rebuild for the touched account after the write settles.
  Changing an account's currency changes every `ref_` value in its history.

### UI (route, components)

- **Route.** `/accounts` (`src/routes/_app/accounts/index.tsx`), SSR default.
- **Components.** Reuses `Card`, `Table`, `Badge`, `Menu`, `Dialog`, `Select`, `MoneyField`,
  `Switch`, `Button` and `reorder-menu` from `src/components/ui`. New: `account-card.tsx`,
  `account-form.tsx`, `overview-card.tsx`.
- **States.** Empty: _"No accounts yet"_ with one primary action (Add account) and a secondary link to
  Import — this is the surface `26-S1` builds the guided first run on, so the copy key is shared and
  named here. Skeleton: the overview card's two figures plus four card rows. Error: `ErrorPanel`
  retryable; a single account whose balance failed to resolve renders `—`, never `0`.
- **Tokens.** None new. Every balance is `tabular-nums` and end-aligned. Archived accounts use the
  muted surface token and a `Badge`, **not** reduced opacity alone — opacity below 100% on text is a
  contrast reduction, and this product claims 7:1.
- **Accessibility.** Reordering is drag **and** `reorder-menu` (`00-S8`), and the menu is not hidden
  behind a hover. Account category is a text badge, never a colour swatch alone. The overview card's
  two figures are a description list, so a screen reader gets the label with the number.

### Quota

`accounts` is a metered metric. `createAccount` calls `assertWithinLimit(scope, 'accounts', current +
1)` **inside the repository, before the insert**. Archived accounts **do** count — otherwise the limit
is trivially bypassed by archiving and creating — and the quota error copy says so, because a person
who archives an account and still cannot create one deserves to be told why.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A, in A's scope, attempts `getAccount`, `updateAccount`,
`archiveAccount`, `deleteAccount` and `reorderAccounts` against B's account ids, and
`createAccount` with a `currency_code` that only B holds. Every one is a `NotFoundError` (the
currency case is a validation failure naming the currency, not B). B's accounts are unchanged
afterwards. Functions covered: all eight exports.

### Money invariant

_An account's `ref_` values are always against the workspace base, and are never computed on read._
Cases in `money-invariants.test.ts`:

- _`ref_initial_balance_minor` is written at creation using the rate for the account's opening date_,
  and re-reading the account never recomputes it.
- _`current_balance_minor` is never written directly by this repository_ — it is a projection the
  ledger maintains (`09-S2`). `accounts.test.ts` asserts no export of `accounts.ts` writes that
  column, by inspecting the update patch type: `TenantPatch` excludes it.
- _an account in the base currency has `ref_x === x` for every balance column_, which is the cheapest
  possible detector for a conversion applied where none was needed.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `accounts.test.ts`: delete-refuses-with-history; the currency must be held by the workspace;
  reorder is a single batched write; the quota call site fires before the insert.
- Browser evidence: `/accounts` with the seeded five-account workspace, both themes, at **360 / 1280 /
  2560 px** — six frames — plus the **empty state** and the **reorder menu open**, which are the two
  states the stage is actually about.
- `e2e/accounts.visual.spec.ts` runs axe on `/accounts`: zero `serious`, zero `critical`.
- Console silent on load, on create, on archive and on reorder.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

**`OPEN-1`** — whether the free plan gets 3 or 5 accounts. The call site and the copy exist either
way; the number is `00-S15`'s.

---

## Stage 06-S2 — The account detail screen

### Stage id

`06-S2` · Wave 2 · effort **L**.

### Reference rows

`ACCT-04 missing → done` — the account detail header, tabs and settings.
`ACCT-05 missing → done` — the credit limit and utilisation.
`ACCT-06 missing → done` — the archive / restore / delete flow with its confirmations.

### Owned paths

- `src/routes/_app/accounts/$accountId.tsx` — new
- `src/routes/_app/accounts/-ui/account-header.tsx` — new
- `src/routes/_app/accounts/-ui/account-settings-tab.tsx` — new
- `src/routes/_app/accounts/-ui/credit-utilisation.tsx` — new
- `src/routes/_app/accounts/-server/detail.ts` — new
- `e2e/account-detail.visual.spec.ts` — new

### Data and migration

None. The transactions tab reads through `07-S1`'s repository and the history tab through `09-S1`'s;
both are dependencies, and this stage renders their data rather than querying tables itself.

### Server (repo, server function, Zod)

- **Repository.** None new. This stage composes `accounts.ts` (`06-S1`), `transactions.ts` (`07-S1`)
  and `balance-history.ts` (`09-S1`).
- **Server function.** `loadAccountDetail({ accountId })` (GET) in
  `src/routes/_app/accounts/-server/detail.ts`, returning the account, its group memberships, its
  utilisation and the first page of transactions in one call.
- **Zod.** `z.strictObject({ accountId: z.string().length(25) })`.
- **Authorisation.** `requireOrg()` in the server function. **`beforeLoad` is UX** — the route's
  loader calls the same server function, and the id in the URL is not an authorised id until the
  repository has scoped it.
- **Ledger batching.** Reads only; no batch.

### UI (route, components)

- **Route.** `/accounts/$accountId`, SSR default. Three tabs — **transactions**, **history**,
  **settings** — as a RAC `Tabs` with the selected tab in the URL search params so a reload and a
  shared link land in the same place.
- **Components.** Reuses `Tabs`, `Card`, `Meter`, `Menu`, `Dialog`, `MoneyField`, `Badge`,
  `data-table`. New: `account-header.tsx`, `account-settings-tab.tsx`, `credit-utilisation.tsx`.
- **States.** Empty (transactions tab): _"No transactions in this account yet"_ with an Add
  transaction action. Empty (history tab): the message that history begins at the first transaction,
  not a blank chart. Skeleton: the header's balance block plus eight table rows. Error: `ErrorPanel`
  per tab, so a failing history tab does not blank the header.
- **Tokens.** None new. The utilisation meter uses the `warning` and `danger` families at 80% and
  100%.
- **Accessibility.** `credit-utilisation.tsx` is a RAC `Meter` with a real `aria-valuetext` reading
  _"1 200,00 zł of 5 000,00 zł used, 24 percent"_ — **the percentage is never the only channel**, and
  the threshold colours are paired with the text state (`Within limit` / `Approaching limit` /
  `Over limit`). Archive and delete are separate menu items with distinct confirmations; delete names
  the transaction count that blocks it.

### Quota

No new countable row. Editing an account consumes nothing; the `accounts` metric was consumed at
creation.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: `loadAccountDetail` with B's `accountId`, in A's scope, is a
`NotFoundError` and leaks nothing through timing or through a partially-populated response. Function
covered: `loadAccountDetail`.

### Money invariant

_Utilisation is computed from integers, in the account's own currency, and never from a base-currency
approximation._ `credit_limit_minor` and `current_balance_minor` are both native; converting either
to base first and dividing produces a percentage that moves when the exchange rate moves, which is
absurd for a credit card. Case in `money-invariants.test.ts`: _utilisation for a foreign-currency card
is unchanged when the base rate changes_.

A second case: _the header's two balances are labelled and never interchanged_ — the native balance
and the base-currency balance both appear, each with its currency code, and there is no state in
which one is rendered under the other's label.

### Verification

- Command gate.
- Unit: `loadAccountDetail` composes three sources in one round trip (asserted on the query spy);
  utilisation is rate-independent; the tab selection round-trips through the URL.
- Browser evidence: `/accounts/$id` for a **credit card at 92% utilisation** and for a
  **foreign-currency savings account**, both themes, at 360 / 1280 / 2560 px, plus the delete
  confirmation dialog and the settings tab — the delete confirmation is the point of `ACCT-06` and a
  resting header is not evidence about it.
- `e2e/account-detail.visual.spec.ts` runs axe on all three tabs: zero `serious`, zero `critical`.
- Console silent on tab change.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 06-S3 — Groups, ordering and the balance adjustment

### Stage id

`06-S3` · Wave 2 · effort **M**.

Delivered: 2026-11-01 - account groups (#640) in [PR #701](https://github.com/design4pro/money-tracker.online/pull/701),
account membership moves (#641) in [PR #778](https://github.com/design4pro/money-tracker.online/pull/778),
and the exact balance-adjustment preview (#642) in [PR #651](https://github.com/design4pro/money-tracker.online/pull/651);
all merged into `develop`.

### Reference rows

`ACCT-07 done` — the balance adjustment as a real transaction, with an exact preview for the booking date.
`ACCT-08 done` — account groups, the tree, and membership; account ordering is not included.

### Owned paths

- `src/server/repos/accounts.ts` — groups, membership moves, balance read and adjustment
- `src/server/fns/accounts.ts` — the corresponding server functions
- `src/components/app/tree/` — shared group/category move calculations
- `src/routes/_app/accounts/groups.tsx` — groups route
- `src/routes/_app/accounts/-ui/groups-screen.tsx` — screen orchestration and focus
- `src/routes/_app/accounts/-ui/group-tree.tsx` and `group-rows.ts` — group and membership rows
- `src/routes/_app/accounts/-ui/group-form-dialog.tsx` and `group-delete-dialog.tsx` — group dialogs
- `src/routes/_app/accounts/-ui/group-states.tsx` and `group-refusal.ts` — states and refusal copy selection
- `src/routes/_app/accounts/-ui/adjust-balance-dialog.tsx` — balance-adjustment preview and recording
- `src/routes/_app/accounts/-ui/__tests__/` — tree, screen, row, refusal and adjustment tests
- `src/components/app/tree/__tests__/move.test.ts` — shared move calculations
- `src/server/repos/__tests__/accounts.test.ts`, `tenant-isolation.test.ts`,
  `money-invariants.test.ts` and `account-groups.workerd.test.ts` — repository coverage
- `e2e/account-groups.visual.spec.ts` and `e2e/balance-adjustment.visual.spec.ts` — browser coverage

### Data and migration

`account_groups` and `account_group_members` exist from `00-S5`. No schema change.

Group nesting is **one level** — a group may have a parent, and a parent may not itself have one.
This is a repository invariant, asserted on every write, not a `CHECK`, because the depth rule is a
product decision that could change without a migration.

### Server (repo, server function, Zod)

- **Repository.** `src/server/repos/accounts.ts`: `listAccountGroups`, `createAccountGroup`,
  `updateAccountGroup`, `deleteAccountGroup`, `setAccountGroupMembers`, `reorderAccountGroups`
  and `moveAccountToGroup`. Deleting a group removes its memberships, promotes its child groups
  and pauses rules referencing it; accounts and their other memberships survive. A move changes
  only the source row's membership, preserving any membership in another group.
- The same module exports `adjustAccountBalance(scope, { accountId, targetMinor, bookedOn, note },
conversion)`. It computes the delta against the account's balance **on that date** and writes
  a **real transaction** with `is_balance_adjustment = true`, `direction` derived from the delta's
  sign, and the account's own currency. There is no code path that writes
  `accounts.current_balance_minor` directly.
- `getAccountBalanceOn(scope, { accountId, on })` returns `{ balanceMinor }` through the same private
  `balanceOn` helper the adjustment uses, never the cached balance.
- **Server functions.** `src/server/fns/accounts.ts` exposes `listAccountGroups` and
  `getAccountBalanceOn` as GETs; the group writes, `moveAccountToGroup` and `adjustAccountBalance`
  are POSTs.
- **Zod.** Strict schemas are validated at the server-function boundary and parsed again in the
  repository. `adjustBalanceSchema` uses `minorSchema` for `targetMinor` and `bookableDaySchema`
  for `bookedOn`; `getAccountBalanceOnSchema` uses the same date schema for `on`.
  `moveAccountToGroupSchema` requires both nullable group ids, with no omitted-key default.
- **Authorisation.** `requireOrg()`; group and membership writes require `owner | admin` in a shared
  workspace, before id lookups. Any member may read the balance or record an adjustment.
- **Ledger batching.** `adjustAccountBalance` runs inside `runWithLedgerBatch` — it writes a transaction, so
  the account's history rebuilds exactly as it would for any other write.

### UI (route, components)

- **Route.** `/accounts/groups`, SSR default. The adjustment dialog is opened from
  `/accounts/$accountId` and lives in this stage because the write does.
- **Components.** Follows the category-tree pattern: a flat React Aria `GridList` in reading order,
  shared move calculations in `src/components/app/tree/`, and a menu built per tree. See
  `DESIGN.md` → Reorderable tree. The group screen composes the tree, forms, delete dialog and states;
  the adjustment dialog reuses the money and date controls.
- **States.** Empty: _"No groups yet"_ explaining what a group is for, with one action. Skeleton:
  three tree rows. Error: `ErrorPanel` retryable.
- **Tokens.** None new.
- **Accessibility.** Only group rows drag and accept drops; their menus provide the same moves.
  Child groups are named with their parent. Account rows are menu-only: _Move to…_ and
  _Remove from this group_ act on the row's membership, with focus restoration and polite success
  announcements. Refusals use catalogue text in an always-mounted alert region.
  The adjustment dialog shows the **computed delta as text** for every valid booking date in an
  always-mounted status region; recording stays disabled until that date's balance has loaded.
  Failed reads offer a retry, and late responses cannot replace the selected date's preview.

### Quota

No new metric. A group is not metered: groups are organisation, not capacity. Stated explicitly so a
later stage does not add one silently.

### Tenant isolation test

`src/server/repos/__tests__/tenant-isolation.test.ts` covers group reads and writes with foreign
group, parent and account ids, `moveAccountToGroup` with foreign ids even on no-ops, and
`getAccountBalanceOn` with a foreign account. Foreign references return `NotFoundError` and the
other workspace's data stays unchanged. `accounts.test.ts` also covers adjustment isolation.

### Money invariant

**This stage's whole reason to exist is one invariant: a correction is a transaction, never a silent
overwrite.** Cases in `money-invariants.test.ts`:

- _`adjustAccountBalance` writes exactly one transaction row with `is_balance_adjustment = true`_ and writes
  no `accounts.current_balance_minor` value directly.
- _the delta is computed against the balance on `bookedOn`, not today_ — adjusting a past date on an
  account with later transactions produces the delta for that date, and the later transactions still
  apply on top.
- _adjusting to the same balance writes nothing_ and returns a no-op result rather than a zero-amount
  transaction, because a zero row pollutes every list.
- _the adjustment is in the account's own currency_ and its `ref_amount_minor` is computed at
  `bookedOn`'s rate like any other transaction.

### Verification

- Command gate: `validation.commands` in `.ai/agentic.config.json`.
- `src/server/repos/__tests__/accounts.test.ts`: nesting, group lifecycle, membership moves,
  stale sources and races, and balance reads agreeing with the adjustment's booking-date base.
- `src/server/repos/__tests__/account-groups.workerd.test.ts`: child promotion on group deletion in D1.
- `src/server/repos/__tests__/money-invariants.test.ts`: the four correction cases above.
- `src/components/app/tree/__tests__/move.test.ts`: shared move calculations.
- `src/routes/_app/accounts/-ui/__tests__/group-tree.test.tsx`, `groups-screen.test.tsx`,
  `group-rows.test.ts` and `group-refusal.test.ts`: menus, keyboard drag, row memberships,
  focus, announcements, dialogs and refusal mapping.
- `src/routes/_app/accounts/-ui/__tests__/adjust-balance-dialog.test.tsx`: exact delta, stale
  responses, blocked submission, retry and focus handoff.
- `e2e/account-groups.visual.spec.ts`: groups screen and open account menu axe checks in both
  themes and locales, group lifecycle, stale data and mobile targets, with console monitoring.
- `e2e/balance-adjustment.visual.spec.ts`: open-dialog axe checks in both themes and exact
  booking-date previews. Visual evidence covers the tree, open menu and past-date adjustment
  in light and dark at 360 / 1280 px.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

No delivery blocker remains for this stage. The following product questions remain outside it:

- **`OPEN-2`** — account reordering: should a drag change global `accounts.position` or per-group
  `account_group_members.position`? Decide before adding any account drag. Ordering in this stage
  means group ordering.
- **`OPEN-3`** — adding an account to a second group. Many-to-many membership is retained and
  existing multi-group rows survive; the screen offers move and remove, not an additional membership.
- **`OPEN-4`** — exposing the group's `logo_domain`, `logo_initials` and `logo_color` in the group form.
