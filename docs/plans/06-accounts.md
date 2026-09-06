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

### Reference rows

`ACCT-07 missing → done` — the balance adjustment as a real transaction.
`ACCT-08 missing → done` — account groups, the tree, and membership.

### Owned paths

- `src/server/repos/account-groups.ts` — new
- `src/server/fns/account-groups.ts` — new
- `src/server/accounts/adjust-balance.ts` — new
- `src/routes/_app/accounts/groups.tsx` — new
- `src/routes/_app/accounts/-ui/group-tree.tsx` — new
- `src/routes/_app/accounts/-ui/adjust-balance-dialog.tsx` — new
- `src/server/repos/__tests__/account-groups.test.ts` — new
- `e2e/account-groups.visual.spec.ts` — new

### Data and migration

`account_groups` and `account_group_members` exist from `00-S5`. No schema change.

Group nesting is **one level** — a group may have a parent, and a parent may not itself have one.
This is a repository invariant, asserted on every write, not a `CHECK`, because the depth rule is a
product decision that could change without a migration.

### Server (repo, server function, Zod)

- **Repository.** `account-groups.ts`: `listGroups`, `createGroup`, `updateGroup`, `deleteGroup`,
  `setGroupMembers`, `reorderGroups`. `deleteGroup` **moves its accounts to ungrouped** rather than
  refusing or cascading — an account is not owned by a group.
- `src/server/accounts/adjust-balance.ts` exports `adjustBalance({ accountId, targetMinor,
bookedOn, note })`. It computes the delta against the account's balance **on that date** and writes
  a **real transaction** with `is_balance_adjustment = true`, `direction` derived from the delta's
  sign, and the account's own currency. There is no code path that writes
  `accounts.current_balance_minor` directly.
- **Server function.** `listGroups`, `createGroup`, `updateGroup`, `deleteGroup`, `setGroupMembers`,
  `reorderGroups`, `adjustBalance`.
- **Zod.** `adjustBalance` takes `{ accountId, targetMinor: z.number().int(), bookedOn: z.iso.date(),
note: z.string().max(500).optional() }`. `targetMinor` is an **integer** at the schema, so a client
  that sends `1234.5` is rejected before any arithmetic happens.
- **Authorisation.** `requireOrg()`; group writes require `owner | admin` in a multi-member workspace.
- **Ledger batching.** `adjustBalance` runs inside `runWithLedgerBatch` — it writes a transaction, so
  the account's history rebuilds exactly as it would for any other write.

### UI (route, components)

- **Route.** `/accounts/groups`, SSR default. The adjustment dialog is opened from
  `/accounts/$accountId` and lives in this stage because the write does.
- **Components.** Reuses `GridList`, `Dialog`, `MoneyField`, `DatePicker`, `TextArea`, `Menu` and
  `reorder-menu`. New: `group-tree.tsx`, `adjust-balance-dialog.tsx`.
- **States.** Empty: _"No groups yet"_ explaining what a group is for, with one action. Skeleton:
  three tree rows. Error: `ErrorPanel` retryable.
- **Tokens.** None new.
- **Accessibility.** `group-tree.tsx` is a RAC `GridList` with real tree semantics and full keyboard
  operation; moving an account between groups is available from `reorder-menu`'s _Move to…_ item as
  well as by drag. The adjustment dialog shows the **computed delta as text** before confirming —
  "This will record an expense of 120,00 zł on 2026-08-20" — because the person is choosing a target
  and the system is writing a delta, and hiding that is how corrections get double-applied.

### Quota

No new metric. A group is not metered: groups are organisation, not capacity. Stated explicitly so a
later stage does not add one silently.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A, in A's scope, attempts `updateGroup`, `deleteGroup`,
`setGroupMembers` (with B's account ids **and** with A's accounts onto B's group) and `adjustBalance`
against B's account. Every one is a `NotFoundError`; B's groups, memberships and balances are
unchanged. Functions covered: all six group exports plus `adjustBalance`.

### Money invariant

**This stage's whole reason to exist is one invariant: a correction is a transaction, never a silent
overwrite.** Cases in `money-invariants.test.ts`:

- _`adjustBalance` writes exactly one transaction row with `is_balance_adjustment = true`_ and writes
  no `accounts.current_balance_minor` value directly.
- _the delta is computed against the balance on `bookedOn`, not today_ — adjusting a past date on an
  account with later transactions produces the delta for that date, and the later transactions still
  apply on top.
- _adjusting to the same balance writes nothing_ and returns a no-op result rather than a zero-amount
  transaction, because a zero row pollutes every list.
- _the adjustment is in the account's own currency_ and its `ref_amount_minor` is computed at
  `bookedOn`'s rate like any other transaction.

### Verification

- Command gate.
- `account-groups.test.ts`: one-level nesting enforced; delete moves accounts to ungrouped; the four
  money cases above.
- Browser evidence: `/accounts/groups` with a two-level tree, both themes, at 360 / 1280 / 2560 px,
  plus the **adjustment dialog showing the computed delta** and the _Move to…_ menu open.
- `e2e/account-groups.visual.spec.ts` runs axe on `/accounts/groups` and on the open dialog: zero
  `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

None.
