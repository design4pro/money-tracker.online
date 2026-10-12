# Categories: the standard set, the write gate, the named refusal and the pins, and plan stage 08-S1 reconciled

| Field              | Value                                   |
| ------------------ | --------------------------------------- |
| **Status**         | ready                                   |
| **Issue**          | none                                    |
| **Spec PR**        | #TBD                                    |
| **Implementation** | none                                    |
| **Plan**           | 08-S1 (docs/plans/08-classification.md) |

## 📝 TLDR

Plan stage `08-S1` (`docs/plans/08-classification.md`, "Categories") was written before the code, and the code
has since delivered most of it, under different paths: the repository `src/server/repos/categories.ts`
(nine functions, the depth cap, colour inheritance, the archive cascade, the delete refusal), the server functions
`src/server/fns/categories.ts`, the tree in `src/components/app/categories/` with its pure move arithmetic in
`src/components/app/tree/`, and the screen at `/categories`
(`src/routes/_app/categories/index.tsx`, not `/settings/categories`). 77 tests in five files pass today.

Four things the stage promises are missing or untrue. (1) The **standard set** and its "Add the standard set"
empty-state action do not exist, so no `is_system` row can ever be created. (2) Only `deleteCategory` checks
`owner | admin`; the plan says every write does. (3) The depth-cap refusal the plan wants "naming the two
categories" prints the raw English server sentence, with ids and a literal `subcategor(y|ies)`, in both locales.
(4) The stage's own tenant-isolation and money-invariant cases live in `categories.test.ts`, not in the two
files `AGENTS.md` names, there is no test of the nine server-function handlers, and
`e2e/categories.visual.spec.ts` does not exist.

This spec covers what is left, in six phases: the pins (tests only), the write gate, the named refusal, the
standard set, the browser spec, and the plan amendment that marks the stage delivered. No schema change, no
migration, no new dependency.

## 📝 Problem Statement

Verified against the repository at the time of writing (commands in Resolved assumptions row 14).

**What the code already delivers**

- `src/server/repos/categories.ts` (906 lines): `listCategories`, `getCategory`, `createCategory`,
  `updateCategory`, `archiveCategory`, `restoreCategory`, `deleteCategory`, `reorderCategories`, `moveCategory`
  (the plan's nine), plus `spendingByCategory` (the dashboard donut) and `assertCategoryUsable` (payees). Zod
  `z.strictObject` schemas, parsed again in the repository; `color` is a case-folded `#rrggbb`; `icon` is a member of
  `CATEGORY_ICON_NAMES`, a names-only tuple. The depth cap is `assertMayParent`, called by `createCategory` and
  `moveCategory`, and it also refuses a category that already holds children becoming a child. `deleteCategory` refuses
  a system row and a used one (transactions and splits counted), names the count, and pauses the rules that referenced
  it. `archiveCategory` cascades to children; `restoreCategory` restores one row.
- Colour inheritance is **maintained on write**, not resolved on read: `categories.color` is `NOT NULL`, so a
  child created without a colour stores its parent's, `updateCategory` repaints the children that still carry the
  parent's old value (`cascadeColor`), and `moveCategory` adopts the new parent's colour for a child that was
  inheriting. `src/server/db/schema.ts` documents this at the table. The plan's "returns its parent's colour on
  read" is the stale half.
- `src/server/fns/categories.ts`: one server function per export (reads `GET`, writes `POST`), each calling
  `requireOrg()`, none wrapped in `runWithLedgerBatch` (its header says why).
- The UI: `/categories` with `?status=active|all`, `CategoryTree` (a `GridList` with React Aria drag and drop plus
  a per-row menu: _Edit_, _Add a subcategory_, _Move up / down / to top / to bottom_, _Move to…_, _Archive_ or
  _Restore_, _Delete_), `CategoryFormDialog`, `CategorySwatch` (a swatch beside the name whose hidden text is the
  colour's word, or its hex for a colour outside the eight), the empty state, an eight-row skeleton, a
  retryable `ErrorPanel`, and a `role="alert" aria-live="assertive"` region for a refused move. The pure functions
  `dropMove`, `stepMove` and `reparentMove` in `src/components/app/tree/move.ts` (21 tests) are shared by the drag
  and the menu, so the two paths cannot drift.
- Tests that pass today (one run at HEAD `bbd7c16`): `categories.test.ts` 41, `category-tree.test.tsx` 7,
  `category-colour-field.test.tsx` 4, `palette.test.ts` 4, `move.test.ts` 21; 77 together. They include the depth
  cap on create and move, colour inheritance in seven cases, the cascade, delete refusals, a two-workspace
  isolation case for every function but `createCategory`, and a "money boundary" section that watches the SQL.
- `/categories` is already in the shell's e2e surfaces (`e2e/support/surfaces.ts`, so the axe gate in
  `accessibility.spec.ts` runs on it), in `states.spec.ts` (the empty state), in `narrow-viewport.spec.ts`,
  `desktop-density.spec.ts` and `contrast-enhanced.spec.ts`.
- Plan rows `CLS-01` (repository, depth cap, inheritance), `CLS-02` (tree screen, drag and keyboard reorder) and
  `CLS-03` (archive instead of delete) are therefore met in substance.

**What does not hold**

1. **The standard set does not exist.** The plan promises "a seed set of system categories" and an empty state
   whose primary action is **Add the standard set**. The empty state has one button (_Add a category_);
   `src/server/auth/organization.ts` writes no categories; no repository insert sets `isSystem: true`
   (`grep -rn "isSystem" src`), so the `SystemCategoryError`, the _Built in_ badge and the disabled _Delete_ item
   are code no workspace can reach. The reason the plan and `schema.ts` give for `is_system` ("the import mappers
   and the rule engine address them by `slug`") does not hold today either: `src/server/import/map.ts` maps a
   column of free text and `src/server/rules` reference a category by id. Plan `26-S1` (onboarding, not built)
   will own `presets.ts`, "a typed structure of categories" per preset, and nothing says how it relates to the
   standard set.
2. **Only one write is gated.** The plan: "writes require `owner | admin` in a multi-member workspace".
   `assertMayAdminister` has one call site, `deleteCategory`. `createCategory`, `updateCategory`,
   `archiveCategory`, `restoreCategory`, `reorderCategories` and `moveCategory` let any member rename, recolour,
   archive (with its cascade) or re-parent a category every other member files transactions under.
3. **The refusal does not name the two categories, and it is not localised.** `CategoryDepthError` names the moved
   category by id (or `(new)`); `CategoryHasChildrenError` names an id and prints `subcategor(y|ies)`, a hand-rolled
   plural of the kind `AGENTS.md` forbids. The route renders `error.message` as the panel's detail
   (`src/routes/_app/categories/index.tsx`). The menu path can never reach the refusal (the submenu offers only
   top-level parents and disables a parent that has children); the drag path can, because `dropMove` gives the
   dropped row the target row's parent, so dragging a parent that has children beside a child sends a `moveCategory`
   the repository refuses. `.ai/specs/2026-10-10-failure-classification-and-public-envelope.md` (`05-S1`, ready, not
   built) will strip every repository sentence from what the browser receives; after it the panel would show a
   generic conflict line, and the plan's "refusal is the point of `CLS-01`" evidence would be gone.
4. **The stage's invariant cases are in the wrong place and incomplete.** `AGENTS.md` ("Always"): a new repository
   function ships with a case in `tenant-isolation.test.ts`, and the plan asks for _category writes do not touch
   `transactions`_ in `money-invariants.test.ts` "across all nine exports". Neither file mentions categories
   (their `category` hits are budget fixtures). `categories.test.ts` holds a local isolation case that skips
   `createCategory` and a "money boundary" case that does not run `createCategory` or `deleteCategory`. The depth
   cap on "the import path" is untestable today because no importer writes a category (`commitImport` exists
   nowhere in `src`; `src/server/import/map.ts` only reads a column); the rule that one will have to go through
   `createCategory` is written nowhere.
5. **No test runs the handlers.** `src/server/fns/__tests__/` has no `categories.test.ts`. The header of
   `src/server/fns/categories.ts` states "No write here is batched" and "`requireOrg()` inside every handler";
   nothing pins either, nor that the strict schema refuses an unknown field or an icon outside the tuple at the
   door.
6. **`e2e/categories.visual.spec.ts` does not exist**, so the plan's browser evidence (the two-level tree, the
   _Move to…_ menu open, the depth-cap refusal, both themes) has no spec behind it.
7. **The stage text is stale in five more places.** Owned paths name `src/routes/_app/settings/categories.tsx`,
   `-ui/category-tree.tsx`, `-ui/category-form.tsx`, `src/server/fns/categories.ts` "new" and a `reorder-menu`
   component (`00-S8`) that does not exist (the row menu is inline in `category-tree.tsx`, the arithmetic in
   `components/app/tree`); the screen is `/categories`; the "Zod: `color` is `z.string().regex(…)`" line omits the
   case fold and the "Colour inheritance … on read" line is the wrong mechanism (above); the hand-offs ("`04-S1`
   provisioning calls into this repository") are wrong, `04-S1` is delivered and does not.
8. **The stage carries no `Delivered:` line**, so `backlog-status.mjs --plan` keeps offering it.

A stage with a promised action missing, a gate unmet and its own invariant cases elsewhere is not delivered, so it
is not marked delivered today (`afk-plan-to-spec` § 2a). It gets this spec.

## 📝 Proposed Solution

Six phases. Stage `08-S1` is this whole spec.

- **Phase 1 (tests only).** A categories section in `tenant-isolation.test.ts`, a new case 19 in
  `money-invariants.test.ts`, and `src/server/fns/__tests__/categories.test.ts` for the nine handlers.
- **Phase 2 (the write gate).** `assertMayAdminister` on every category write, in the repository.
- **Phase 3 (the named refusal).** The two server errors name the categories; the route builds the refusal
  sentence from the catalogue and the names it already holds.
- **Phase 4 (the standard set).** One typed data file, one repository function, one server function, and the empty
  state's two actions.
- **Phase 5 (the browser spec).** `e2e/categories.visual.spec.ts`.
- **Phase 6 (documents).** Amend the `08-S1` block to what the code is, correct the `is_system` rationale, point
  `26-S1` at the standard set, and add the `Delivered:` line last, after Phases 1 to 5 have merged.

Out of scope, and why: moving the screen to `/settings/categories` (the settings hub links to `/categories`, and so do the e2e surfaces
and `docs/agents/parity.md`, row 1); creating the set at workspace provisioning (the AGENTS.md
exception list is three items and a personal workspace should start empty by choice, row 3); a UI hint that hides
write controls for a plain member (no screen does, accounts included; the refusal arrives through the existing
panels, row 5); any importer (`19-S3` owns it; the rule it inherits is stated in the Architecture); a stored
workspace locale (the set uses the request's locale, row 4); migrating the other `error.message` sites of the
categories route (`05-S1`'s 63-site migration owns them); backfilling stored upper-case colours (a data migration,
stated in `colorSchema`); a colour picker or new icons; payees and tags (`08-S2`, `08-S3`); a `categories` quota
(stated explicitly: **categories are not metered**, and `src/lib/plans.ts` has no such metric).

## 📝 Architecture

- **Owner modules** (`docs/SPEC.md` §6.1, §8). Categories: the repository `src/server/repos/categories.ts` and the
  handlers `src/server/fns/categories.ts`, unchanged. The standard set's **data** is new and owned by this stage:
  `src/server/categories/standard-set.ts`, pure typed data with no SQL and no I/O; the **write** that applies it is a
  one more function of the same repository, `seedStandardCategories`, so the SQL stays in `src/server/repos` and the
  tenant predicate stays the base repository's. Plan `26-S1`'s `src/server/onboarding/presets.ts` imports or extends
  the data and never redefines it (row 3).
- **The write gate** is the repository's `assertMayAdminister(scope, action)`, called first in each write, after the
  Zod parse and before any read or write, so validation stays shape and permission stays the repository's
  (`AGENTS.md`: validation is shape, never permission). `listCategories`, `getCategory` and `assertCategoryUsable`
  stay ungated: every member picks categories.
- **The seed** reads the workspace's slugs once (`tenantFilter`), builds the rows the workspace lacks, and inserts
  them with the base repository's `insertMany`, parents first, in chunks of at most eight rows. The chunk size is
  **computed, not chosen**: a category row binds 12 parameters (measured, below), D1 caps a statement at 100
  (`src/server/repos/import-preview.ts` states it and `account-balances.ts` computes its chunks from it), and
  `floor(100 / 12)` is 8, so 36 rows are five statements. Not one `db.batch()`, for the reason
  `src/server/repos/account-balances.ts` gives for its own statements: the base repository executes, it does not build.
  Because every statement is idempotent by slug, a run that stops between chunks is completed by pressing the
  action again, and parents land before children so a half-applied set is still a valid two-level tree.
- **Locale** reaches the seed as an argument (`{ locale }`, the supported-locale tuple in Zod), taken from the
  caller's active locale, because no stored workspace locale exists yet (`src/server/fns/locale.ts`). Names are
  stored as plain text in that locale, like any hand-made category; the slug is the same English identifier in both
  locales, so a Polish and an English workspace address the same rows by the same name.
- **`is_system`** is **false** on every standard-set row (row 2): a person who does not want the set can delete it.
  The column, `SystemCategoryError` and the _Built in_ badge stay as they are, reserved for a row the product itself
  must find by slug, of which there is none today. Phase 6 corrects the comment that says otherwise.
- **The refusal** is decided by the repository alone. The route does not pre-check the depth rule (the module header
  of `components/app/tree/move.ts` forbids two deciders); it learns only that a `moveCategory` request failed with a
  conflict-class failure and composes a sentence from names it already holds. The test of "conflict-class" is one
  route-local predicate (`code === 'CONFLICT'` on the rebuilt error), named so `05-S1` replaces it with
  `readFailure(error)?.kind === 'conflict'` in one line. Probed while writing this spec: an `Error` subclass with own
  properties `code` and `childCount` round-trips through `seroval` 1.5.6 `toJSON` / `fromJSON` with both intact; that is
  not the Start transport, so Phase 5's browser case is the proof on the real wire.
- **The import path rule** (the plan's "including the import path"). No importer writes a category today. Any code
  that will (`19-S3`, a template, the rule applier) calls `createCategory` or `moveCategory`; `AGENTS.md` already
  forbids SQL outside `src/server/repos`, so there is no second door to the depth cap, and Phase 1 pins the one
  door that matters, the repository's own schema (a parent that is itself a child is refused on both writes).
- **Seams used by the tests, not new ones.** The two-workspace world of `budget-harness.ts` (`createBudgetWorld`,
  `seedCategory`, `addSecondMember`) is used by the isolation and money sections; the handler test uses the
  technique of `src/server/fns/__tests__/attachments.test.ts` (and of the `07-S1` handler test): `createServerFn`
  replaced by a builder that returns the handler with the validator still running, `requireOrg` returning the
  world's scope, `cloudflare:workers` mocked, and the real `setLedgerBatchPorts` with a fake namespace.

## 📝 Data Model

No schema change and no migration. `categories` keeps `name`, `slug`, `icon`, `color` (`NOT NULL`), `kind`,
`parent_id`, `is_system`, `position`, `archived_at`. The standard set writes ordinary rows with `is_system = 0`.

### The standard set

Thirty-six rows: twelve top-level, twenty-four children. **Every child inherits its parent's hue** (no override), so
the first recolour of a parent repaints its children and `cascadeColor` has work to do. Hues are
`CATEGORY_HUES`, icons are `CATEGORY_ICON_NAMES`; both are checked by the test of Phase 4. `kind` is `expense` for the
first ten parents and their children, `income` for the last two. `position` is the row's index among its siblings in
the order below.

| Slug (stable)      | Parent    | EN name               | PL name                 | Hue (name)        | Icon             |
| ------------------ | --------- | --------------------- | ----------------------- | ----------------- | ---------------- |
| `housing`          | -         | Housing               | Mieszkanie              | `#0d6abb` blue    | `house`          |
| `rent`             | housing   | Rent or mortgage      | Czynsz lub rata kredytu | blue              | `receipt`        |
| `utilities`        | housing   | Utilities             | Media i opłaty          | blue              | `plug`           |
| `internet-phone`   | housing   | Internet and phone    | Internet i telefon      | blue              | `wifi`           |
| `home-maintenance` | housing   | Repairs and upkeep    | Naprawy i remonty       | blue              | `wrench`         |
| `food`             | -         | Food                  | Jedzenie                | `#0f7b62` green   | `utensils`       |
| `groceries`        | food      | Groceries             | Zakupy spożywcze        | green             | `shopping-cart`  |
| `dining-out`       | food      | Restaurants and cafés | Restauracje i kawiarnie | green             | `coffee`         |
| `transport`        | -         | Transport             | Transport               | `#0a646a` teal    | `car`            |
| `fuel`             | transport | Fuel                  | Paliwo                  | teal              | `fuel`           |
| `public-transport` | transport | Public transport      | Komunikacja miejska     | teal              | `bus`            |
| `car-servicing`    | transport | Car servicing         | Serwis samochodu        | teal              | `wrench`         |
| `health`           | -         | Health                | Zdrowie                 | `#a60d47` crimson | `heart-pulse`    |
| `medical`          | health    | Doctors and treatment | Lekarze i leczenie      | crimson           | `heart-pulse`    |
| `pharmacy`         | health    | Pharmacy              | Apteka                  | crimson           | `heart-pulse`    |
| `shopping`         | -         | Shopping              | Zakupy                  | `#9724b5` violet  | `shirt`          |
| `clothing`         | shopping  | Clothing              | Odzież                  | violet            | `shirt`          |
| `electronics`      | shopping  | Electronics           | Elektronika             | violet            | `smartphone`     |
| `gifts`            | shopping  | Gifts                 | Prezenty                | violet            | `gift`           |
| `leisure`          | -         | Leisure               | Wypoczynek i rozrywka   | `#b1440c` orange  | `film`           |
| `entertainment`    | leisure   | Entertainment         | Rozrywka                | orange            | `music`          |
| `subscriptions`    | leisure   | Subscriptions         | Subskrypcje             | orange            | `receipt`        |
| `sport`            | leisure   | Sport                 | Sport                   | orange            | `dumbbell`       |
| `travel`           | leisure   | Travel                | Podróże                 | orange            | `plane`          |
| `education`        | -         | Education             | Edukacja                | `#436f0a` olive   | `graduation-cap` |
| `courses`          | education | Courses and books     | Kursy i książki         | olive             | `book`           |
| `family`           | -         | Family and pets       | Rodzina i zwierzęta     | `#625106` gold    | `baby`           |
| `children`         | family    | Children              | Dzieci                  | gold              | `baby`           |
| `pets`             | family    | Pets                  | Zwierzęta               | gold              | `dog`            |
| `finance`          | -         | Money and fees        | Finanse i opłaty        | blue              | `landmark`       |
| `bank-fees`        | finance   | Bank fees             | Opłaty bankowe          | blue              | `coins`          |
| `insurance`        | finance   | Insurance             | Ubezpieczenia           | blue              | `shield`         |
| `taxes`            | finance   | Taxes                 | Podatki                 | blue              | `landmark`       |
| `other-expenses`   | -         | Other                 | Inne                    | teal              | `receipt`        |
| `salary`           | -         | Salary                | Wynagrodzenie           | green             | `briefcase`      |
| `other-income`     | -         | Other income          | Pozostałe przychody     | olive             | `coins`          |

Rules of the application, all in `seedStandardCategories`: a row whose slug the workspace already holds (archived or
not, system or not) is **skipped**, never renamed, resurrected or overwritten; a child whose parent slug resolves to
a row that is itself a child, or to no row, is skipped (the depth cap holds for the seed too, through
`assertMayParent`'s rule applied to the resolved parent); a child attaches to the **existing** top-level row that
holds its parent's slug when the person already made one; `position` continues after the highest in each sibling run
(`nextPosition`'s rule) so the set lands after what the person already has; the names are the set's in the requested
locale and are validated by the same `nameSchema` as any create. The data is original to this repository (a generic
household-budget taxonomy); nothing is taken from the reference product (`docs/agents/reference.md`).

## 📝 API Contracts

Two new exports, nothing removed, no response shape changed.

```ts
// src/server/repos/categories.ts
export const seedStandardCategoriesSchema = z.strictObject({
  locale: z.enum(SUPPORTED_LOCALES),
})
export interface StandardSetResult {
  readonly created: number
  readonly skipped: number
}
export async function seedStandardCategories(
  scope: TenantScope,
  input: z.input<typeof seedStandardCategoriesSchema>,
): Promise<StandardSetResult>

// src/server/fns/categories.ts: POST, requireOrg(), the same schema, no ledger batch.
export const seedStandardCategories = createServerFn({ method: 'POST' })
```

Changed behaviour: `createCategory`, `updateCategory`, `archiveCategory`, `restoreCategory`, `reorderCategories`,
`moveCategory` and `seedStandardCategories` throw `ForbiddenError` for a `member` in a workspace with more than one
member (the existing `assertMayAdminister` rule: owner and admin always pass; a solo workspace always passes).
`CategoryDepthError` and `CategoryHasChildrenError` keep their class, `categoryId`, `parentId` and `childCount`
properties and their `CONFLICT` code; only their message text changes (Phase 3). `BACKWARD_COMPATIBILITY.md` lists
no category surface; Phase 3 checks that with `grep -n -i categor BACKWARD_COMPATIBILITY.md` and stops to amend the
spec if that has changed.

## 📝 UI/UX

- **Empty state** (`CategoryEmptyState`, `status=active` and no rows): **Add the standard set** is the primary
  action, **Add a category** the secondary. While the seed runs the primary button is `isPending` (React Aria's own:
  it stays focusable) and the secondary is disabled. On success the page refreshes into the tree, a toast says how
  many were added, and **focus moves to the tree** (its first row), because the button that held it has unmounted. On
  failure the existing refusal region (`role="alert"`) shows an `ErrorPanel` with a retry; the empty state stays.
  The action appears **only** in the empty state, not in the header of a populated page.
- **Refusal** (Phase 3): the same `ErrorPanel` and the same assertive region, with a detail sentence that names the
  moved category and the target parent, built from the catalogue, in the active locale. Any other failure shows the
  existing generic body and no server text.
- **Tokens:** none new. The colour stays a swatch beside the name, never a row fill. **Quota:** none.

## 📝 Edge Cases & Failure Scenarios

- Pressing **Add the standard set** twice (double click, or two tabs): the second run skips every slug the first
  wrote; the toast says nothing was added when `created` is 0.
- A workspace with only archived categories shows the empty state (`status=active`); the seed skips those slugs, so
  a person who archived `food` does not get a second one, and the toast says what was added.
- A hand-made category called "Food" has the slug `food`: the seed skips `food`, and attaches `groceries` and
  `dining-out` to it as children if it is top-level, or skips them if it is itself a child.
- A run that stops after the first chunk (network): parents are present, some children are not; pressing the action
  again adds the rest. No row is duplicated (the unique index `(organization_id, slug)` is the backstop).
- A plain `member` in a shared workspace presses the action, drags a row or edits a category: the repository throws
  `ForbiddenError`; the existing panels show their generic line. They can still pick every category.
- A move refused after the tree went stale in another tab: the sentence names the rows the person saw; the refresh
  that follows shows the truth.
- A refusal whose cause is not a conflict (forbidden, not found, network): the generic body, never the depth
  sentence.

## 📝 Risks & Impact Review

| Risk                                                                                            | Severity | Mitigation                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A plain member loses the ability to rename, archive or reorder categories in a shared workspace | Medium   | A decided product rule (row 4); loosening a gate later breaks no one; one test per function pins the rule.                                                      |
| The seed exceeds D1's 100-parameter ceiling and fails in production only                        | High     | Chunk size computed from the measured 12 parameters per row; the Phase 4 test reads the proxy driver's parameter count for every statement and fails above 100. |
| Re-running the seed duplicates or overwrites rows                                               | High     | Slug-keyed skip; the unique index; a test that runs it twice and a test that runs it over a renamed row.                                                        |
| `seedStandardCategories` crosses a workspace boundary                                           | High     | Base-repository inserts only; a case in `tenant-isolation.test.ts` (A seeds, B's tree is byte-identical, B's slugs do not count as taken for A).                |
| The route classifies the wrong failure as a depth refusal                                       | Medium   | `code === 'CONFLICT'` only; forbidden, not found and unknown shapes get the generic body; the browser case proves the real wire shape.                          |
| The refusal predicate disagrees with `05-S1` later                                              | Low      | One named route-local function, replaced in one line (Architecture).                                                                                            |
| The standard set is a product claim about what almost everyone wants                            | Low      | Reversible: no row is system, all are deletable or archivable; the data file is one place to change.                                                            |

## 📝 Visual change expected

`/categories` only, light and dark, 360 and 1280 px (the plan also asks 2560): (1) the **empty state** gains a
primary button and keeps its secondary one; (2) a **populated tree** is unchanged; (3) the **refusal panel** shows a
localised sentence naming two categories instead of a raw English server sentence; (4) after the seed the page shows
the 36-row tree and a toast. No other route changes.

## 📝 Copy

Every key lands in `src/lib/i18n/messages/en.ts` and `pl.ts` in the same change (skill `i18n-messages`; the parity
test fails otherwise). New:

- `categories.seed.action`: "Add the standard set"
- `categories.seed.failed`: "The standard set could not be added" (body: the existing `empty.error.body`)
- `categories.toast.seeded`: a plural message, `one`: "Added {count} category.", `other`: "Added {count} categories."
  (the Polish entry carries `one`, `few`, `many` and `other`; no `if (n === 1)`)
- `categories.toast.seeded.none`: "Everything in the standard set is already here."
- `categories.move.refused.nest`: "{category} cannot go inside {parent}: categories nest only two levels."

Changed (both locales): `categories.empty.body`, from "A category answers "what was this for". Add the first one and
the reports have something to group by." to a sentence that offers the ready-made set first: "A category answers "what
was this for". Start from a ready-made set you can rename, recolour or archive, or add your own." The Polish entries
are a real Polish phrasing, not a translation pass. The standard set's **names** are data in
`standard-set.ts` (table above), not catalogue keys: they are stored as text, like any category a person types.

## 📋 Phasing

| Phase | Tickets | What lands                                                                                              |
| ----- | ------- | ------------------------------------------------------------------------------------------------------- |
| 1     | 1       | Tests only: isolation section, money case 19, handler test.                                             |
| 2     | 1       | `assertMayAdminister` on six writes, with a case per function.                                          |
| 3     | 1       | Server messages name categories; the route's catalogue sentence; keys.                                  |
| 4     | 2       | 4a: data file, repository function, server function, tests. 4b: empty state, route wiring, keys, focus. |
| 5     | 1       | `e2e/categories.visual.spec.ts`.                                                                        |
| 6     | 1       | Plan amendment, schema comment, one pointer sentence in `26-S1`, `Delivered:` line.                     |

That is seven tickets, within the eight an `afk-to-tickets` run slices.

## 📋 Implementation Plan

### Phase 1

1. **Isolation section.** Add `describe('categories cannot be reached or be aimed across a workspace boundary', …)`
   to `src/server/repos/__tests__/tenant-isolation.test.ts`, after the transactions section, on the budget world
   (`createBudgetWorld`, `seedCategory` with a `parentId` for a two-level B tree, a `member` row for B). A, in A's
   scope: `getCategory`, `updateCategory`, `archiveCategory`, `restoreCategory`, `deleteCategory`,
   `reorderCategories` (one A id and one B id in the same call: nothing of A's moves either),
   `moveCategory({ id: <B>, … })` and `createCategory` / `moveCategory` with a B `parentId`; every one is a
   `NotFoundError` compared on `entity` and `code` only; `listCategories` returns none of B's; `spendingByCategory`
   counts none of B's spending under an identically named category. Afterwards B's rows are **byte-identical**
   (`select * from categories where organization_id = 'org-b'` before and after). A positive control for each call
   shape against A's own id so the refusals are not a typo.
2. **Money case 19.** In `src/server/repos/__tests__/money-invariants.test.ts` add
   `describe('19 — a category write never touches an amount', …)` (the next free number at implementation time; 18
   exists at HEAD `bbd7c16`): run all nine exports in a sequence that includes a re-parent, an archive with cascade, a
   restore and the delete of an unused row, over a world with a transaction, a split and an account balance
   under one of the categories; assert from the proxy driver's statement log that no write statement mentions
   `"transactions"`, `"transaction_splits"`, `"accounts"`, `"account_balances"` or `"exchange_rates"`, and that
   `amount_minor`, `currency_code`, `ref_amount_minor`, `ref_currency_code`, `rate_e10` and `category_id` of the
   transaction and the split are unchanged. The existing "money boundary" section of `categories.test.ts` stays
   (deleting a test is Ask First); the new case widens it to `createCategory` and `deleteCategory` and lives in
   the file `AGENTS.md` names. A case 19 for `seedStandardCategories` is added by Phase 4a.
3. **Handler test.** Create `src/server/fns/__tests__/categories.test.ts`, one `it` per behaviour, with the
   attachments technique: (a) each of the nine handlers calls `requireOrg()` and passes its scope (a rejecting
   `requireOrg` rejects every handler and writes nothing); (b) none of the writes enqueues a ledger rebuild: the real
   `setLedgerBatchPorts` with a fake namespace records zero `touch` calls over a full create, update, move, archive
   and delete sequence (the claim of the header comment); (c) the validator refuses an unknown field on `create`,
   `update` and `move` (`z.strictObject`), a colour that is not `#rrggbb`, an icon outside the tuple, an empty id
   and a 65-character id; (d) a B id through `getCategory`, `archiveCategory` and `moveCategory` handlers rejects
   with a `NotFoundError`. Do not mock repository code. Prove (b) bites: wrap one handler in `runWithLedgerBatch`
   locally, see the case fail, revert.
4. **Run** `pnpm vitest run src/server/repos/__tests__/tenant-isolation.test.ts
src/server/repos/__tests__/money-invariants.test.ts src/server/fns/__tests__/categories.test.ts`, then the gate.

Tenant-isolation and money-invariant cases for this phase are steps 1 and 2. No file under `src` outside
`__tests__` changes.

### Phase 2

5. In `src/server/repos/categories.ts` call `await assertMayAdminister(scope, '<verb> a category')` first (after the
   Zod parse, before any read or write) in `createCategory`, `updateCategory`, `archiveCategory`, `restoreCategory`,
   `reorderCategories` and `moveCategory` (`'create a category'`, `'edit a category'`, `'archive a category'`,
   `'restore a category'`, `'reorder categories'`, `'move a category'`; `deleteCategory` keeps its call). Do not gate
   `listCategories`, `getCategory`, `spendingByCategory` or `assertCategoryUsable`.
6. In `categories.test.ts`, extend the existing delete case into a table: for each of the seven gated functions, a
   `member` scope in a workspace with a second member (`addSecondMember`) is refused with `ForbiddenError` **and no
   row changes**; the same call passes for `admin` and `owner`, and for a `member` in a solo workspace. Match each case
   to the function it calls, not to its name. Add the handler-level case to Phase 1's file: a `member` in a
   shared workspace through the `createCategory` handler rejects.
7. Update the header comment of `categories.ts` and of `fns/categories.ts`: writes are gated; reads are not.
   Tenant-isolation test: unchanged (Phase 1). Money invariant: unchanged.

### Phase 3

8. **Server messages.** `CategoryDepthError` takes the two rows' names (`categoryName`, `parentName`) beside the ids:
   `Categories nest two levels: "Groceries" cannot sit inside "Fuel", which is already inside another category.`;
   on `createCategory` the moved category's name is `parsed.name`. `CategoryHasChildrenError` names the category and
   prints the count without a plural: `Category "Food" has subcategories (3); move them out before filing it inside
another category.` Keep `categoryId`, `parentId`, `childCount` and the `CONFLICT` code. Update the assertions in
   `categories.test.ts` ("refuses a parent that is itself a child, naming both rows" currently expects the id).
9. **Route sentence.** In `src/routes/_app/categories/index.tsx` replace the string `refusal` state with a small
   discriminated state: `{ kind: 'nest', category: string, parent: string } | { kind: 'generic' }`, set in
   `applyMove` from the names in `byId` and the move's `parentId`. The `ErrorPanel` keeps `categories.move.refused` as
   title; the body is `categories.move.refused.nest` (with `category` and `parent`) for `nest` and the existing
   `categories.move.refused.body` for `generic`; **the `detail` prop is no longer passed** and no server text is
   shown. `nest` is chosen when `moveCategory` (not `reorderCategories`) failed, the target `parentId` is not
   `null`, and `isConflict(error)` holds, where `isConflict` is a route-local function reading `code === 'CONFLICT'`
   from the rebuilt error. Failures of `restoreCategory` and of `reorderCategories` are `generic`. A source comment
   names `05-S1`'s `readFailure` as its replacement. Do not edit the other `error.message` sites of the file.
10. **Component test** (`@testing-library`, the route's component or an extracted `MoveRefusal` if the route cannot be
    mounted; extract only if needed): `nest` renders both names in the active locale and the region is
    `role="alert"`; `generic` renders no server text; an unknown error shape renders `generic`.
11. Add the key (Copy) in both locales; run `pnpm vitest run src/lib/i18n` for parity.

Tenant-isolation test: unchanged. Money invariant: none, the phase writes no amount.

### Phase 4

**4a (server).** 12. Create `src/server/categories/standard-set.ts`: the typed table above (`slug`, `parentSlug | null`, `kind`,
`hue` as a member of `CATEGORY_HUES`' values, `icon` as a `CategoryIconName`, `names: Record<Locale, string>`),
exported as `STANDARD_CATEGORIES`. No SQL, no import of the repository. 13. Add `seedStandardCategories` and its schema to `categories.ts` as in API Contracts, with the gate (Phase 2's
call), the slug read, the skip rules, the continuation of `position`, parents-first chunks of at most
`floor(100 / 12)` rows computed from a named constant (`CATEGORY_INSERT_PARAMETERS = 12`) next to a comment that
states how it was measured, and the `{ created, skipped }` result. `isSystem: false`. 14. Add the server function `seedStandardCategories` to `fns/categories.ts`. 15. Tests in `categories.test.ts`: the table is a valid tree (depth 2, parents precede children, slugs unique and
match the slug regex, every hue is in `CATEGORY_HUES`, every icon is in the tuple, every name passes `nameSchema`
in both locales, no name is empty); a fresh workspace gets 36 rows in the requested locale, each child of its
parent, `is_system = 0`, children carry their parent's hue; a second run creates 0 and skips 36; a renamed
row and an archived row keep their state and are not duplicated; a hand-made top-level `food` receives
`groceries` and `dining-out` and is not renamed; a hand-made child named `food` makes its would-be children skip;
**every statement the seed ran bound at most 100 parameters** (read from the proxy driver); a `member` in a shared
workspace is refused; recolouring `housing` afterwards repaints its four children. Add
`seedStandardCategories` to the isolation section (A seeds; B's tree is byte-identical; B holding `food` does
not make A skip it) and to money case 19.

**4b (UI).** 16. In `category-states.tsx` give `CategoryEmptyState` the two actions (`onSeed`, `onCreate`, `isSeeding`), primary
and secondary, with `isPending` on the primary. In the route call the server function with `locale` from
`useLocale()`, then `refresh()`, a toast (`categories.toast.seeded` with `count`, or `.none`), and move focus to
the tree; on failure set the generic refusal region's panel with `categories.seed.failed` and a retry. 17. Component tests: the empty state renders both buttons with the primary first in the tab order; `isPending` keeps the
primary focusable and disables the secondary; a click calls `onSeed` once; after success the first tree row is
focused. `DESIGN.md` needs no entry: the empty state is not a new shared component. 18. Add the keys (Copy) in both locales; `pnpm vitest run src/lib/i18n`.

Tenant-isolation test: step 15. Money invariant: case 19 gains the seed (step 15).

### Phase 5

19. Create `e2e/categories.visual.spec.ts` on the model of `e2e/rules.visual.spec.ts`: `storageStateFor('demo')`,
    `./support/console` (a red console fails the run), `expectNoSeriousViolations` from `./support/budgets`. The demo
    workspace is read and never written (`scripts/seed/verify.mjs` asserts the counts): nothing here confirms a
    delete, completes a successful reorder or presses **Add the standard set**. Cases, each in light and dark and in
    `en` and `pl` where it prints text:
    - axe on `/categories` at rest: zero `serious`, zero `critical`;
    - the row menu opened **from the keyboard** on a child: the five ordering items and _Move to…_ are offered, the
      submenu lists the top-level parents and no child, and the item that would change nothing is disabled;
    - **the depth-cap refusal**, from the real server: a keyboard drag (focus a parent that has children's drag
      handle, Enter, arrow to a position beside a child, Enter) of the parent, asserting the `role="alert"` region
      then reads the localised sentence naming the dragged parent and that child's parent, that `code` survived the
      wire (the sentence is the `nest` one, not the generic body), and that after a reload the tree is unchanged.
      The refusal writes nothing, so the demo stays intact. If React Aria's keyboard drag cannot be driven to that drop
      target in Playwright, use the pointer drag (`dragTo`) in Chromium for the same drop; the assertions do not change;
    - the empty state in the `empty` session (`storageStateFor('empty')`, as `states.spec.ts`): the two buttons by
      name, **Add the standard set** first, neither pressed;
    - axe on the empty state and on the refusal state.
20. Capture the browser evidence for the PR body with `scripts/visual/capture.mjs` (ADR 0016), frames outside the
    repository: a two-level tree of twelve categories, light and dark, **360 / 1280 / 2560 px**, the empty state, the
    _Move to…_ menu open, and the refusal sentence. Console silent through reorder and re-parent. `pnpm e2e` is not
    in the gate; run `pnpm exec playwright test e2e/categories.visual.spec.ts` against a running environment
    (`docs/agents/shared-checkout.md` ports) and state which one in the PR.

Tenant-isolation test and money invariant: none, the phase is a browser spec over reads and one refused write.

### Phase 6

21. **Amend the `08-S1` block** of `docs/plans/08-classification.md` so no plan-only name survives (every `###`
    heading of the template stays, `98-verification-protocol.md` §1):
    - _Owned paths_: `src/server/repos/categories.ts`, `src/server/fns/categories.ts`,
      `src/server/categories/standard-set.ts`, `src/routes/_app/categories/index.tsx`,
      `src/routes/_app/categories/-ui/category-form-dialog.tsx`, `src/components/app/categories/`,
      `src/components/app/tree/`, `src/server/repos/__tests__/categories.test.ts`, the isolation and money sections
      named in Phase 1, `src/server/fns/__tests__/categories.test.ts` and `e2e/categories.visual.spec.ts`; drop
      `settings/categories.tsx`, the two `settings/-ui` files and the `reorder-menu` reference, with one sentence on why.
    - _Data and migration_: no schema change; the standard set, its 36 rows summarised, `is_system = false`,
      applied by the empty state's action and not at provisioning; `04-S1` is unchanged.
    - _Server_: colour inheritance is maintained on write (`NOT NULL` column) and not resolved on read; the case-folded
      colour schema; `assertMayAdminister` on every write; the seed function; the two refusal messages; the import-path
      rule of the Architecture.
    - _UI_: the route is `/categories`; the empty state's two actions; the refusal sentence built from the catalogue.
    - _Tenant isolation_, _Money invariant_, _Verification_: the Phase 1 to 5 files and cases.
    - Change nothing outside the `08-S1` block, with one exception: one pointer sentence in the `presets.ts` bullet of
      `## Stage 26-S1` in `docs/plans/26-onboarding.md` ("the category structures build on the standard set
      `src/server/categories/standard-set.ts` of `08-S1` and never redefine it").
22. **Correct the `is_system` comment** in `src/server/db/schema.ts` (comment only; no `drizzle/` change, and
    `pnpm db:generate` must stay a no-op) and the matching sentence of the `08-S1` block: system rows are reserved for
    a row the product must find by slug, none exists today, and the standard set is not system.
23. **Add the `Delivered:` line** directly under `## Stage 08-S1`: `Delivered: <YYYY-MM-DD> - <evidence>`, dated the
    day Phase 6 is written, naming the paths of step 21, the Phase 1 to 5 pull requests, and the test counts re-read by
    running `pnpm vitest run` on the changed files in the Phase 6 pull request (the numbers at spec time were 41, 7, 4,
    4 and 21; never copy them). If the slicer merged phases into one pull request, name the paths and tests and add
    the pull request number in a final commit once it is known.
24. **Run the gate** on the staged tree, in the order printed by
    `node -e "require('./.ai/agentic.config.json').validation.commands.forEach(c=>console.log(c))"`, plus
    `pnpm exec prettier --check docs/plans/08-classification.md docs/plans/26-onboarding.md`. Wait on `pnpm test` with
    `timeout: 600000` and its output in a file.

## 📝 Resolved assumptions (autonomous defaults)

Every row is a decision this run made without a human, or a default it applied. Each is reversible before merge by
saying so on the spec PR.

| #   | Question                                                                          | Applied default                                                                                                                                                                                                                                     | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Keep the screen at `/categories` or move it to the plan's `/settings/categories`? | **Keep `/categories`; Phase 6 amends the plan.**                                                                                                                                                                                                    | The route, the settings hub link (`src/routes/_app/settings/index.tsx`), five e2e specs, `e2e/support/surfaces.ts` and `docs/agents/parity.md` all say `/categories`; a move is churn with a redirect and no user value. A default the code settles, not a question.                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2   | What does "Add the standard set" create, and are its rows `is_system`?            | **Option B: one fixed bilingual set of 36 rows (table in Data Model), created by the explicit action, every row `is_system = false`, slugs English and stable, names in the requesting locale, slug-keyed idempotent.**                             | Decided by the product owner sub-agent (confidence medium): the plan promises the action as the default path (08-S1 States); the justification for `is_system` (slug addressing by importers and rules) does not hold in the code, and an undeletable seed is the least reversible choice. Flipping a flag later is additive; un-systeming rows is not.                                                                                                                                                                                                                                                                                                                   |
| 3   | Where is the seed applied and who owns the data?                                  | **One more function of `repos/categories.ts` called from the empty state; the data in `src/server/categories/standard-set.ts`; not at provisioning; `26-S1`'s presets import it.**                                                                  | Default from `AGENTS.md`: only three documented exceptions to "all SQL lives in `src/server/repos`", none is categories, and the product owner's condition was that the data file is the stage's and `presets.ts` never forks it.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4   | How does the seed learn the locale, and what does it write into the name?         | **The caller's active locale as an argument; the localised name as plain stored text; the slug is English in both.**                                                                                                                                | No stored workspace locale exists (`fns/locale.ts`); a category name is the person's own text like one they typed. Condition of the product owner sub-agent: a real Polish set, not a machine translation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 5   | Which category writes need `owner \| admin`?                                      | **Option C: all of them, including create and the seed; reads and `assertCategoryUsable` ungated; no UI hint.**                                                                                                                                     | Decided by the security and tenancy reviewer sub-agent (confidence medium): the plan has no create exemption; a rename, archive (with cascade) or move changes grouping and pickers for every member; loosening later breaks no one, tightening does. Condition applied: gate in the repository after the Zod parse; one case per function; revisit create if an importer ever writes as a plain member. The accounts precedent gates group writes only because its own plan says so. No screen in the app hides controls by role, so this stage adds none.                                                                                                               |
| 6   | How does the depth-cap refusal reach the person?                                  | **Option B: the route builds the sentence from a catalogue key and the names in its loaded tree, only for a conflict-class failure of `moveCategory`; no server text is shown; the server messages still name the categories and lose `(y\|ies)`.** | Decided by the software architect sub-agent (confidence medium): survives `05-S1`'s redaction, stays inside 08-S1 files, keeps the repository the only decider (the pre-check of option D is forbidden by `components/app/tree/move.ts`), and widens no closed envelope (option C). Conditions applied: a route-local predicate that `05-S1` swaps in one line; one neutral sentence true for both causes, so no plural key; generic body for any non-conflict failure. The brief's claim that a client could classify the failure today was wrong (`readFailure` is not built); the `code` property is what the predicate reads, and Phase 5 proves it on the real wire. |
| 7   | Colour inheritance: resolve on read (the plan) or maintain on write (the code)?   | **Maintain on write; the plan is amended.**                                                                                                                                                                                                         | `color` is `NOT NULL`, the repository and `schema.ts` document the mechanism, and seven tests pin it; resolving on read would need a nullable override column, a migration, and would change what a printed chart means.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 8   | One batch or chunks for the 36 inserts?                                           | **Chunks of at most 8 rows, parents first, idempotent.**                                                                                                                                                                                            | Measured at HEAD: 1 row binds 12 parameters, 8 rows 96, 9 rows 108, 36 rows 432; D1's ceiling is 100 (the repository states it at `import-preview.ts` and computes chunks from it). The product owner's "one batch" condition cannot hold at D1's ceiling; slug idempotence gives the same outcome (a stopped run is finished by pressing again).                                                                                                                                                                                                                                                                                                                         |
| 9   | The plan's "including the import path" for the depth cap                          | **Recorded as a rule, pinned at the repository door; no importer test.**                                                                                                                                                                            | No importer writes a category (`commitImport` does not exist; `map.ts` reads a column). `AGENTS.md` forbids SQL outside the repositories, so `createCategory` and `moveCategory` are the only doors, and both are pinned.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 10  | Browser evidence for a refusal in the shared demo workspace                       | **A real refused keyboard drag; falls back to the pointer drag for the same drop; never a mocked response.**                                                                                                                                        | A refusal writes nothing, so the demo stays intact (`verify.mjs`), and a mocked response would be evidence about the mock. Playwright's ability to drive React Aria's keyboard drag is not known at spec time; the fallback changes the gesture, not the assertions.                                                                                                                                                                                                                                                                                                                                                                                                      |
| 11  | Treat the stage as delivered (mark it) or give it a spec?                         | **A spec for what is left.**                                                                                                                                                                                                                        | The standard set, the gate, the named refusal, the stage's own invariant cases and the browser spec are unmet; § 2a marks only what the evidence proves.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 12  | Does Phase 6 add the `Delivered:` line, and when?                                 | **Yes, as its last step, after Phases 1 to 5 have merged.**                                                                                                                                                                                         | A marker nothing re-checks must follow the evidence it cites; the 07-S1, 03-S1 and 05-S2 specs do the same.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 13  | Do the handler tests mock repository code?                                        | **No. Only the framework seams (`createServerFn`, `requireOrg`, `cloudflare:workers`).**                                                                                                                                                            | A mocked repository would agree that the gate and the refusal are present whether or not they are.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 14  | Which numbers in this spec are measured?                                          | `906` lines, `41 + 7 + 4 + 4 + 21 = 77` tests (one run), `12` parameters per row and `96 / 108 / 432` for 8 / 9 / 36 rows, `36` rows (`12` parents, `24` children), `18` the highest money-invariant section.                                       | Read from the commands below, run while writing this spec at HEAD `bbd7c16`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 15  | Product owner: approve this spec?                                                 | _Filled in by the panel step._                                                                                                                                                                                                                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 16  | Software architect: approve this spec?                                            | _Filled in by the panel step._                                                                                                                                                                                                                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 17  | Security and tenancy reviewer: approve this spec?                                 | _Filled in by the panel step._                                                                                                                                                                                                                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 18  | Accessibility and UX specialist: approve this spec?                               | _Filled in by the panel step._                                                                                                                                                                                                                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

The commands behind row 14:

```bash
wc -l src/server/repos/categories.ts
pnpm vitest run src/server/repos/__tests__/categories.test.ts src/components/app/categories src/components/app/tree   # 5 files, 77 tests
grep -rn "isSystem" src --include='*.ts' --include='*.tsx' | grep -v __tests__                                      # no insert sets true
grep -n "assertMayAdminister" src/server/repos/categories.ts                                                        # definition and one call, deleteCategory
grep -n "^describe(" src/server/repos/__tests__/money-invariants.test.ts | tail -1                                  # 18
# parameters per category row, from drizzle's toSQL() over a sqlite-proxy db, a throwaway test file: 12 / 96 / 108 / 432
```
