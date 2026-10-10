# The account groups screen, the atomic account move and the balance-adjustment preview (plan stage 06-S3)

| Field              | Value                             |
| ------------------ | --------------------------------- |
| **Status**         | ready                             |
| **Issue**          | none                              |
| **Spec PR**        | #TBD                              |
| **Implementation** | none                              |
| **Plan**           | 06-S3 (docs/plans/06-accounts.md) |

## 📝 TLDR

Plan stage `06-S3` (`docs/plans/06-accounts.md`, "Groups, ordering and the balance adjustment") was
written before the code, and the code has since delivered its server half and its dialog under
different file names. What is left is the half a person can see: **nothing in the product writes an
account group** (no route, no tree, no caller of any group server function), an account cannot be
moved from one group to another without a non-atomic remove-then-insert, the balance-adjustment
dialog shows the exact delta only when the booking date is today, and the stage's cases in
`tenant-isolation.test.ts` and `money-invariants.test.ts` were never written (their equivalents sit
in `accounts.test.ts`). This spec covers exactly that, in seven phases: a prefactoring that makes the
category tree's pure move logic generic; one atomic repository function, `moveAccountToGroup`; the
central test backfill; the `/accounts/groups` screen; a read of the balance on a day and the dialog
preview built on it; the browser evidence; and the plan amendment that records what the code is.
No schema change, no migration, no dependency, no quota.

## 📝 Problem Statement

Stage `06-S3` is **plan stage `06-S3`, `docs/plans/06-accounts.md`**. Verified against the repository
at the time of writing (commands in Resolved assumptions row 12).

**What the code already delivers**

- All group and correction logic lives in `src/server/repos/accounts.ts` (1165 lines) and
  `src/server/fns/accounts.ts` (253 lines), not in the `account-groups.ts` and
  `src/server/accounts/adjust-balance.ts` files the plan names (neither exists).
  Exports: `listAccountGroups`, `createAccountGroup`, `updateAccountGroup` (one-level nesting
  enforced from both directions, `GroupDepthError`), `deleteAccountGroup` (moves the accounts to
  ungrouped, promotes child groups, pauses rules that reference the group through
  `pauseRulesReferencing`), `setAccountGroupMembers` (replaces one group's membership wholesale,
  every id checked first), `reorderAccountGroups` (one `CASE` statement) and `adjustAccountBalance`.
  Every group write calls `assertMayAdminister` (owner or admin once the workspace has more than one
  member); every server function calls `requireOrg()` and the writes run in `runWithLedgerBatch`.
- `adjustAccountBalance` measures the delta on `bookedOn` (private `balanceOn`), writes nothing and
  returns `unchanged` for a zero delta, and writes one transaction with `isBalanceAdjustment: true`
  through `createTransaction` in the account's own currency, `ref_` at `bookedOn`'s rate. The source
  of `accounts.ts` is itself tested never to name the cached balance column.
- `src/routes/_app/accounts/-ui/adjust-balance-dialog.tsx` exists, is opened from `/accounts` and
  `/accounts/$accountId`, shows the delta as text and names what was written afterwards.
- `/accounts` draws the groups read-only (`groupAccounts` in `index.tsx`): one card per group, an
  account under the first group that claims it, an "ungrouped" card.
- `accounts.test.ts` covers one-level nesting, delete-moves-accounts, the isolation of the group
  writes and the four money cases of the stage.

**What does not hold**

1. **No UI writes a group.** `grep -rn "createAccountGroup\|updateAccountGroup\|deleteAccountGroup\|setAccountGroupMembers\|reorderAccountGroups" src --include=*.tsx`
   finds no component. There is no `/accounts/groups`, no `group-tree.tsx`, no link to either, and
   `e2e/` holds no account-groups spec. The i18n keys `accounts.group.title` and
   `accounts.group.create` exist and nothing renders them.
2. **Moving an account between groups is not atomic and has no function.**
   `account_group_members` is many-to-many on purpose (primary key `(group_id, account_id)`, a schema
   comment saying an account can be both "Joint" and "Everyday", and the rule engine's
   `account_group` condition tolerates it). `setAccountGroupMembers` deletes a group's memberships
   and then inserts, as two statements; a failure between them leaves the group empty. There is no
   repository `batch` primitive (`base.ts`; `account-balances.ts:411`, `transfers.ts:34` and
   `import-preview.ts:180` each explain why), so a move has to be ordered so that no failure leaves
   the account in neither group.
3. **The delta is previewed only for today.** The dialog computes `target − currentBalanceMinor`
   for today and prints the sentence `accounts.adjust.preview.past` for any earlier date. The stage
   requires the computed delta as text before confirming, because the person states a target and the
   system writes a delta, and a hidden delta is how a correction is applied twice. The balance on a
   day exists only as the private `balanceOn`.
4. **The stage's cases in the central test files were never written.** Neither
   `tenant-isolation.test.ts` nor `money-invariants.test.ts` contains a case for any group function
   or for `adjustAccountBalance` (no match for `AccountGroup` or `adjustAccountBalance` in either).
   `AGENTS.md` ("Always") requires both. The cases that exist are in `accounts.test.ts` and stay.
5. **The plan's owned paths and its `reorder-menu` do not exist.** `reorder-menu.tsx` was folded
   into `GridListMoveButton` (`src/components/ui/grid-list.tsx`) by the foundations reconciliation
   (`.ai/specs/implemented/2026-09-07-foundations-plan-reconciliation.md`), and the working precedent
   for a two-level reorderable tree is `src/components/app/categories/category-tree.tsx` with its
   pure `move.ts`.

**What is deliberately not in this spec**

- **Reordering accounts.** `reorderAccounts` (06-S1) has no UI caller either, and it writes the
  global `accounts.position` while a group card shows the membership order
  (`account_group_members.position`). Which order a drag inside a card changes is a product question
  this spec settles only by exclusion (Resolved assumptions row 3): it is recorded as the plan's
  `OPEN-2` in phase 7. The "ordering" in the stage title is the ordering of the groups.
- **Adding an account to a second group.** The screen's gestures are move and remove; the data
  model keeps many-to-many and existing multi-group rows stay intact (row 1). A member checklist in
  the group form (through `setAccountGroupMembers`) or an "Also add to…" item is a later change and
  is named in the plan as `OPEN-3`.
- Splitting `repos/accounts.ts` (row 5) and replacing the flat `GridList` tree with a collection
  component the pinned stack does not offer.

## 📝 Proposed Solution

1. **Prefactoring.** Make `src/components/app/categories/move.ts` generic over a structural
   `{ id; parentId }` row, move it with its test to `src/components/app/tree/`, and re-point the
   categories imports. No behaviour change.
2. **`moveAccountToGroup`** in `repos/accounts.ts`, with its server function: insert the target
   membership first, then delete the source one, idempotent on retry.
3. **Central test backfill**: the group and correction cases in `tenant-isolation.test.ts` and a new
   section 17 in `money-invariants.test.ts`.
4. **`/accounts/groups`**: the group tree, create, rename, re-parent, reorder, delete, "Move to…"
   and "Remove from this group" for accounts, the states, a link from `/accounts`, the
   "Reorderable tree" guideline in `DESIGN.md`.
5. **`getAccountBalanceOn`** (repository read plus `GET` server function) and the dialog built on it:
   the exact delta for any date, confirm disabled until the balance for the selected date has loaded.
6. **Browser evidence and the axe spec** `e2e/account-groups.visual.spec.ts`.
7. **Plan amendment**: `docs/plans/06-accounts.md` 06-S3 is rewritten to what the code is, with
   `OPEN-2` and `OPEN-3`, and the stage is marked `Delivered:` by this last phase only.

## 📝 Architecture

**Owner module of each concept** (`docs/SPEC.md` §8):

| Concept                                           | Owner                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Group and membership rows, the move               | `src/server/repos/accounts.ts` (stays where it is, row 5)                                              |
| Balance on a day                                  | `src/server/repos/accounts.ts`, `getAccountBalanceOn` over `balanceOn`                                 |
| Server functions                                  | `src/server/fns/accounts.ts`                                                                           |
| Pure tree-move arithmetic (drop, step, re-parent) | `src/components/app/tree/move.ts` (moved from `categories/`)                                           |
| The group tree and its dialogs                    | `src/routes/_app/accounts/-ui/` (`group-tree.tsx`, `group-form-dialog.tsx`, `group-delete-dialog.tsx`) |
| The route                                         | `src/routes/_app/accounts/groups.tsx`                                                                  |

**The move function.** `moveAccountToGroup(scope, { accountId, fromGroupId, toGroupId })`, where
`fromGroupId` and `toGroupId` are each a group id or `null`:

- Zod (`z.strictObject`) parses the input in the repository, as the other exports do, and the server
  function parses it with the same exported schema.
- `assertMayAdminister(scope, 'move an account between groups')`, then the account and every non-null
  group are looked up under the tenant predicate (`requireAllOwned` / `requireById`) **before any
  write**, so a foreign id is a `NotFoundError` and changes nothing.
- `toGroupId !== null`: insert `(toGroupId, accountId)` at the end of that group's run, or, if the row
  exists, leave it where it is (no primary-key conflict). Then, when `fromGroupId !== null` and differs
  from `toGroupId`, delete only the `(fromGroupId, accountId)` row. A membership in a third group
  stays. `toGroupId === null` is a pure "remove from `fromGroupId`". `fromGroupId === null` is a pure
  add. `from === to` writes nothing.
- Insert-then-delete means a failure between the two statements leaves the account in the source, the
  target or both, never in neither; a retry converges.
- No ledger batch: no balance moves. No quota: a group is organisation, not capacity.

**Tree rows.** The tree is one flat `GridList` in reading order, the pattern `category-tree.tsx`
documents: a top-level group, then its child groups, then the accounts of each. Group rows use the
generic move logic. Because membership is many-to-many, an account may appear under two groups, so
every row key is `group:<id>` or `member:<groupId>:<accountId>`, and an account's move carries the
group of the row it was invoked on. Child groups always precede the accounts of the same group.

**The balance read.** `getAccountBalanceOn(scope, accountId, on)` calls `accountRepo.requireById`
first and then the existing `balanceOn` unchanged (same `BALANCE_POLICIES`, same integer arithmetic),
so the preview and the write cannot disagree. The `GET` server function validates
`{ accountId, on: z.iso.date() }` and is open to any member (it reads one number the account page
already shows). `adjustAccountBalance` stays authoritative and still returns what it wrote.

## 📝 Data Model

No schema change and no migration. `account_groups` and `account_group_members` exist from `00-S5`.
The one-level depth rule stays a repository invariant (a product decision that could change without
a migration). The many-to-many primary key is unchanged.

## 📝 API Contracts

New, all in `src/server/fns/accounts.ts`, each behind `requireOrg()` and each re-parsed in the
repository:

| Function              | Method | Input                                                           | Returns                                        | Role                                 |
| --------------------- | ------ | --------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------ |
| `moveAccountToGroup`  | POST   | `{ accountId, fromGroupId: id \| null, toGroupId: id \| null }` | `void`                                         | owner or admin in a shared workspace |
| `getAccountBalanceOn` | GET    | `{ accountId, on: iso date }`                                   | `{ balanceMinor }` (account currency, integer) | any member                           |

Unchanged and reused by the screen: `listAccountGroups`, `createAccountGroup`, `updateAccountGroup`,
`deleteAccountGroup`, `reorderAccountGroups`, `listAccounts`. The tree does not use
`setAccountGroupMembers`.

The route applies a group drop or menu move as `updateAccountGroup` (new parent) followed by
`reorderAccountGroups` (the complete order of the run it lands in), the shape `categories/index.tsx`
documents, and surfaces a `GroupDepthError` in a `role="alert"` region as well as a toast.

## 📝 UI/UX

**Route.** `/accounts/groups`, SSR default, `validateSearch` none. Reached from a "Manage groups"
link on `/accounts` (shown in the page header next to the existing actions) and from the groups card
heading; breadcrumb back to `/accounts`.

**Tree.** `group-tree.tsx` is a RAC `GridList` (the same flat reading-order list as the category
tree, indent as a visual cue, and "<name>, inside <parent>" in the accessible name so the structure
survives being read aloud). Each group row has a drag handle and a real "More" button
(`GridListMoveButton`, never hidden behind hover) opening: _Rename_, _Add sub-group_, _Move up_,
_Move down_, _Move to top_, _Move to bottom_, _Move to…_ (re-parent: a submenu of top-level groups
and "No parent"), _Delete_. A menu item that would change nothing is disabled, not silent. Each
account row opens: _Move to…_ (a submenu of the other groups) and _Remove from this group_. The label
is **Remove from this group**, never "Not in a group", because the account may still be listed under
another group.

Groups are draggable and reorder/re-parent by drop exactly as categories do (`dropMove`: the dropped
row takes the target's parent, there is no "drop onto" gesture). **Accounts are menu-only**: a drag
that means "re-parent" for a group and "change membership" for an account is the ambiguity
`move.ts` refuses on purpose, and the menu is the guaranteed path (foundations plan, `00-S8`). This
narrows the stage's "as well as by drag" for account rows only (Resolved assumptions row 6).

**Dialogs.** `group-form-dialog.tsx` (name, optional parent among top-level groups, uses `FormModal`
with the unsaved-changes guard) and `group-delete-dialog.tsx`, which states the number of accounts
that will leave the group, that none is deleted, that child groups become top-level, and that rules
using the group will be paused.

**States.** Empty: "No groups yet" explaining what a group is for, one primary action (New group).
Skeleton: three tree rows. Error: `ErrorPanel`, retryable, per the stage. A refused move: the
sentence from the repository error in a `role="alert"` region above the tree and a toast. A plain
member of a shared workspace sees the controls and gets the server's refusal in the same region (the
client does not know the member count; the shell holds the role only).

**Balance adjustment dialog.** Under the date field, the preview card shows: for today, the delta
from `currentBalanceMinor` as now; for any other date, the balance read through
`getAccountBalanceOn` and then the same delta sentence ("An expense of 120,00 zł, dated 20 August
2026"). While the read is in flight the card says so and **Record the correction is disabled**; a
failed read shows a retryable message and does not leave the button disabled without explanation. A
response for an earlier date never overwrites the preview for the date now selected (the request is
keyed by date and a stale answer is discarded). `accounts.adjust.preview.past` is retired. The
post-save "what was written" card is unchanged.

**Accessibility.** The gate is AA (`docs/ACCESSIBILITY.md`); nothing here widens the claim. The tree
has a text name per row, focus returns to the row that moved (or to the next row after a delete), the
move result is announced in the alert region, tone is never the only channel, targets are 44 px.
`DESIGN.md` gains a "Reorderable tree" guideline in the same change that makes `group-tree.tsx` the
second call site (the category tree never got one).

## 📝 Edge Cases & Failure Scenarios

- A third level is refused by the repository with `GroupDepthError`; the UI shows its sentence and
  moves nothing. A group with children cannot be given a parent; a child cannot be a parent.
- Moving an account into a group it is already in only removes it from the source (no key conflict);
  moving it to the group it is already shown under is a no-op and the menu item is absent for it.
- An account in two groups (existing data): each row's menu acts on that row's group only; the
  other membership stays.
- Deleting a group with accounts and child groups: accounts become ungrouped (or stay in other
  groups), children are promoted, rules referencing the group are paused with the group's name
  recorded. Delete of an already-deleted group is a `NotFoundError` shown as a refusal.
- Two tabs: a stale move names a group that has been deleted; the repository returns
  `NotFoundError`, the screen invalidates the loader and shows the sentence.
- The adjustment date changes twice quickly: the first answer arrives last and is discarded.
- A foreign-currency account: the delta is in the account's own currency and the dialog never shows
  a base-currency figure as the delta.
- An archived account stays a member of its group; its row carries the existing archived `Badge`.
- A correction to the balance the account already has: `unchanged`, unchanged behaviour, and the
  preview says "Nothing".
- Adjusting a future date is still impossible in the UI (`maxValue` today); the server schema is not
  narrowed by this spec.

## 📝 Risks & Impact Review

- **Tenancy (security-sensitive).** Two new exports and a screen that sends ids. Every id is looked
  up under the tenant predicate before a write; a foreign id is indistinguishable from a typo.
  The tenant-isolation cases are part of the same phase as the function (phase 2 and 5).
- **Money.** No new write touches an amount. `getAccountBalanceOn` is a read over the same
  integers `adjustAccountBalance` reads, and the dialog subtracts with `subtractMinor`; no float and
  no base-currency approximation in the delta.
- **Backward compatibility.** Adds two server functions and one route; retires one i18n key.
  `BACKWARD_COMPATIBILITY.md` surfaces are untouched (checked in Resolved assumptions row 12).
- **Refactor risk.** The move.ts relocation touches `categories/`. It is behaviour-preserving and
  `move.test.ts` moves with it unchanged; the categories tests stay green or the phase is not done.
- **Module size.** `repos/accounts.ts` grows by roughly 80 lines. A later split is a separate refactor
  and is not blocked by this spec (row 5).

## 📝 Visual change expected

New route `/accounts/groups` (light and dark, 360 and 1280 px, and the empty, loading and error
states). `/accounts` gains a "Manage groups" link. The balance-adjustment dialog's preview card
changes for non-today dates (loading, error, delta). The category tree is visually unchanged.

## 📝 Copy

Every key lands in `en` and `pl` in the same change (skill `i18n-messages`; plurals through the
plural machinery in `docs/I18N.md`, never `if (n === 1)`). Existing and reused: `accounts.group.title`
("Groups"), `accounts.group.create` ("New group"), `accounts.group.ungrouped`, `action.retry`. New:

- `accounts.groups.title`: "Account groups"
- `accounts.groups.description`: "Folders for your accounts, such as Joint or Business. A group never changes a balance."
- `accounts.groups.manage`: "Manage groups"
- `accounts.groups.empty.title`: "No groups yet"
- `accounts.groups.empty.body`: "A group collects accounts under one name, such as Joint or Business, so the list reads the way you think about it. Accounts keep their own balances."
- `accounts.groups.error.title` / `accounts.groups.error.body`
- `accounts.groups.tree.label`: "Account groups, in display order"
- `accounts.groups.row.group`: "{name}, group, {count} accounts" (plural forms)
- `accounts.groups.row.childOf`: "{name}, inside {parent}"
- `accounts.groups.row.account`: "{account}, in {group}"
- `accounts.group.field.name`: "Group name"; `accounts.group.field.parent`: "Inside"; `accounts.group.parent.none`: "No parent"
- `accounts.group.rename`, `accounts.group.addChild`: "Rename", "Add sub-group"
- `accounts.group.move.to`: "Move to…"; `accounts.group.move.remove`: "Remove from this group"
- `accounts.group.move.toast`: "{account} moved to {group}"; `accounts.group.move.removed`: "{account} removed from {group}"
- `accounts.group.move.refused`: "That move was not made"; the repository sentence is the body
- `accounts.group.delete.action`: "Delete group"; `accounts.group.delete.title`: "Delete {name}?"
- `accounts.group.delete.body`: "{count} accounts leave this group. None is deleted. Sub-groups become top-level groups." (plural forms)
- `accounts.group.delete.rules`: "Rules that use this group will be paused until you pick another."
- `accounts.adjust.preview.loading`: "Reading the balance on {date}…"
- `accounts.adjust.preview.error`: "The balance on {date} could not be read."
- Retired: `accounts.adjust.preview.past`.

Where the text of a category key (`categories.move.top`, `categories.move.bottom`, and the up/down
pair) is identical, the implementation reuses the key through a shared one rather than copying it.

## 📋 Phasing

Seven phases, each one pull request and one ticket for `afk-to-tickets`; 1 and 2 first, then 3, 4 and
5 in any order after their dependencies, 6 and 7 last.

| Phase | Ships                                                           | Blocked by |
| ----- | --------------------------------------------------------------- | ---------- |
| 1     | Generic tree-move logic in `components/app/tree/`               | none       |
| 2     | `moveAccountToGroup`, its server function and tests             | none       |
| 3     | Central test backfill (isolation + money invariants section 17) | none       |
| 4     | `/accounts/groups` screen, dialogs, guideline, copy             | 1, 2       |
| 5     | `getAccountBalanceOn` and the exact delta preview               | none       |
| 6     | Browser evidence and `e2e/account-groups.visual.spec.ts`        | 4, 5       |
| 7     | Plan amendment and the `Delivered:` line                        | 1 to 6     |

## 📋 Implementation Plan

### Phase 1 — The tree-move logic becomes generic

- Widen `dropMove`, `stepMove`, `reparentMove`, `siblingsOf` and `hasChildren` to a structural
  `TreeRow = { readonly id: string; readonly parentId: string | null }` (they read only those two
  fields today) and move the module and `__tests__/move.test.ts` to `src/components/app/tree/`.
  `CategoryTreeItem` and `CategoryMove` keep their names in `categories/` as aliases or extensions;
  `category-tree.tsx` and `categories/index.tsx` import from the new path.
- Done when: `src/components/app/categories/__tests__/category-tree.test.tsx` and the moved
  `move.test.ts` pass with no assertion changed, and `pnpm typecheck` is green.

### Phase 2 — The atomic account move

- Add `moveAccountToGroupSchema` and `moveAccountToGroup` to `repos/accounts.ts` as designed in
  Architecture; add the server function in `fns/accounts.ts`.
- Tests in `accounts.test.ts`: add-only, remove-only, move, move into a group the account is already
  in (no key conflict), a membership in a third group survives, `from === to` writes nothing, retry
  converges, a thrown insert leaves the account in the source, a plain member of a shared workspace is
  refused, a foreign account or a foreign group (either side) is a `NotFoundError` and leaves B's
  memberships unchanged. The same foreign-id cases in `tenant-isolation.test.ts` (`AGENTS.md`
  "Always").
- Done when: those cases pass and `moveAccountToGroup` appears in the isolation file.

### Phase 3 — The stage's central cases

- `tenant-isolation.test.ts`: A, in A's scope, calls `updateAccountGroup`, `deleteAccountGroup`,
  `setAccountGroupMembers` (with B's account ids **and** with A's accounts onto B's group),
  `reorderAccountGroups` and `adjustAccountBalance` against B's rows; each is a `NotFoundError`, and B's
  groups, memberships and balances are re-read through B's scope and unchanged. `listAccountGroups`
  returns nothing of B's.
- `money-invariants.test.ts`: a new section **17 — a correction is a transaction, never an overwrite**
  with the stage's four cases: exactly one `is_balance_adjustment = true` row and no direct write of
  `current_balance_minor`; the delta is measured on `bookedOn`, later transactions still apply on
  top; adjusting to the same balance writes nothing; the adjustment is in the account's own currency
  with `ref_amount_minor` at `bookedOn`'s rate. The existing `accounts.test.ts` cases stay.
- Done when: both files carry the cases and `pnpm test` passes.

### Phase 4 — The groups screen

- `src/routes/_app/accounts/groups.tsx` with loader (`listAccountGroups` and `listAccounts`),
  `pendingComponent`, `errorComponent`, `head`; `group-tree.tsx`, `group-form-dialog.tsx`,
  `group-delete-dialog.tsx`; the "Manage groups" link on `/accounts`; `pnpm generate-routes`; copy
  in EN and PL; the "Reorderable tree" section in `DESIGN.md` (shape, tones, states, what carries the
  meaning without colour, and that it is not a data table).
- Tests: a component test per interaction that matters (menu items disabled when nothing would
  change, keyboard operation of every move, the alert region on `GroupDepthError`, focus after a
  move and after a delete), the i18n parity test, and the route in `e2e/reachability.spec.ts` if that
  spec enumerates routes.
- Done when: every gesture in UI/UX is reachable from the keyboard, the repository refusal reaches the
  alert region, and `pnpm lint`, `typecheck`, `test`, `build` pass.

### Phase 5 — The balance on a day and the exact preview

- `getAccountBalanceOn` in `repos/accounts.ts`, the `GET` server function, the dialog changes in
  UI/UX, the copy changes, and tests: the read equals the delta base used by `adjustAccountBalance` for
  the same date (one fixture, both calls), a foreign account is a `NotFoundError` (also in
  `tenant-isolation.test.ts`), an account with later transactions returns the balance on the earlier
  day, a stale response is discarded, a failed read is retryable and confirm is not stuck disabled.
- Done when: the dialog shows the exact delta for a past date and the pre-existing dialog tests
  still pass.

### Phase 6 — Evidence

- `e2e/account-groups.visual.spec.ts`: axe on `/accounts/groups` and on the open adjustment dialog,
  both themes, both locales (zero `serious`, zero `critical`), console silent on create, move and
  delete (the demo workspace is read, the spec creates its own group and removes it). Browser frames
  (outside the repository): `/accounts/groups` with a two-level tree, light and dark, 360 and
  1280 px, the **adjustment dialog on a past date showing the computed delta**, and the _Move to…_
  menu open.
- Done when: the spec passes in CI scope and the frames are attached to the pull request.

### Phase 7 — The plan says what the code is

- Rewrite the `06-S3` block of `docs/plans/06-accounts.md`: owned paths as built
  (`repos/accounts.ts`, `fns/accounts.ts`, `src/components/app/tree/`, the `-ui/` files), the
  `reorder-menu` reference replaced by `GridListMoveButton`, the tests that exist and where, `ACCT-07`
  and `ACCT-08` status; add `OPEN-2` (account reordering: global `accounts.position` or per-group
  membership order, to be decided before any account drag) and `OPEN-3` (adding an account to a
  second group). Add the `Delivered: <date> - <evidence>` line only if phases 1 to 6 are merged.
- Done when: `pnpm generate-spec-index` is clean and the plan parses (twelve `###` headings).

## 📝 Resolved assumptions (autonomous defaults)

| #   | Question                                                                      | Applied default                                                                                                                                                                                                                                                                                                                                                                         | Why                                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | What does "move an account between groups" mean with many-to-many membership? | Keep many-to-many; move = out of the row's group, into the target; "Not in a group" = remove only. No gesture creates a second membership.                                                                                                                                                                                                                                              | Decided by product-owner sub-agent (confidence high): the schema comment and the rule engine's `account_group` condition are deliberate; a single-membership rule would silently change existing data. Follow-up `OPEN-3`.                                                                                                                              |
| 2   | Is the delta previewed for any date?                                          | Yes: a tenant-scoped read, confirm disabled until the balance for the selected date has loaded, stale answers discarded, failures retryable.                                                                                                                                                                                                                                            | Decided by product-owner sub-agent (confidence medium): hiding the delta is the stage's stated failure mode and a past date is where the person's picture is weakest. Architect sub-agent (confidence medium) agreed on the read function and its tenant-isolation case.                                                                                |
| 3   | Does this spec include reordering accounts?                                   | No. Group ordering only; account reordering is `OPEN-2` in the plan.                                                                                                                                                                                                                                                                                                                    | Decided by product-owner sub-agent (confidence high): the global and per-group orders differ and choosing between them is a decision not to take silently.                                                                                                                                                                                              |
| 4   | Where does the delivered code live?                                           | Stays in `repos/accounts.ts` and `fns/accounts.ts`; the plan's owned paths are amended in phase 7; a split is a later refactor.                                                                                                                                                                                                                                                         | Decided by software-architect sub-agent (confidence medium): the atomic move needs the module's private helpers, and a split rewrites about 1000 lines and every importer for a path list.                                                                                                                                                              |
| 5   | Share or copy the tree-move logic?                                            | Generic `{ id; parentId }` and a neutral `components/app/tree/`; categories re-pointed; "Reorderable tree" guideline in `DESIGN.md`.                                                                                                                                                                                                                                                    | Decided by software-architect sub-agent (confidence medium): `move.ts` reads only those two fields; a copy would drift; a new feature importing from `categories/` is the wrong direction; the Second Call Site Rule requires the guideline.                                                                                                            |
| 6   | Are accounts draggable?                                                       | No: account rows are menu-only; groups are draggable.                                                                                                                                                                                                                                                                                                                                   | Applied by the author, covering the architect's condition to decide it: one drop target meaning "re-parent" for one row kind and "change membership" for another is the ambiguity `move.ts` refuses, and the menu is the guaranteed path. Narrows the stage's "as well as by drag" for account rows. The accessibility specialist reviewed it (row 13). |
| 7   | How is the account move atomic?                                               | Insert target then delete source, idempotent, no batch.                                                                                                                                                                                                                                                                                                                                 | Decided by software-architect sub-agent (confidence medium): no repository batch primitive exists, and insert-then-delete never leaves the account in neither group. The product-owner's "one statement batch" is not available in this codebase.                                                                                                       |
| 8   | Does the tree use real tree semantics?                                        | The flat reading-order `GridList` of the category tree, "inside <parent>" in the accessible name.                                                                                                                                                                                                                                                                                       | Applied by the author: it is the pattern already shipped and reviewed; no new component or dependency (`docs/SPEC.md` §3 freeze).                                                                                                                                                                                                                       |
| 9   | Who may write groups, and what does a plain member see?                       | Owner or admin once the workspace is shared (existing `assertMayAdminister`); the screen shows the controls and the server's refusal in the alert region.                                                                                                                                                                                                                               | Applied by the author: the client does not know the member count; this is how the account form behaves.                                                                                                                                                                                                                                                 |
| 10  | Quota for groups                                                              | None, stated so a later stage does not add one silently.                                                                                                                                                                                                                                                                                                                                | The stage text.                                                                                                                                                                                                                                                                                                                                         |
| 11  | Are the tests that exist replaced by the central cases?                       | No: the central cases are added; `accounts.test.ts` keeps its own.                                                                                                                                                                                                                                                                                                                      | Applied by the author: deleting a test needs a person (`AGENTS.md` "Ask First").                                                                                                                                                                                                                                                                        |
| 12  | Evidence for this spec                                                        | `wc -l` of `repos/accounts.ts` and `fns/accounts.ts` (1165, 253); the greps quoted in Problem Statement; `ls src/server/accounts` (absent); `grep -n "AccountGroup\|adjustAccountBalance"` on `tenant-isolation.test.ts` and `money-invariants.test.ts` (no match; sections 1 to 16 present); `gh search issues` and `gh pr list` for `06-S3` (no issue, no open spec or delivered PR). | Commands run at the time of writing (`docs/SPEC.md` §7.7).                                                                                                                                                                                                                                                                                              |
| 13  | Panel verdicts                                                                | See the table below.                                                                                                                                                                                                                                                                                                                                                                    | Recorded after the review round.                                                                                                                                                                                                                                                                                                                        |

### Panel verdicts

_To be filled after the review._
