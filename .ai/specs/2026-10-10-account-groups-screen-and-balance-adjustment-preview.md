# The account groups screen, the account move and the balance-adjustment preview (plan stage 06-S3)

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
moved from one group to another, the balance-adjustment dialog shows the exact delta only when the
booking date is today, and the stage's cases in `tenant-isolation.test.ts` and
`money-invariants.test.ts` were never written (their equivalents sit in `accounts.test.ts`). This
spec covers exactly that, in four phases, each a complete slice: **(A)** the `/accounts/groups`
screen with group create, rename, re-parent, reorder and delete, on a tree-move module made generic
for the purpose; **(B)** `moveAccountToGroup`, a single-statement repository write, with the menu
items that use it; **(C)** a read of the balance on a day, the dialog preview built on it and the
money-invariant section; **(D)** the plan amendment that records what the code is. No schema change,
no migration, no dependency, no quota.

## 📝 Problem Statement

Stage `06-S3` is **plan stage `06-S3`, `docs/plans/06-accounts.md`**. Verified against the repository
at the time of writing (commands in Resolved assumptions row 15).

**What the code already delivers**

- All group and correction logic lives in `src/server/repos/accounts.ts` (1165 lines) and
  `src/server/fns/accounts.ts` (253 lines), not in the `account-groups.ts` and
  `src/server/accounts/adjust-balance.ts` files the plan names (neither exists). Exports:
  `listAccountGroups`, `createAccountGroup`, `updateAccountGroup` (one-level nesting enforced from
  both directions, `GroupDepthError`), `deleteAccountGroup` (moves the accounts to ungrouped,
  promotes child groups, pauses rules that reference the group through `pauseRulesReferencing`),
  `setAccountGroupMembers` (replaces one group's membership wholesale, every id checked first),
  `reorderAccountGroups` (one `CASE` statement) and `adjustAccountBalance`.
- Authorisation as built: every server function calls `requireOrg()` inside its handler; every group
  write calls `assertMayAdminister` (owner or admin once the workspace has more than one member)
  after the Zod parse; `adjustAccountBalance` has no role check, like any other transaction write
  (`createTransaction` has none). **Only the account writes and `adjustAccountBalance` run in
  `runWithLedgerBatch`; the five group server functions (`fns/accounts.ts`, lines 211 to 253) do
  not**, because no balance moves.
- `adjustAccountBalance` measures the delta on `bookedOn` (private `balanceOn`), writes nothing and
  returns `unchanged` for a zero delta, and writes one transaction with `isBalanceAdjustment: true`
  through `createTransaction` in the account's own currency, `ref_` at `bookedOn`'s rate. The source
  of `accounts.ts` is itself tested never to name the cached balance column.
- `src/routes/_app/accounts/-ui/adjust-balance-dialog.tsx` exists, is opened from `/accounts` and
  `/accounts/$accountId`, shows the delta as text and names what was written afterwards.
- `/accounts` draws the groups read-only (`groupAccounts` in `index.tsx`): one card per group, an
  account under the first group that claims it, a "Not in a group" card.
- `accounts.test.ts` covers one-level nesting, delete-moves-accounts, the isolation of the group
  writes and the four money cases of the stage; `account-balances.test.ts` also exercises
  `adjustAccountBalance`.

**What does not hold**

1. **No UI writes a group.**
   `grep -rn "createAccountGroup\|updateAccountGroup\|deleteAccountGroup\|setAccountGroupMembers\|reorderAccountGroups" src --include=*.tsx`
   finds no component. There is no `/accounts/groups`, no `group-tree.tsx`, no link to either, and
   `e2e/` holds no account-groups spec. The i18n keys `accounts.group.title` and
   `accounts.group.create` exist and nothing renders them.
2. **There is no way to move an account between groups.** `account_group_members` is many-to-many on
   purpose (primary key `(group_id, account_id)`, a schema comment saying an account can be both
   "Joint" and "Everyday", and the rule engine's `account_group` condition tolerates it).
   `setAccountGroupMembers` replaces one group's membership as a delete and then an insert, two
   statements, so a failure between them leaves the group empty; it also cannot express "out of X,
   into Y".
3. **The delta is previewed only for today, and from the cache.** The dialog computes
   `target − currentBalanceMinor` for today and prints `accounts.adjust.preview.past` for any earlier
   date. The write measures `balanceOn`, the ledger sum; balances are rebuilt asynchronously through
   the `LEDGER` Durable Object, so the cached column and the sum can differ. The stage requires the
   computed delta as text before confirming, because the person states a target and the system
   writes a delta, and a hidden delta is how a correction is applied twice.
4. **The stage's cases in the central test files were never written.** `grep -c
"AccountGroup\|adjustAccountBalance"` is 0 in both `tenant-isolation.test.ts` and
   `money-invariants.test.ts`. `AGENTS.md` ("Always") requires both. The cases that exist are in
   `accounts.test.ts` and stay.
5. **The plan's owned paths and its `reorder-menu` do not exist.** `reorder-menu.tsx` was folded
   into the grid-list and category-tree code by the foundations reconciliation
   (`.ai/specs/implemented/2026-09-07-foundations-plan-reconciliation.md`); the working precedent for
   a two-level reorderable tree is `src/components/app/categories/category-tree.tsx` (a `GridList`
   with `useDragAndDrop`, a drag handle, and a row menu built from `MenuTrigger`, `Popover`, `Menu`
   and `SubmenuTrigger`) with its pure `move.ts`.
6. **The refusal copy is English and carries an id.** `GroupDepthError`'s message is
   `Account groups nest one level; <nanoid> cannot be both a parent and a child.`
   (`repos/accounts.ts:140`). The category screen shows the server's own words as `detail` under a
   catalogue title; for groups that would put an English sentence and an id in front of a Polish
   reader, and `AGENTS.md` forbids hardcoded user-facing copy.

**What is deliberately not in this spec**

- **Reordering accounts.** `reorderAccounts` (06-S1) has no UI caller either, and it writes the
  global `accounts.position` while a group card shows the membership order
  (`account_group_members.position`). Which order a drag inside a card changes is a product
  question this spec settles only by exclusion (Resolved assumptions row 3): it is the plan's
  `OPEN-2`, written in phase D. The "ordering" in the stage title is the ordering of the groups.
- **Adding an account to a second group** (`OPEN-3`) and **the group's logo fields** `logo_domain`,
  `logo_initials`, `logo_color` in the group form (`OPEN-4`). The data model keeps many-to-many and
  existing multi-group rows stay intact (row 1); the screen's gestures are move and remove.
- Splitting `repos/accounts.ts` (row 4) and replacing the flat `GridList` tree with a collection
  component the pinned stack does not offer.

## 📝 Proposed Solution

1. **Phase A, the groups screen.** `/accounts/groups` with the group tree: create, rename, re-parent,
   reorder (drag and menu), delete. The prefactoring that makes `categories/move.ts` generic ships in
   this phase because this phase is its only new caller. The `DESIGN.md` guideline, the copy, the
   link from `/accounts`, the central isolation cases for the group exports that already exist, and
   the axe spec and frames for the screen.
2. **Phase B, `moveAccountToGroup`**: one repository function that changes an account's membership
   with one SQL statement, its server function, and the two account-row menu items (_Move to…_,
   _Remove from this group_), with its isolation cases.
3. **Phase C, the exact preview**: `getAccountBalanceOn` (repository read plus `GET` server
   function), the dialog showing the delta for every date from that read, money-invariants section 17
   and the dialog's axe run and frame.
4. **Phase D, the plan says what the code is**: the `06-S3` block is rewritten, `OPEN-2` to `OPEN-4`
   are written, the stage is marked `Delivered:` when A to C are merged.

## 📝 Architecture

**Owner module of each concept** (`docs/SPEC.md` §8):

| Concept                                           | Owner                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Group and membership rows, the move               | `src/server/repos/accounts.ts` (stays where it is, row 4)                                              |
| Balance on a day                                  | `src/server/repos/accounts.ts`, `getAccountBalanceOn` over the existing `balanceOn`                    |
| Server functions                                  | `src/server/fns/accounts.ts`                                                                           |
| Pure tree-move arithmetic (drop, step, re-parent) | `src/components/app/tree/` (moved from `categories/move.ts`)                                           |
| The group tree, its row menu and dialogs          | `src/routes/_app/accounts/-ui/` (`group-tree.tsx`, `group-form-dialog.tsx`, `group-delete-dialog.tsx`) |
| The route                                         | `src/routes/_app/accounts/groups.tsx`                                                                  |

**The generic move module (phase A).** `dropMove`, `stepMove`, `reparentMove`, `siblingsOf` and
`hasChildren` read only `id` and `parentId`. They move with their test to
`src/components/app/tree/` (own `index.ts` barrel, module docblock reworded from "category" to
"row") and are typed on `TreeRow = { readonly id: string; readonly parentId: string | null }`; the
move they return is `TreeMove = { id; parentId; orderedIds }`. The re-point surface is explicit:
`category-tree.tsx`; `categories/index.ts`, which re-exports `CategoryMove`, `CategoryTreeItem` and
`MoveStep` from `./move` (the two category-specific types stay in `categories/` as
`CategoryTreeItem extends TreeRow` and `type CategoryMove = TreeMove`, in a `categories/types.ts`);
`categories/index.tsx`; and the imports of `__tests__/move.test.ts` and
`__tests__/category-tree.test.tsx`, which change path but no assertion. **These functions are only
ever called with the group rows**, never the mixed list of groups and accounts: `siblingsOf` filters
on `parentId`, and an account row in the input would corrupt the runs.

**The move function (phase B).** `moveAccountToGroup(scope, { accountId, fromGroupId, toGroupId })`,
where `fromGroupId` and `toGroupId` are each a group id or `null`. Order of operations, which is part
of the contract:

1. Parse with `moveAccountToGroupSchema`, exported and re-parsed by the server function's
   `inputValidator`: `z.strictObject({ accountId: idSchema, fromGroupId: idSchema.nullable(), toGroupId: idSchema.nullable() })`, no `.default`, no `.optional`, so an omitted key fails instead of reading as `null`.
2. `assertMayAdminister(scope, 'move an account between groups')`, so a plain member of a shared
   workspace never learns whether an id exists.
3. **Look up everything before any shortcut**: `accountRepo.requireById` for the account and
   `requireAllOwned(scope, accountGroups, [non-null ids], 'account group')` for the groups. A foreign
   id is a `NotFoundError` even on a call that would have been a no-op.
4. Then exactly one **write** statement, chosen by the arguments after one read (is the target
   membership present, and the position the account takes there):
   - `from` and `to` both set and different, the target membership absent: one scoped
     `UPDATE account_group_members SET group_id = :to, position = :end WHERE group_id = :from AND account_id = :id`
     through `membershipRepo.updateWhere`, which returns the changed rows, asserts a scoped write and
     refuses a patch that carries the tenant column (otherwise `scope.db.update` with `.returning()`,
     `assertScopedWrite` and `tenantFilter`, the way `reorderAccountGroups` is built). Updating
     `group_id` is valid: it is part of the primary key `(group_id, account_id)`, nothing references
     it, and the clash case is the next bullet.
   - the target membership already exists: one scoped, **conditional** delete of the source row
     (`DELETE … WHERE group_id = :from AND account_id = :id AND EXISTS (the target row)`), so the
     source is never removed unless the target is there; the target keeps its place.
   - `from` null: `membershipRepo.insertOnConflictDoNothing` on `[groupId, accountId]`, a pure add,
     at `:end`.
   - `to` null: one scoped delete of `(from, account)`, a pure remove.
   - `from === to`, or both null: nothing is written (the lookups of step 3 already ran).
   - `:end` is `max(position) + 1` over `account_group_members` rows **of the target group**
     (`tenantFilter(scope, accountGroupMembers, eq(groupId, :to))`), not the workspace-wide
     `nextPosition`, which takes only `accounts` or `accountGroups`.
5. **A stale source, in every branch**: when the write changes no row (the source membership was
   removed in another tab, or, in the conditional delete, the target was) the function throws
   `NotFoundError('account group membership')` rather than degrading to an add; the screen
   invalidates the loader and shows the "list changed" sentence. A membership in a third group is
   never touched.

Each branch is one write statement, so there is no partial state to converge from: the account stays
in the source until the one statement that moves it succeeds, and it is never in neither group (no
repository `batch` primitive exists, `base.ts`; `account-balances.ts:411`, `transfers.ts:34`,
`import-preview.ts:180`, and one statement does not need one). **One race is accepted and named**:
if another tab adds the target membership between the read and an `UPDATE`, the `UPDATE` hits the
primary key, the account stays in the source untouched, and the screen shows the generic catalogue
sentence. No ledger batch: no balance moves; `moveAccountToGroup` is **not** wrapped in
`runWithLedgerBatch`, like the other group writes. No quota: a group is organisation, not capacity.

**Tree rows (phase A and B).** One flat `GridList` in reading order, the pattern `category-tree.tsx`
documents: a top-level group, then its child groups, then the accounts of each group. Because
membership is many-to-many, an account may appear under two groups, so every row key is
`group:<id>` or `member:<groupId>:<accountId>`, and an account's move carries the group of the row
it was invoked on. Child groups always precede the accounts of the same group.

**The balance read (phase C).** `getAccountBalanceOn(scope, accountId, on)` calls
`accountRepo.requireById` first and then the existing `balanceOn` unchanged (same
`BALANCE_POLICIES`, same integer arithmetic), so the preview and the write read the same number.
Its input is the exported `getAccountBalanceOnSchema = z.strictObject({ accountId: idSchema, on: z.iso.date() })`, parsed by the server function and again in the repository. Validation is shape
only; the authoriser is `accountRepo.requireById` for the read and `assertMayAdminister` for the
move. `adjustAccountBalance` stays authoritative and still returns what it wrote.

## 📝 Data Model

No schema change and no migration. `account_groups` and `account_group_members` exist from `00-S5`.
The one-level depth rule stays a repository invariant (a product decision that could change without
a migration). The many-to-many primary key is unchanged.

## 📝 API Contracts

New, all in `src/server/fns/accounts.ts`, each behind `requireOrg()` and each re-parsed in the
repository (validation is shape, never permission):

| Function              | Method | Input                                                           | Returns                                        | Role                                 |
| --------------------- | ------ | --------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------ |
| `moveAccountToGroup`  | POST   | `{ accountId, fromGroupId: id \| null, toGroupId: id \| null }` | `void`                                         | owner or admin in a shared workspace |
| `getAccountBalanceOn` | GET    | `{ accountId, on: iso date }`                                   | `{ balanceMinor }` (account currency, integer) | any member, like `getAccount`        |

Unchanged and reused by phase A: `listAccountGroups`, `createAccountGroup`, `updateAccountGroup`,
`deleteAccountGroup`, `reorderAccountGroups`, `listAccounts`. The tree does not use
`setAccountGroupMembers`. A group drop or menu move is `updateAccountGroup` (new parent, only when
it changed) followed by `reorderAccountGroups` (the complete order of the run it lands in), the
shape `categories/index.tsx` documents.

**Errors are shown from the catalogue, never from the server's words.** The screen's alert region
renders a catalogue sentence chosen by the error class when the class survives the server-function
boundary (`NotFoundError`, `ForbiddenError`, `GroupDepthError`, `ConflictError`; phase A proves with
a test which of them do) and a generic catalogue sentence for everything else, including a D1 or
foreign-key failure from a two-tab race. The raw message is not rendered, so no English text, no id
and no database wording reaches the page.

## 📝 UI/UX

**Route.** `/accounts/groups`, SSR default. Reached from a "Manage groups" link in the page header of
`/accounts` and from the groups card heading; breadcrumb back to `/accounts`. The route is added to
`.github/a11y/routes.json` (whose `$comment` about it not existing is rewritten), to
`e2e/support/surfaces.ts`, and to the page-title assertion in `e2e/accessibility.spec.ts`.

**Tree.** `group-tree.tsx` follows `category-tree.tsx`: a flat reading-order `GridList`, indent as a
visual cue, the accessible name "<name>, inside <parent>" for a child, a `Button slot="drag"` handle
on **group rows only**, and a row menu built from `MenuTrigger`, ghost icon `Button`, `Popover`,
`Menu` and `SubmenuTrigger`, never hidden behind hover. A group row's menu: _Rename_, _Add
sub-group_, _Move up_, _Move down_, _Move to top_, _Move to bottom_, _Move to…_ (re-parent: a submenu
of top-level groups and "No parent"), _Delete_. An item that would change nothing is **disabled**,
not absent and not silent, and each disabled item carries its reason as visible item description
text ("A sub-group cannot have its own sub-groups", "Already first", "Already last", "Already
there"); the _Inside_ field of the form dialog is disabled with visible text saying why when the
group has child groups. _Move to…_ lists every destination with an accessible name that carries
its parent ("<child>, inside <parent>") because names may repeat across parents, and disables the
one the row is already under. The two row menus (categories, groups) are a second call site of the
same construction; the `DESIGN.md` guideline "Reorderable tree" names both and records that the
menu is built per tree, not extracted, because the item sets differ (row 9).

**Account rows (phase B).** Menu-only: _Move to…_ (a submenu of the other groups, disabled for none
and for the row's own group) and _Remove from this group_. The label is **Remove from this group**,
never "Not in a group", because the account may still be listed under another group. The
`/accounts` card "Not in a group" keeps its name: it describes what is in the card, not the verb.

**Drop rules in the mixed list.** Only group rows are draggable and only group rows accept a drop:
`getDropOperation` returns `cancel` for a `member:` target so no indicator appears there, and an
account row cannot start a pointer drag (it has no handle). A drop beside a top-level group means
"after the whole of that group's subtree", i.e. the indicator is drawn after its last child group
and its accounts. A keyboard drag must give the same result as the _Move to…_ menu path, and a
component test asserts it.

**Announcements.** Refusals go in a `role="alert" aria-live="assertive"` region that stays mounted
with its content swapped (the category precedent). Every **successful** menu move (group reorder,
re-parent, account move, remove, create, rename, delete) is announced politely through a toast that
reaches a `role="status"` region; a menu-initiated group reorder says its new place ("<name> moved
to position <n> of <total>"). For a child group the drag label, the actions label and that
announcement are parent-qualified ("Drag <child>, inside <parent>", "<child> moved to position <n>
of <total> inside <parent>"), and `<total>` counts the siblings under that parent, so two children
with the same name under different parents are told apart. Drag moves are announced by React Aria.

**Focus.** After _Move to…_ on an account, focus goes to the new `member:<to>:<account>` row. After
_Remove from this group_ or a delete, focus goes to the next row, or the previous one when it was
the last, or to the _New group_ button when the tree is empty. After a group move, focus stays on
the group row.

**Dialogs.** `group-form-dialog.tsx` (name, optional parent among top-level groups; `FormModal` with
the unsaved-changes guard) and `group-delete-dialog.tsx`, which states the number of accounts
leaving the group (the sentence is dropped when the group is empty), that none is deleted, that
child groups become top-level, and that rules using the group will be paused.

**States.** Empty: "No groups yet" explaining what a group is for, one primary action. Skeleton:
three tree rows. Error: `ErrorPanel`, retryable. A plain member of a shared workspace sees the
controls and gets the server's refusal as a catalogue sentence in the alert region (the client does
not know the member count; the shell holds the role only).

**Balance adjustment dialog (phase C).** The delta is read through `getAccountBalanceOn` for **every**
date, today included, so the preview and the write read the same ledger sum and the cached column
is not consulted. The preview card has an always-mounted `role="status"` region. On a date change
the loading sentence ("Reading the balance on <date>…") replaces the previous delta at once, so an
old delta is never visible beside a disabled button. **Record the correction is disabled** while the
balance for the selected date is loading or failed, and the status text is its explanation: it has a
stable id referenced by the button's `aria-describedby`. A disabled React Aria button leaves the tab
order, so the remedy for a keyboard user is the visible status text beside it, which is read in
reading order; the status text changes in one atomic swap per date change, never word by word. The failed state sits in the same card, names the date and holds a _Try again_ button
(`action.retry`); the correction stays disabled in it, because enabling it would reintroduce the
hidden delta. When a retry succeeds and the button unmounts while focused, focus moves to the card's
status container (`tabIndex={-1}`). The submit handler itself checks that the balance for the
current `bookedOn` has loaded (an Enter in the amount field during loading must not submit), and a
response for an earlier date never overwrites the preview for the date now selected (requests are
keyed by date). `accounts.adjust.preview.past` is retired. The post-save card is unchanged.

**Accessibility.** The gate is AA (`docs/ACCESSIBILITY.md`); nothing here widens the claim.
Account rows have no drag, so 2.5.7 has nothing to satisfy for them and group drag has the menu
path. `docs/ACCESSIBILITY.md` §4's 2.5.7 surface list gains "account groups" and drops or qualifies
"account ordering" (which has no UI; `OPEN-2`); §1 and §3 are not touched (Ask First).

## 📝 Edge Cases & Failure Scenarios

- A third level is refused by the repository with `GroupDepthError`; the menu already disables the
  items that would cause it, so the refusal is reached only in a two-tab race and shows the
  catalogue sentence. A group with children cannot be given a parent; a child cannot be a parent.
- Moving an account into a group it is already in only removes it from the source (one delete); the
  menu disables _Move to…_ for the row's own group.
- A stale `from` (the membership was removed in another tab): `NotFoundError`, the loader is
  invalidated and the sentence says the list changed.
- Another tab adds the target membership between the read and the `UPDATE`: the primary key
  refuses the `UPDATE`, the account stays in the source group untouched, and the generic catalogue
  sentence is shown. An accepted race, not a data loss.
- An account in two groups (existing data): each row's menu acts on that row's group only; the
  other membership stays; the two rows have different accessible names ("<account>, in <group>").
- Deleting a group with accounts and child groups: accounts become ungrouped (or stay in other
  groups), children are promoted, rules referencing the group are paused with the group's name
  recorded. Deleting an already-deleted group is a `NotFoundError` shown as a catalogue refusal.
- The adjustment date changes twice quickly: the first answer arrives last and is discarded.
- A foreign-currency account: the delta is in the account's own currency and the dialog never shows
  a base-currency figure as the delta.
- An archived account stays a member of its group; its row carries the archived `Badge` **and** the
  word in its accessible name.
- A correction to the balance the account already has: `unchanged`, unchanged behaviour, and the
  preview says "Nothing".
- Adjusting a future date is impossible in the UI (`maxValue` today); the server schema is not
  narrowed by this spec.

## 📝 Risks & Impact Review

- **Tenancy (security-sensitive).** Two new exports and a screen that sends ids. Every id is looked
  up under the tenant predicate before a write, including on calls that turn out to be no-ops; a
  foreign id is indistinguishable from a typo. `account_group_members` has foreign keys on `id` only
  (no organisation in the key), so the pre-write lookup is the only barrier and its isolation cases
  are the real control: they ship in the same phase as the function. The `no repository forks the
tenant predicate` scans in `tenant-isolation.test.ts` stay green (the new statements use
  `tenantFilter`, `assertScopedWrite` and `membershipRepo`).
- **Money.** No new write touches an amount. `getAccountBalanceOn` is a read over the integers
  `adjustAccountBalance` reads, and the dialog subtracts with `subtractMinor`; no float and no
  base-currency approximation in the delta.
- **Authorisation, recorded.** A plain member of a shared workspace can change an account's
  effective balance through a correction (any member may write a transaction), while `updateAccount`
  on `initialBalanceMinor` needs owner or admin. This is pre-existing and not widened here; it is
  written down as a decision so a later reviewer does not read it as an oversight (row 10).
- **Backward compatibility.** Adds two server functions and one route; retires one i18n key.
  `BACKWARD_COMPATIBILITY.md` surfaces are untouched.
- **Refactor risk.** The `move.ts` relocation touches `categories/`. It is behaviour-preserving; the
  moved test and `category-tree.test.tsx` pass with no assertion changed.
- **Module size.** `repos/accounts.ts` grows by roughly 100 lines. A later split is a separate
  refactor and is not blocked by this spec (row 4).

## 📝 Visual change expected

New route `/accounts/groups` (light and dark, 360 and 1280 px, and the empty, loading and error
states). `/accounts` gains a "Manage groups" link. The balance-adjustment dialog's preview card
changes for every date (loading, error, delta). The category tree is visually unchanged.

## 📝 Copy

Every key lands in `en` and `pl` in the same change (skill `i18n-messages`; plurals through the
plural machinery in `docs/I18N.md`, all four Polish forms, never `if (n === 1)`). Existing and
reused: `accounts.group.title` ("Groups"), `accounts.group.create` ("New group"),
`accounts.group.ungrouped`, `action.retry`. New:

- `accounts.groups.title`: "Account groups"; `accounts.groups.description`: "Folders for your accounts, such as Joint or Business. A group never changes a balance."; `accounts.groups.manage`: "Manage groups"
- `accounts.groups.empty.title`: "No groups yet"; `accounts.groups.empty.body`: "A group collects accounts under one name, such as Joint or Business, so the list reads the way you think about it. Accounts keep their own balances."
- `accounts.groups.error.title` / `accounts.groups.error.body`
- `accounts.groups.tree.label`: "Account groups, in display order"
- Row names: `accounts.groups.row.group`: "{name}, group, {count} accounts" (plural); `accounts.groups.row.childOf`: "{name}, inside {parent}, {count} accounts" (plural); `accounts.groups.row.account`: "{account}, in {group}"; `accounts.groups.row.accountArchived`: "{account}, archived, in {group}"
- Controls: `accounts.groups.drag.label`: "Drag {name}"; `accounts.groups.drag.labelChild`: "Drag {name}, inside {parent}"; `accounts.groups.actions.label`: "Actions for {name}"; `accounts.groups.actions.labelChild`: "Actions for {name}, inside {parent}"; `accounts.groups.accountActions.label`: "Actions for {account}, in {group}"
- Fields and items: `accounts.group.field.name`: "Group name"; `accounts.group.field.parent`: "Inside"; `accounts.group.parent.none`: "No parent"; `accounts.group.rename`: "Rename"; `accounts.group.addChild`: "Add sub-group"; `accounts.group.move.to`: "Move to…"; `accounts.group.move.remove`: "Remove from this group"; the up, down, top and bottom items reuse the category keys where the text is identical, through a shared key
- Polite results, phrased with a noun so a user-entered name never needs inflection in Polish (for example "Przeniesiono konto {account} do grupy {group}"): `accounts.group.toast.created`, `.renamed`, `.reparented`, `.deleted`, `.accountMoved`, `.accountRemoved`, `accounts.group.announce.position`: "{name} moved to position {position} of {total}" and `accounts.group.announce.positionChild`: "{name} moved to position {position} of {total} inside {parent}"
- Reasons for disabled items and fields: `accounts.group.disabled.noGrandchild`: "A sub-group cannot have its own sub-groups", `accounts.group.disabled.first`: "Already first", `accounts.group.disabled.last`: "Already last", `accounts.group.disabled.same`: "Already there", `accounts.group.field.parent.hasChildren`: "This group has sub-groups, so it cannot sit inside another group."
- Refusals: `accounts.group.refused.title`: "That change was not made"; bodies `accounts.group.refused.depth` ("A group can sit inside one other group, not two deep."), `.notFound` ("The list changed in another window. It has been reloaded."), `.forbidden` ("Only an owner or an admin can change groups in a shared workspace."), `.generic` ("Something went wrong. Try again.")
- Delete: `accounts.group.delete.action`: "Delete group"; `accounts.group.delete.title`: "Delete {name}?"; `accounts.group.delete.body`: "{count} accounts leave this group. None is deleted. Sub-groups become top-level groups." (plural; a count-0 variant without the first sentence); `accounts.group.delete.rules`: "Rules that use this group will be paused until you pick another."
- `accounts.adjust.preview.loading`: "Reading the balance on {date}…"; `accounts.adjust.preview.error`: "The balance on {date} could not be read."; `accounts.adjust.preview.blocked`: "The correction can be recorded once the balance on {date} has loaded."
- Retired: `accounts.adjust.preview.past`.

## 📋 Phasing

Four phases, each one pull request and one ticket for `afk-to-tickets`, each a complete vertical
slice that a person can see and check. A is the base; B and the rest follow.

| Phase | Ships                                                                                  | Blocked by |
| ----- | -------------------------------------------------------------------------------------- | ---------- |
| A     | Generic tree-move module, `/accounts/groups` screen, isolation cases, evidence         | none       |
| B     | `moveAccountToGroup`, the account-row menu items, isolation cases, evidence            | A          |
| C     | `getAccountBalanceOn`, the exact preview, money-invariants section 17, dialog evidence | none       |
| D     | Plan amendment and the `Delivered:` line                                               | A, B, C    |

## 📋 Implementation Plan

### Phase A — The groups screen

- Prefactoring first, in its own commit: the generic `src/components/app/tree/` module as described
  in Architecture, the re-point surface, no assertion changed.
- `src/routes/_app/accounts/groups.tsx` (loader: `listAccountGroups` and `listAccounts`,
  `pendingComponent`, `errorComponent`, `head`), `group-tree.tsx`, `group-form-dialog.tsx`,
  `group-delete-dialog.tsx`; the "Manage groups" link on `/accounts`; `pnpm generate-routes`; the copy
  in EN and PL; the "Reorderable tree" section in `DESIGN.md` (shape, tones, states, what carries the
  meaning without colour, drop and focus rules, that the row menu is built per tree, and that it is
  not a data table); the `routes.json`, `surfaces.ts` and `accessibility.spec.ts` additions and the
  `docs/ACCESSIBILITY.md` §4 surface-list edit (the PR body calls it a factual correction of the
  surface list, not a wider claim, and updates the document's "Last reviewed" line).
- Account rows render here **read-only, with no menu**; phase B adds their menu. The groups, their
  nesting and the accounts under them are visible from A on.
- `tenant-isolation.test.ts`: A, in A's scope, calls `updateAccountGroup`, `deleteAccountGroup`,
  `setAccountGroupMembers` (with B's account ids **and** with A's accounts onto B's group),
  `reorderAccountGroups`, `createAccountGroup` and `updateAccountGroup` with `parentId` set to B's
  group; each is a `NotFoundError`, B's groups and memberships are re-read through B's scope and
  unchanged, `deleteAccountGroup` on B's group pauses none of B's rules, and `listAccountGroups`
  returns nothing of B's.
- Component tests: menu items disabled when nothing would change; every move reachable from the
  keyboard and equal to its drag result; `getDropOperation` cancels a `member:` target; an account row
  cannot start a drag; focus after a move and after a delete; the alert region shows the catalogue
  sentence for each error class and the generic one for an unknown error; the route handles a stale
  move (a deleted group) by showing the sentence and invalidating the loader. A test records which
  repository error classes survive the server-function boundary.
- `e2e/account-groups.visual.spec.ts`: axe on `/accounts/groups`, both themes, both locales (zero
  `serious`, zero `critical`); console silent on create, move and delete (the spec creates its own
  group and removes it; the demo workspace is otherwise read-only). Frames, outside the repository:
  the two-level tree, light and dark, 360 and 1280 px, and the empty state.
- Component tests also assert the parent-qualified labels and announcements for a child group and
  the visible reasons of disabled items, and a measured 44 px target for the drag handle and the menu
  trigger on an indented child row at 360 px.
- Done when: every **group** gesture in UI/UX (create, rename, re-parent, reorder, delete) is
  reachable from the keyboard, the refusals reach the alert region as catalogue text, and
  `pnpm lint`, `typecheck`, `test`, `build` pass.

### Phase B — Moving an account between groups

- `moveAccountToGroupSchema` and `moveAccountToGroup` in `repos/accounts.ts` in the order given in
  Architecture; the server function; the two account-row menu items with their focus and announcement
  behaviour; copy.
- Tests in `accounts.test.ts`: add-only, remove-only, move, move into a group the account is already
  in (a delete, no key conflict), a membership in a third group survives, `from === to` writes
  nothing, the moved account lands last in a non-empty target group, a stale `from` is a
  `NotFoundError` and changes nothing in both the `UPDATE` and the conditional-delete branch, the
  primary-key race (the target row appears between the read and the `UPDATE`, for example through a
  spy on the read helper that inserts it) leaves the account in the source, a plain member of a
  shared workspace is refused, an omitted key is a validation failure. In `tenant-isolation.test.ts`: B's account, B's
  `fromGroupId`, B's `toGroupId`, A's account into B's group, and a foreign id on a `from === to`
  call (the no-op must still be a `NotFoundError`); each re-reads B's memberships through B's scope
  and finds them unchanged.
- Component tests: _Move to…_ lists every other group with disambiguated names and disables the row's
  own; focus lands on the new row after a move.
- Frames: the _Move to…_ menu open on an account row. The axe spec from phase A gains the open menu.
- Component tests also assert a measured 44 px target for the account-row menu trigger at 360 px.
- Done when: both account gestures (_Move to…_ and _Remove from this group_) are reachable from the
  keyboard, those cases pass and the `no repository forks the tenant predicate` scans stay green.

### Phase C — The exact preview

- `getAccountBalanceOnSchema`, `getAccountBalanceOn` in `repos/accounts.ts`, the `GET` server
  function, the dialog changes in UI/UX, the copy changes.
- Tests: the read equals the base the write measures for the same date (one fixture, both calls,
  including today with a stale `current_balance_minor`); an account with later transactions returns
  the balance on the earlier day; a foreign account is a `NotFoundError` (also in
  `tenant-isolation.test.ts`, with the same error class and message shape as a nonexistent id); a
  stale response is discarded; a failed read shows the retry and the button stays disabled with its
  explanation; Enter in the amount field while loading does not submit; focus after a successful
  retry.
- `money-invariants.test.ts` section **17 — a correction is a transaction, never an overwrite**,
  with the stage's four cases: exactly one `is_balance_adjustment = true` row and no direct write of
  `current_balance_minor`; the delta is measured on `bookedOn` and later transactions still apply on
  top; adjusting to the same balance writes nothing; the adjustment is in the account's own currency
  with `ref_amount_minor` at `bookedOn`'s rate. The existing `accounts.test.ts` cases stay.
- Axe on the open dialog in `e2e/account-groups.visual.spec.ts`, both themes; frames: the dialog on
  a past date showing the computed delta (light and dark, 360 and 1280 px).
- Done when: the dialog shows the exact delta for every date and the existing dialog tests still
  pass.

### Phase D — The plan says what the code is

- Rewrite the `06-S3` block of `docs/plans/06-accounts.md`: owned paths as built
  (`repos/accounts.ts`, `fns/accounts.ts`, `src/components/app/tree/`, the `-ui/` files), the
  `reorder-menu` reference replaced by the category-tree pattern, accounts menu-only in the tree, the
  tests that exist and where; `ACCT-07` and `ACCT-08` set to `done` (`ACCT-08` is "account groups, the
  tree, and membership", which account ordering was never part of); add `OPEN-2` (account
  reordering: global `accounts.position` or per-group membership order, to be decided before any
  account drag), `OPEN-3` (adding an account to a second group) and `OPEN-4` (the group's logo
  fields). Add the `Delivered: <date> - <evidence>` line only if phases A to C are merged.
- Done when: `pnpm generate-spec-index` is clean and the plan keeps its twelve `###` headings.

## 📝 Resolved assumptions (autonomous defaults)

| #   | Question                                                                      | Applied default                                                                                                                                                                                                                                                                                                                                                                            | Why                                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | What does "move an account between groups" mean with many-to-many membership? | Keep many-to-many; move = out of the row's group, into the target; remove = out only. No gesture creates a second membership.                                                                                                                                                                                                                                                              | Decided by product-owner sub-agent (confidence high): the schema comment and the rule engine's `account_group` condition are deliberate; a single-membership rule would silently change existing data. Follow-up `OPEN-3`.                                                                                       |
| 2   | Is the delta previewed for any date?                                          | Yes, from one tenant-scoped read for every date, today included; confirm disabled until the selected date has loaded; stale answers discarded; failures retryable.                                                                                                                                                                                                                         | Decided by product-owner sub-agent (confidence medium) and the architect (confidence medium): hiding the delta is the stage's stated failure mode; one read means preview and write cannot disagree when the cache lags.                                                                                         |
| 3   | Does this spec include reordering accounts?                                   | No. Group ordering only; account reordering is `OPEN-2` in the plan.                                                                                                                                                                                                                                                                                                                       | Decided by product-owner sub-agent (confidence high): the global and per-group orders differ and choosing between them is a decision not to take silently.                                                                                                                                                       |
| 4   | Where does the delivered code live?                                           | Stays in `repos/accounts.ts` and `fns/accounts.ts`; the plan's owned paths are amended in phase D; a split is a later refactor.                                                                                                                                                                                                                                                            | Decided by software-architect sub-agent (confidence medium): the move needs the module's private helpers, and a split rewrites about 1000 lines and every importer for a path list.                                                                                                                              |
| 5   | Share or copy the tree-move logic?                                            | Generic `TreeRow` and `TreeMove` in `components/app/tree/`; categories re-pointed; "Reorderable tree" guideline in `DESIGN.md`; moves only ever see group rows.                                                                                                                                                                                                                            | Decided by software-architect sub-agent (confidence medium): the functions read only `id` and `parentId`; a copy would drift; importing from `categories/` is the wrong direction; the Second Call Site Rule requires the guideline.                                                                             |
| 6   | Are accounts draggable?                                                       | No: account rows are menu-only; only group rows are draggable and accept drops.                                                                                                                                                                                                                                                                                                            | Applied by the author: one drop target meaning "re-parent" for one row kind and "change membership" for another is the ambiguity `move.ts` refuses; the menu is the guaranteed path. Narrows the stage's "as well as by drag" for account rows. Accessibility specialist: 2.5.7 has nothing to satisfy for them. |
| 7   | How is the account move written?                                              | One write statement after one read (an `UPDATE` of `group_id`, or a conditional delete when the target exists, or an insert-on-conflict-do-nothing for a pure add), after lookups that run even for no-ops.                                                                                                                                                                                | Raised by the product-owner and architect sub-agents: the architect's insert-then-delete converges but is two statements; no repository batch exists, so one statement is the way to be atomic. A stale source is a `NotFoundError`.                                                                             |
| 8   | Real tree semantics?                                                          | The flat reading-order `GridList` of the category tree, "inside <parent>" in the accessible name.                                                                                                                                                                                                                                                                                          | Applied by the author: the pattern is shipped and reviewed; no new component or dependency (`docs/SPEC.md` §3 freeze).                                                                                                                                                                                           |
| 9   | Extract the row menu shared by the category and group trees?                  | No: built per tree, both named in the `DESIGN.md` guideline.                                                                                                                                                                                                                                                                                                                               | Applied by the author: the item sets differ (colour and kind versus rename and sub-group); the guideline is what stops drift.                                                                                                                                                                                    |
| 10  | Who may read, correct and write?                                              | Group and move writes: owner or admin once shared (existing `assertMayAdminister`). `getAccountBalanceOn`: any member, like `getAccount`. `adjustAccountBalance`: unchanged, any member.                                                                                                                                                                                                   | Recorded at the security reviewer's request: pre-existing and not widened here; a plain member of a shared workspace can already write any transaction.                                                                                                                                                          |
| 11  | How does the screen show a refusal?                                           | Catalogue sentence by error class, a generic one for anything else; the server's message is never rendered.                                                                                                                                                                                                                                                                                | The product-owner and security sub-agents: the repository message is English and carries an id; unknown errors may carry database text.                                                                                                                                                                          |
| 12  | Quota for groups                                                              | None, stated so a later stage does not add one silently.                                                                                                                                                                                                                                                                                                                                   | The stage text.                                                                                                                                                                                                                                                                                                  |
| 13  | Are the tests that exist replaced by the central cases?                       | No: the central cases are added; `accounts.test.ts` keeps its own.                                                                                                                                                                                                                                                                                                                         | Applied by the author: deleting a test needs a person (`AGENTS.md` "Ask First").                                                                                                                                                                                                                                 |
| 14  | Does the "Not in a group" card on `/accounts` change name?                    | No: it names what is in the card; the account-row verb is "Remove from this group".                                                                                                                                                                                                                                                                                                        | Applied by the author, noted by the product-owner sub-agent as a possible inconsistency.                                                                                                                                                                                                                         |
| 15  | Evidence for this spec                                                        | `wc -l` of `repos/accounts.ts` and `fns/accounts.ts` (1165, 253); the greps quoted in the Problem Statement; `ls src/server/accounts` (absent); `grep -c "AccountGroup\|adjustAccountBalance"` on `tenant-isolation.test.ts` and `money-invariants.test.ts` (0 and 0; sections 1 to 16 present); `gh search issues` and `gh pr list` for `06-S3` (no issue, no open spec or delivered PR). | Commands run at the time of writing (`docs/SPEC.md` §7.7).                                                                                                                                                                                                                                                       |

### Panel verdicts

| Specialist                    | Round 1                                       | Round 2                                                                                                                                     |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Product owner                 | approve with conditions (medium), all applied | approve with conditions (wording), applied                                                                                                  |
| Software architect            | approve with conditions (medium), all applied | approve with conditions (move statement and primitive named), applied                                                                       |
| Security and tenancy reviewer | approve with conditions (medium), all applied | approve with conditions (conditional delete, race named), applied; asks for a second reviewer on the implementation PRs (risk-high tenancy) |
| Accessibility and UX          | approve with conditions (medium), all applied | approve with conditions (parent-qualified labels, disabled reasons, 44 px check), applied                                                   |

The two rounds the skill allows are used; no specialist answered "revise". The `Spec PR` row in the
metadata table holds `#TBD` until the pull-request step fills it in.
