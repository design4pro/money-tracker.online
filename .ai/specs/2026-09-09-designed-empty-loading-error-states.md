# Designed empty, loading and error states — evidence, gaps and reachability

## 📝 TLDR

The blind comparison round of 2026-09-03 recorded "no designed empty or loading state" against
`/accounts` and declined to score `/budgets` on the same criterion. A read of the route modules says
the critics were looking at a screen they could not reach: the three states are already designed on
most surfaces, and the round photographs a seeded fixture that never shows any of them. This spec
turns that suspicion into a committed inventory, closes the six route modules the inventory finds
genuinely bare, gives the e2e suite and `scripts/visual/capture.mjs` a way to reach a loading and an
error frame deliberately, and puts a baseline plus an axe scan on every empty state. It changes no
schema, no server function and no money path.

## 📝 Problem Statement

`docs/agents/reference.md` names **state completeness** — "designed empty, loading and error states"
— as one of the six things a comparison round judges, "because a finance app is full of screens a
new user sees with nothing in them". The round of 2026-09-03
(`docs/rounds/2026-09-03-blind-comparison.md` §5) reported it as a defect:

> Named explicitly on accounts, and noted on budgets as absent from both products.

Issue #21 reads that finding correctly as a **floor, not a ceiling**: the round photographs the
seeded demo workspace, which has five accounts, three currencies and roughly six hundred
transactions. An empty list is unreachable in that fixture, a loading frame lasts a few hundred
milliseconds and is gone before the shutter, and an error frame requires the server to fail. What
the round establishes is therefore not "these states do not exist" but "**we have no evidence they
exist, on any surface**".

The evidence question and the design question have different answers, and the inventory is what
separates them.

### The inventory, as read from the route modules on `develop` at `103776b`

Every route module under `src/routes/_app` was read for four signals: does it carry a `loader`, does
it declare a `pendingComponent`, does it declare an `errorComponent`, and does it render a designed
branch when its data set is empty. Client-query surfaces (`useQuery`) were read for the equivalent
`isPending` / `isError` branches inside the component.

| Surface                        | Loading                                             | Error                                            | Empty                                    |
| ------------------------------ | --------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| `/dashboard`                   | ✅ `pendingComponent`                               | ✅ `errorComponent`                              | ✅ per widget                            |
| `/accounts`                    | ✅ `AccountListSkeleton`                            | ✅ `ErrorPanel` + retry                          | ✅ `AccountEmptyState` + `FilteredEmpty` |
| `/accounts/$accountId`         | ✅                                                  | ✅                                               | n/a (detail)                             |
| `/transactions`                | ✅ in `TransactionsScreen` (`pageQuery.isPending`)  | ✅ in `TransactionsScreen` (`pageQuery.isError`) | ✅ `TransactionsEmpty`                   |
| `/transactions/planned`        | ✅ via `TransactionsScreen`                         | ✅ via `TransactionsScreen`                      | ✅ own `EmptyState`                      |
| `/transactions/groups`         | ✅                                                  | ✅                                               | ✅                                       |
| `/transactions/new`            | ✅ `TransactionFormSkeleton`                        | ✅ `TransactionListError`                        | ✅ `noAccounts` precondition state       |
| `/transactions/$transactionId` | ✅ `TransactionFormSkeleton`                        | ⚠️ every query error renders **not-found** copy  | n/a (detail)                             |
| `/transactions/rules`          | ❌ **none**                                         | ✅ `RulesListError`                              | ✅                                       |
| `/transactions/rules/$ruleId`  | ❌ **none**                                         | ✅                                               | n/a (detail)                             |
| `/transactions/rules/new`      | ❌ **none**                                         | ❌ **none** (falls to the shell `CatchBoundary`) | n/a (form)                               |
| `/budgets`                     | ✅ `BudgetListSkeleton`                             | ✅ `BudgetsListError`                            | ✅                                       |
| `/budgets/$budgetId`           | ✅                                                  | ✅                                               | ✅ (empty period)                        |
| `/categories`                  | ✅                                                  | ✅                                               | ✅                                       |
| `/goals`                       | ✅                                                  | ✅                                               | ✅ `GoalEmptyState`                      |
| `/goals/$goalId`               | ✅                                                  | ✅                                               | n/a (detail)                             |
| `/payees`                      | ✅                                                  | ✅                                               | ✅                                       |
| `/payees/$payeeId`             | ❌ **none**                                         | ✅ + `notFoundComponent`                         | n/a (detail)                             |
| `/recurring`                   | ✅                                                  | ✅                                               | ✅ `RecurringEmptyState`                 |
| `/recurring/$seriesId`         | ✅                                                  | ✅                                               | n/a (detail)                             |
| `/recurring/candidates`        | ✅                                                  | ✅                                               | ✅                                       |
| `/import`                      | ❌ **none**                                         | ❌ **none** (falls to the shell `CatchBoundary`) | ✅ `import.history.empty.*`              |
| `/import/$batchId`             | ❌ **none** for the loader (the file probe has one) | ❌ **none**                                      | ✅                                       |
| `/settings`                    | n/a — no loader, no query, nothing async            | n/a                                              | n/a                                      |
| `/settings/members`            | ✅                                                  | ✅                                               | ✅                                       |
| `/settings/billing`            | ✅                                                  | ✅                                               | ✅                                       |

Read as a whole, the inventory says four things.

**One.** The finding against `/accounts` and `/budgets` is a **reachability** finding, not a design
one. Both surfaces carry all three states, and both were photographed in the only state the fixture
can produce.

**Two.** Six route modules are genuinely bare of a **loading** state — `/import`, `/import/$batchId`,
`/payees/$payeeId`, `/transactions/rules`, `/transactions/rules/$ruleId`,
`/transactions/rules/new` — and three of those are also bare of an **error** state. `src/router.tsx`
sets a `defaultErrorComponent`, and `_app.tsx` mounts a `CatchBoundary` inside the shell, so a
failure on those three is caught and rendered; but it is rendered as the generic shell failure, not
as something that names what did not load or offers the region's own retry. There is **no**
`defaultPendingComponent`, so a bare loader shows the reader the _previous_ screen until it
resolves, with nothing saying anything is in flight — which is exactly the "collapsed layout" the
issue's Desired section forbids.

**Three.** `/transactions/$transactionId` renders `transactions.detail.notFound.*` for _any_ detail
query failure. Before #16 that was defensible, because a missing row and a broken read were
indistinguishable. #16 shipped (`#64`, merged `723e991`): `src/server/fns/not-found.ts` throws the
router's not-found sentinel, and `__root.tsx` renders it. The conflation is now a lie — a transient
read failure tells the reader their transaction does not exist.

**Four.** The house style is **already consistent**, and the issue's Out-of-scope clause therefore
resolves to "say so and stop". A region that is loading draws a skeleton of the layout that is
coming (`RoutePending`, `AccountListSkeleton`, `TransactionFormSkeleton`, …); `Spinner` appears only
inside a control or an inline row (`Button`, `transaction-list`, four dialogs, the import preview).
Nowhere does a spinner stand in for a page load. That rule is not written down anywhere, which is
why the inventory has to write it down.

### One thing the inventory found that the issue did not ask about

`ErrorPanel` — the retryable failure panel every surface uses — lives at
`src/components/app/accounts/error-panel.tsx` and is exported from the **accounts** barrel. It is
imported by **32 modules outside `components/app/accounts`**, spanning budgets, categories,
dashboard, goals, payees, recurring, settings, transactions and rules.

`docs/SPEC.md` §8 is unambiguous: a concept is owned by exactly one module and everything else calls
it. The error treatment this spec is asked to make consistent across every surface is currently
owned by one product area, and every other area reaches across a boundary to borrow it. That is the
single most likely way a second error treatment gets written: the next author who does not want to
import from `accounts` writes their own panel.

## 📝 Proposed Solution

Four moves, in the order the issue itself proposes them.

1. **Commit the inventory** as `docs/rounds/2026-09-09-state-inventory.md` — the table above, the
   house-style rule it discovered, and the reachability verdict. This is the first pass's actual
   deliverable and it is what makes the second pass small.
2. **Give the error treatment an owner.** Move `ErrorPanel` to `src/components/app/shell/`, where
   `RoutePending`, `RouteError` and `DefaultRouteError` already live, and update the 32 importers.
   Nothing about the component changes.
3. **Close the six bare route modules** with the same `pendingComponent` / `errorComponent` pattern
   the other nineteen already use, and split not-found from error on
   `/transactions/$transactionId`.
4. **Make the states reachable deliberately**, then photograph and scan them:
   - **empty** — a fourth fixture workspace, seeded with nothing and written to by nothing, reached
     through a cached Playwright session exactly like `demo`, `tenant-a` and `tenant-b`;
   - **loading** and **error** — Playwright route interception in front of the server-function
     endpoint: hold the response open for the loading frame, answer `500` for the error frame;
   - the same interception behind one new `capture.mjs` flag, so a capture round can photograph the
     states the critics said they could not see.

### Why not the alternatives

**A dev-only query parameter the loader honours (`?__state=loading`).** Rejected. It puts a
test-only branch in production route code, on every surface, forever; it is a new public surface on
25 routes that has to be defended against being reachable in production; and it proves the branch
renders rather than proving the _real_ loading path renders. Network interception exercises the
actual code path and adds zero production code.

**A `MSW`-style mock layer.** Rejected on `docs/SPEC.md` §3 — it is a new dependency, and Playwright
already has `page.route`.

**A dedicated `defaultPendingComponent` on the router instead of six per-route ones.** Rejected as
the _primary_ fix, and worth stating why, because it looks like the DRY answer. `RoutePending` draws
a title, four figure cards and six list rows; that shape is right for `/accounts` and wrong for
`/import`, whose page is two upload cards and a history table. A default that is the wrong shape
everywhere reintroduces the layout jump the skeleton exists to prevent. Each of the six gets the
skeleton its own layout implies, from the module that owns that layout.

**Screenshot diffing the states.** Refused outright: ADR 0016 removed pixel comparison from this
repository. A baseline here means a Playwright assertion about the DOM plus a frame filed outside
the repo for a human, never an image compared by a machine.

## 📝 Architecture

### Owner modules

Per `docs/SPEC.md` §8, every concept this spec touches gets named:

| Concept                                        | Owner module                                 | Status                        |
| ---------------------------------------------- | -------------------------------------------- | ----------------------------- |
| The empty state (shape, heading, action slot)  | `src/components/ui/empty-state.tsx`          | exists, unchanged             |
| The loading placeholder (shape, shimmer, a11y) | `src/components/ui/skeleton.tsx`             | exists, unchanged             |
| The retryable failure panel                    | `src/components/app/shell/error-panel.tsx`   | **moves** from `app/accounts` |
| The route-level pending shell                  | `src/components/app/shell/route-pending.tsx` | exists, unchanged             |
| The route-level failure shell                  | `src/components/app/shell/route-error.tsx`   | exists, unchanged             |
| The not-found sentinel                         | `src/server/fns/not-found.ts` → `__root.tsx` | exists (#16), unchanged       |
| The empty fixture workspace                    | `e2e/support/session.ts`                     | one new credential            |
| Deliberate state reach (loading, error)        | `e2e/support/states.ts` — **new**            | new                           |
| Capture-side state reach                       | `scripts/visual/capture.mjs`                 | one new flag                  |

Per-surface skeletons stay where they are — `src/components/app/<area>/<area>-skeletons.tsx` — and
the new ones join them. A skeleton is a picture of one area's layout and belongs to that area; only
the primitive is shared.

### The layering this spec does not disturb

`docs/SPEC.md` §6.1 holds throughout. No SQL is written or moved; `src/server/repos` is untouched.
No server function gains, loses or changes an input, so the "Zod twice" rule has nothing to bind to
here. `components/ui` still never fetches and still never imports from `server/` — `EmptyState` and
`Skeleton` take props and nothing else, and `ErrorPanel` moves between two directories that both sit
above `components/ui` and below the routes.

### How a state is reached deliberately

The three mechanisms are deliberately different, because the three states have different causes.

**Empty is a data condition**, so it is reached with data: a workspace with no rows in it. A fourth
fixture credential joins `DEMO`, `TENANT_A` and `TENANT_B` in `e2e/support/session.ts`, is minted
once by the `setup` project the same way they are, and is **read-only by contract** — no spec writes
to it, which is the whole reason it is a fourth workspace rather than a reuse of `tenant-b` (whose
docblock says each test creates its own rows inside it). A test that needs an empty `/goals` signs
in as that workspace and navigates. Nothing in `src/` changes.

**Loading is a timing condition**, so it is reached with timing. `e2e/support/states.ts` exports a
helper that installs `page.route` in front of the server-function endpoint and holds the response
until released. The route is under load for as long as the test wants; the skeleton is on screen and
assertable; releasing the hold lets the real response through and the real content render. The
loader itself is unmodified and genuinely in flight — this is not a rendered stand-in.

**Error is a response condition**, so it is reached with a response: the same helper, fulfilling
with `500` and an empty body instead of holding. The route's `errorComponent` — or the component's
`isError` branch — runs for real, including its retry, which the test then exercises by removing the
interception and pressing it.

`scripts/visual/capture.mjs` gets **one** flag, `--force-state <loading|error>`, that installs the
same two interceptions before navigating. It composes with the existing `--state` flag, which is
what prefixes the filename, so a run that captures the error frame writes
`error-1440x900-light-A.png` and cannot overwrite the at-rest frame. The script is a development
tool, outside the shipped bundle, and this flag never touches the production path.

### What the accessibility bar is here

`docs/ACCESSIBILITY.md` §5.1 is the gate and this spec does not widen it. An empty state is a screen
like any other: same AA bar, same axe rules, no waiver. Two properties the existing primitives
already provide and the new work must preserve:

- an empty state's title is a **real heading** at the level that keeps the page outline correct
  (`EmptyState`'s `headingLevel`), so a screen-reader user scanning by headings lands on the
  explanation rather than in a silent region;
- a loading region announces itself **once**, in a `role="status"` element carrying one sentence,
  with `aria-busy` on the container and `aria-hidden` on every individual bar — the contract
  `RoutePending` and `AccountListSkeleton` already implement and the six new skeletons must follow.

The axe scan of the empty states runs in the **e2e suite** (`e2e/states.spec.ts`), not in
`.github/a11y/routes.json`. That gate scans with the seeded demo session by construction, and adding
a fifth `access` value to it to carry an empty workspace would put fixture identity into a file
whose header explicitly refuses to be pinned to the fixture.

## 📝 Data Model

None. No table, column, index or migration. `drizzle/` is untouched, so the
`pnpm db:generate && git diff --exit-code -- drizzle/` gate is a no-op for this work.

## 📝 API Contracts

None. No server function is added, removed or re-shaped; no route gains or loses a search parameter;
no envelope changes. `BACKWARD_COMPATIBILITY.md` lists no surface this touches — the `ErrorPanel`
move is an internal import path, not a published one.

Money is not involved at any layer. No amount is read, formatted, summed or converted by anything
this spec adds, so `docs/MONEY.md` has no section to cite and no money-invariant case is owed.

## 📝 UI/UX

Only what is unique to this work; the primitives' own contracts are already documented in their
docblocks.

### The three states, stated once

- **Empty** — says what the screen is _for_ and offers the one action that fills it. Never "No
  data". `/import`'s history already reads this way (`import.history.empty.*`) and is the model.
- **Loading** — holds the layout that is coming. A skeleton whose blocks sit where the real content
  will sit, so nothing jumps when it is replaced. One announced sentence, never eleven announced
  rectangles.
- **Error** — says what did not load, says whether anything was changed, and offers a retry that
  actually retries. The raw message stays behind a closed disclosure, because a repository error is
  written for a developer and is English-only. This is `ErrorPanel`'s documented contract and it
  does not change; it only moves.

### The house-style rule the inventory writes down

> A region that is loading draws a **skeleton** of the layout it is about to show. A **spinner**
> appears only inside a control that is working (a pending button) or on an inline row awaiting one
> value. A spinner never stands in for a page or a region load.

This is a description of what the code already does on 19 of 25 surfaces, promoted to a rule so the
six being fixed do not each invent an answer.

### Not-found is not an error

Post-#16, a detail screen has three distinct outcomes and must render three distinct things: the row
(content), the row is gone (`notFound()` → the root's `notFoundComponent`), the read broke
(`errorComponent` / `ErrorPanel` with a retry). `/transactions/$transactionId` currently collapses
the last two into the first's copy and is corrected here.

## 📝 Visual change expected

Light and dark, 360px and 1280px, for every state listed. Nothing below is a redesign of a screen
that already renders — every frame is of a state that previously rendered _nothing designed_.

| Route                          | State   | What changes on screen                                                                    |
| ------------------------------ | ------- | ----------------------------------------------------------------------------------------- |
| `/import`                      | loading | New: an import-shaped skeleton (two source cards, a history table) replaces a blank hold. |
| `/import`                      | error   | New: `ErrorPanel` with a retry, in place of the generic shell failure.                    |
| `/import/$batchId`             | loading | New: a batch-shaped skeleton (header, progress, row table).                               |
| `/import/$batchId`             | error   | New: `ErrorPanel` with a retry.                                                           |
| `/payees/$payeeId`             | loading | New: a payee-detail skeleton (header, totals, transaction rows).                          |
| `/transactions/rules`          | loading | New: a rules-list skeleton (ordered rows).                                                |
| `/transactions/rules/$ruleId`  | loading | New: a rule-editor skeleton.                                                              |
| `/transactions/rules/new`      | loading | New: the same rule-editor skeleton.                                                       |
| `/transactions/rules/new`      | error   | New: `ErrorPanel` with a retry.                                                           |
| `/transactions/$transactionId` | error   | Changed: `ErrorPanel` + retry, where not-found copy was shown for a read failure.         |
| every surface in the table     | empty   | Unchanged code, **newly photographed** — the frames the round could not take.             |

The `ErrorPanel` move produces **no** visual change anywhere: same component, same markup, same
tokens, new path.

## 📝 Copy

Every key lands in `src/lib/i18n/messages/en.ts` **and** `src/lib/i18n/messages/pl.ts` in the same
change, per the `i18n-messages` skill and `docs/SPEC.md` §9. Naming follows the established
`<area>.list.loading` / `<area>.<surface>.error.{title,body}` shape already used by
`accounts.list.loading`, `budgets.list.loading`, `rules.error.*` and `payees.detail.error.*`.

`import.error.*` is **not** available: that namespace is already the per-row import parse errors
(`import.error.date_empty`, `import.error.amount_zero`, and eighteen more). The page-level failure
therefore uses `import.load.error.*`.

| `en` key                          | English text                                                         |
| --------------------------------- | -------------------------------------------------------------------- |
| `import.list.loading`             | Loading your imports…                                                |
| `import.load.error.title`         | The import page could not be loaded                                  |
| `import.load.error.body`          | Nothing was uploaded and nothing was changed. Try again in a moment. |
| `import.detail.loading`           | Loading this import…                                                 |
| `import.detail.error.title`       | This import could not be loaded                                      |
| `import.detail.error.body`        | The file and its rows are untouched. Try again in a moment.          |
| `payees.detail.loading`           | Loading this payee…                                                  |
| `rules.list.loading`              | Loading your rules…                                                  |
| `rules.editor.loading`            | Loading the rule editor…                                             |
| `rules.editor.error.title`        | The rule editor could not be loaded                                  |
| `rules.editor.error.body`         | No rule was created or changed. Try again in a moment.               |
| `transactions.detail.error.title` | This transaction could not be loaded                                 |
| `transactions.detail.error.body`  | Nothing was changed. Try again in a moment.                          |

`transactions.detail.notFound.*` stays exactly as it is and keeps its current job: the row is gone.
The two new `transactions.detail.error.*` keys are what a _read failure_ now says instead.

No existing key is removed or re-worded, so no stored row referencing a key is affected
(`docs/SPEC.md` §9 — keys in stored rows).

## 📝 Edge Cases & Failure Scenarios

- **The interception helper leaks into a later test.** A held route that is never released hangs the
  test at its timeout and, worse, a `page.route` left installed changes the next navigation in the
  same context. The helper is therefore scoped: it returns a disposable and the spec releases it in
  a `finally`, and it never matches more than the one endpoint pattern it was given.
- **`--force-state` used against the reference product.** Refused by the same rule that refuses
  `--auth` for anonymous-only screens: the flag intercepts _our_ server-function endpoint, and
  `capture.mjs` already refuses to combine `--auth` with `--enter`. `--force-state` follows
  `--auth`'s side of that split and is rejected together with `--enter`, because holding somebody
  else's demo's network open is not something this repository does.
- **The empty fixture workspace stops being empty.** A future spec writes a row into it and every
  empty-state assertion starts passing for the wrong reason or failing for a confusing one. Guarded
  two ways: the credential's docblock states the contract, and `e2e/states.spec.ts` asserts the
  workspace reads zero accounts and zero transactions before it asserts anything about a screen.
- **A held response outlives the browser's own timeout.** The hold is bounded — the helper releases
  after the assertion, and the surrounding `test` has Playwright's timeout as its own ceiling. A
  skeleton assertion that needs longer than that is a skeleton that never renders, which is the
  failure the test is for.
- **The `ErrorPanel` move collides with in-flight work.** 32 importers is a wide mechanical edit and
  it conflicts with anything else touching those files. It is therefore its own Phase, landing
  first, small and quick to review, rather than being folded into a Phase that also writes new
  components.
- **A new skeleton announces itself twice.** Two `role="status"` regions on one screen — the route's
  and a child's — read the reader two sentences for one load. Each of the six new skeletons carries
  exactly one announcement, at the level that owns the load, and the e2e assertion counts it.
- **`prefers-reduced-motion`.** Already handled by `Skeleton`, which drops the shimmer entirely. The
  new skeletons inherit it because they compose the primitive rather than re-implementing the
  shimmer, which is stated here so nobody re-implements it.

## 📝 Risks & Impact Review

**Blast radius.** Widest at the `ErrorPanel` move — 32 files, all import-statement edits, all
covered by `pnpm typecheck` and `pnpm lint`. Everything else is additive: six route modules gain two
properties each, one route module changes which copy it renders on one branch, and the rest is test
and script code that ships to nobody.

**What could regress.** A mis-shaped skeleton makes a page jump when content lands, which is a
worse experience than the blank hold it replaced. This is why each skeleton is drawn from the layout
of the screen it fronts and why each gets a baseline frame in both themes at both widths.

**Compatibility.** None affected. No `BACKWARD_COMPATIBILITY.md` surface, no schema, no server
function signature, no message key removed or re-worded.

**Rollback.** Per Phase, and each Phase is a single revert. Phase 1 is a document. Phase 2 is one
`git revert` of a mechanical move. Phase 3 removes six route properties and restores one branch's
copy. Phase 4 removes test and script code and one fixture credential; the credential's workspace
row can stay in a local database harmlessly.

**Accessibility claim.** Unchanged. This spec asserts AA on newly-reachable screens, which is the
existing gate applied to more surfaces. It makes no claim at AAA, and widens nothing in
`docs/ACCESSIBILITY.md`.

**Cost.** The e2e suite gains one setup step (a fourth sign-in, once per run, inside the existing
serial fixture step) and one spec file. `pnpm e2e` is not in the validation gate; CI runs it per PR.

## 📝 Research — what open-source practice already settled

This is a **pattern-level** comparison. No product-specific behaviour is asserted here that was not
read in this repository; the round's own findings in `docs/rounds/` are the empirical input, and the
clean-room rule (`docs/agents/reference.md`) forbids the reference product from contributing
anything but rendered pixels.

Three conventions are settled across open-source personal-finance and admin UIs, and this spec takes
all three rather than inventing:

1. **The first-run empty state is onboarding, not an apology.** It names the screen's purpose and
   carries the action that fills it. Already this repository's practice — `accounts.empty.action` is
   "Add your first account" — and the rule is now written down instead of being re-derived.
2. **Skeletons over spinners for region loads.** The layout-preserving placeholder is the settled
   answer for a known layout; the spinner survives for unknown-duration work inside a control.
   Already the practice here on 19 of 25 surfaces; promoted to a rule.
3. **Failure is scoped to the region that failed.** A failing panel replaces its panel and not the
   shell. `ErrorPanel`'s docblock already states this and `_app.tsx` already implements it.

What this spec deliberately **skips**, because it is complexity these products carry for reasons
this one does not have: a global offline banner and retry queue (the `empty.offline.*` keys exist;
wiring them is plan 27's business), a per-surface "seed me some demo data" button, and any form of
automatic retry with backoff — a finance app that silently re-issues a request the reader did not
see fail is a finance app that has to explain itself later.

## 📝 Resolved assumptions (autonomous defaults)

This spec was written by `om-auto-write-spec` in `--autonomous` mode. Each question below was
resolved toward the smallest, most reversible option. Any of them can be overridden on the PR before
the implementation starts.

| #   | Question                                                                                          | Resolution                                                                                                                                                    | Why                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | Does this bundle more than one independently deployable capability, and should it be split?       | **One spec, four Phases.** The inventory is a document; the gap-fill and the reachability work each ship alone and each leaves the app working.               | The mandatory split check. They are one arc — the inventory decides the gap-fill, the gap-fill decides what is worth photographing — and a Phase is the unit that ships.                                                       |
| Q2  | How is a **loading** or **error** state reached deliberately?                                     | **Playwright route interception**, in `e2e/support/states.ts`, plus one `--force-state` flag on `capture.mjs`.                                                | Zero production code, zero new dependency, and it exercises the real loader rather than a rendered stand-in. A `?__state=` query parameter was the alternative and it puts a test-only branch in 25 route modules permanently. |
| Q3  | How is an **empty** state reached deliberately?                                                   | **A fourth read-only fixture workspace**, minted by the existing `setup` project.                                                                             | `tenant-a`/`tenant-b` are written to by the tests that use them, so neither stays empty. One credential is smaller than a per-surface filter trick that only works where a filter exists.                                      |
| Q4  | Skeleton or spinner as house style — and is the product already inconsistent?                     | **Consistent already.** Skeleton for a region, spinner only inside a control or an inline row. The rule is recorded in the inventory; no code changes for it. | The issue's Out-of-scope clause says to say so and stop if consistent. The scan found `Spinner` in seven modules, all of them controls or inline rows.                                                                         |
| Q5  | Should `ErrorPanel` be moved out of `components/app/accounts`?                                    | **Yes, to `components/app/shell/`, as its own Phase.**                                                                                                        | 32 modules across nine areas import it across a boundary; `docs/SPEC.md` §8 gives a concept one owner. A spec whose job is one consistent error treatment cannot leave it owned by one product area.                           |
| Q6  | Does the empty state join the `.github/a11y/routes.json` gate or the e2e suite?                   | **The e2e suite** (`e2e/states.spec.ts`), with `@axe-core/playwright` at the AA tag set that `e2e/accessibility.spec.ts` already uses.                        | `routes.json` scans with the demo session by construction and its own header refuses to be pinned to a fixture. The e2e suite already runs axe in seven specs.                                                                 |
| Q7  | Do the new frames enter a screenshot-comparison baseline?                                         | **No.** "Baseline" here means a DOM assertion in the e2e suite plus a frame filed outside the repository for a human.                                         | ADR 0016 removed pixel comparison. Frames go to `.ai/qa/artifacts_*/`, never into the repository (`AGENTS.md` → Never).                                                                                                        |
| Q8  | Does the `/transactions/$transactionId` not-found/error conflation belong here or in a new issue? | **Here**, as one step in Phase 3.                                                                                                                             | The issue asks the error half to be reconciled with what #16 landed, and this is precisely that reconciliation. It is two keys and one branch.                                                                                 |

None of these carries `⚠ NEEDS HUMAN CONFIRMATION`: none weakens security, tenant scoping, a money
path, an accessibility claim or a `BACKWARD_COMPATIBILITY.md` surface.

## 📋 Phasing

Each Phase is one `om-auto-create-pr` run, touches one product area's worth of concerns, carries no
migration, and leaves the application working (`docs/SPEC.md` §8).

- **Phase 1 — Inventory.** Documentation only. Ships alone and is useful alone.
- **Phase 2 — One owner for the error panel.** Mechanical move. Ships alone, no behaviour change.
- **Phase 3 — Close the six bare surfaces.** New skeletons, new error components, the not-found
  split. Ships alone; each surface is independently correct.
- **Phase 4 — Reachability, coverage and evidence.** Fixture workspace, interception helper, e2e
  spec, axe scans, the `capture.mjs` flag, and the captured frames as PR evidence.

Phase 2 lands before Phase 3 so that the six new error components import `ErrorPanel` from its final
home and the move is not re-done. Phase 4 lands last because it photographs and asserts what Phase 3
built.

## 📋 Implementation Plan

### Phase 1 — Inventory

1. **Write `docs/rounds/2026-09-09-state-inventory.md`.** The per-surface table above, the four
   readings under it, and the skeleton-versus-spinner rule. State the method — which files were read
   and for which signals — so the next reader can re-run it.
   _Verification:_ every row's claim is traceable to a named file and line; `pnpm check` clean on the
   file.
2. **Link it from `docs/plans/01-design-system.md`** beside that plan's existing note that the
   component gallery has no async surface, so the two statements are read together.
   _Verification:_ `pnpm lint` and the markdown link resolves.

_No repository is touched, so no tenant-isolation case is owed. No amount is touched, so no
money-invariant case is owed._

### Phase 2 — One owner for the error panel

3. **Move `error-panel.tsx`** from `src/components/app/accounts/` to `src/components/app/shell/`,
   export it from the shell barrel, and drop it from the accounts barrel.
   _Verification:_ `pnpm typecheck` fails loudly on every stale import before step 4, and passes
   after.
4. **Update the 32 importers** to `#/components/app/shell`. Import path only — no other edit in
   those files.
   _Verification:_ `pnpm typecheck && pnpm lint && pnpm test`; `git diff` shows only import lines
   outside the two moved files.

_No message key changes. No repository, no amount._

### Phase 3 — Close the six bare surfaces

5. **`/import`** — add `ImportPageSkeleton` to `src/routes/_app/import/-ui/` — there is no
   `components/app/import/` and this area's UI is route-local, so it stays route-local (two source
   cards and a history table, one `role="status"` announcement carrying `import.list.loading`) — wire it as
   `pendingComponent`, and add an `errorComponent` rendering `ErrorPanel` with
   `import.load.error.{title,body}` and a `reset` retry. Keys land in EN + PL.
   _Verification:_ a Vitest render asserting one `status` region and one announced sentence; keys
   present in both catalogues (the i18n parity test).
6. **`/import/$batchId`** — the same, with a batch-shaped skeleton and
   `import.detail.{loading,error.*}`. The existing in-component `FileUnavailable` probe state is left
   alone; this covers the route loader only.
   _Verification:_ as step 5.
7. **`/payees/$payeeId`** — add a payee-detail skeleton beside the list one in
   `src/components/app/payees/payee-states.tsx` and wire it as `pendingComponent`, with
   `payees.detail.loading`. The route's `errorComponent` and `notFoundComponent` already exist and
   are not touched.
   _Verification:_ as step 5.
8. **`/transactions/rules` and `/transactions/rules/$ruleId`** — add `RulesListSkeleton` and
   `RuleEditorSkeleton` to `src/components/app/transactions/`, wire both as `pendingComponent`, with
   `rules.list.loading` and `rules.editor.loading`.
   _Verification:_ as step 5.
9. **`/transactions/rules/new`** — wire `RuleEditorSkeleton` as `pendingComponent` and add an
   `errorComponent` rendering `ErrorPanel` with `rules.editor.error.{title,body}`.
   _Verification:_ as step 5.
10. **Split not-found from error on `/transactions/$transactionId`.** The `detailQuery.isError`
    branch renders `ErrorPanel` with the new `transactions.detail.error.*` keys and a `refetch`
    retry; the not-found copy is reached only through the router's not-found path, as #16 intends.
    _Verification:_ a Vitest case asserting a failing detail query renders the retry and not the
    not-found copy; `e2e/not-found.spec.ts` still passes unchanged, which is what proves the
    not-found path was not disturbed.

_No repository function is added, so no tenant-isolation case is owed. No amount is read or written,
so no money-invariant case is owed. Message keys added, EN + PL, per step._

### Phase 4 — Reachability, coverage and evidence

11. **Add the empty fixture workspace.** An `EMPTY` credential in `e2e/support/session.ts` with the
    read-only contract in its docblock, `storageStateFor('empty')`, and its sign-in inside the
    existing serial `fixture workspaces` setup step.
    _Verification:_ `pnpm exec playwright test --project=setup` mints `e2e/.auth/empty.json`.
12. **Write `e2e/support/states.ts`.** Two helpers over `page.route` on the server-function
    endpoint: `holdResponses(page, pattern)` returning a disposable release, and
    `failResponses(page, pattern)` returning a disposable removal. Each matches one pattern and
    nothing else.
    _Verification:_ a unit test in `e2e/support/__tests__/` asserting the disposable removes the
    handler, next to the existing `console-policy` test.
13. **Write `e2e/states.spec.ts`.** Per list surface: the empty state under the empty workspace, the
    loading state under `holdResponses`, the error state under `failResponses` with its retry
    exercised after the interception is removed. The spec asserts the empty workspace reads zero
    rows before it asserts anything about a screen, and asserts exactly one `role="status"`
    announcement per loading region.
    _Verification:_ `pnpm e2e` green locally and in CI; console policy clean (a red console fails a
    browser run).
14. **Add the axe scan on the empty states** in the same spec, using
    `@axe-core/playwright` with the WCAG A/AA tag set and `withoutKnownAxeDefects` from
    `e2e/support/axe-defects.ts`, matching `e2e/accessibility.spec.ts`.
    _Verification:_ zero violations at the A/AA tags on every empty surface, in both themes and both
    locales.
15. **Add `--force-state <loading|error>` to `scripts/visual/capture.mjs`.** Installs the same two
    interceptions before navigating; refused together with `--enter` for the reason the docblock's
    `--auth`/`--enter` split already gives; composes with the existing `--state` filename prefix.
    _Verification:_ two capture runs against a local dev server produce
    `loading-*` and `error-*` frames whose reported landed URL is the requested one, written outside
    the repository.
16. **Capture the evidence.** Every state, light and dark, 360px and 1280px, into
    `.ai/qa/artifacts_*/` — never into the repository — and attach it to the implementation PR.
    _Verification:_ the frames exist and show the state the filename claims; `git status` clean of
    PNGs.

_Nothing in this Phase ships to a user: it is fixtures, tests and a development script._
