# Designed empty, loading and error states — evidence, gaps and reachability

| Field              | Value |
| ------------------ | ----- |
| **Status**         | ready |
| **Issue**          | #21   |
| **Spec PR**        | #135  |
| **Implementation** | none  |

## 📝 TLDR

The blind comparison round of 2026-09-03 recorded "no designed empty or loading state" against
`/accounts` and declined to score `/budgets` on the same criterion. Reading the route modules says
the empty and error states are designed on almost every surface and the round simply could not reach
them. Measuring the running app says something worse about the third one: **the loading state does
not render at all**. Holding a route's data for five seconds on a real client-side navigation leaves
the previous screen's figures on screen, under a URL and a nav highlight that name a different
screen, with nothing announced to assistive technology. This spec commits that inventory, gives the
suite and the capture harness a way to reach each state deliberately, closes seven route modules
that are bare, and gates the loading half on one architectural question a human has to answer.

## 📝 Problem Statement

`docs/agents/reference.md` names **state completeness** — "designed empty, loading and error states"
— as one of the six things a comparison round judges, "because a finance app is full of screens a
new user sees with nothing in them". `docs/rounds/2026-09-03-blind-comparison.md` §5 reported it as
a defect:

> Named explicitly on accounts, and noted on budgets as absent from both products.

Issue #21 reads that correctly as **a floor, not a ceiling**: the round photographs the seeded demo
workspace — five accounts, three currencies, ~600 transactions — where an empty list is unreachable,
a loading frame is gone before the shutter, and an error frame needs the server to fail. What the
round establishes is "we have no evidence these states exist", not "they do not exist".

Separating the evidence question from the design question is what the inventory is for, and the two
have **different answers**.

### 1. Read: what the route modules declare

Every route module under `src/routes/_app`, plus `src/routes/invite.$invitationId.tsx`, was read for
four signals: a `loader`, a `pendingComponent`, an `errorComponent`, and a designed branch for an
empty data set. Client-query surfaces were read for the equivalent `isPending` / `isError` branches.

| Surface                        | Loading declared                                   | Error declared                            | Empty designed                           |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| `/dashboard`                   | ✅ `pendingComponent`                              | ✅ `errorComponent`                       | ✅ per widget                            |
| `/accounts`                    | ✅ `AccountListSkeleton`                           | ✅ `ErrorPanel` + retry                   | ✅ `AccountEmptyState` + `FilteredEmpty` |
| `/accounts/$accountId`         | ✅                                                 | ✅                                        | n/a (detail)                             |
| `/transactions`                | ✅ in `TransactionsScreen` (`pageQuery.isPending`) | ✅ in `TransactionsScreen`                | ✅ `TransactionsEmpty`                   |
| `/transactions/planned`        | ✅ via `TransactionsScreen`                        | ✅ via `TransactionsScreen`               | ✅ own `EmptyState`                      |
| `/transactions/groups`         | ✅                                                 | ✅                                        | ✅                                       |
| `/transactions/new`            | ✅ `TransactionFormSkeleton`                       | ✅ `TransactionListError`                 | ✅ `noAccounts` precondition             |
| `/transactions/$transactionId` | ✅ `TransactionFormSkeleton`                       | ⚠️ any query error renders not-found copy | n/a (detail)                             |
| `/transactions/rules`          | ❌ **none**                                        | ✅ `RulesListError`                       | ✅                                       |
| `/transactions/rules/$ruleId`  | ❌ **none**                                        | ✅                                        | n/a (detail)                             |
| `/transactions/rules/new`      | ❌ **none**                                        | ❌ **none**                               | n/a (form)                               |
| `/budgets`                     | ✅ `BudgetListSkeleton`                            | ✅ `BudgetsListError`                     | ✅                                       |
| `/budgets/$budgetId`           | ✅                                                 | ✅                                        | ✅ (empty period)                        |
| `/categories`                  | ✅                                                 | ✅                                        | ✅                                       |
| `/goals`                       | ✅                                                 | ✅                                        | ✅ `GoalEmptyState`                      |
| `/goals/$goalId`               | ✅                                                 | ✅                                        | n/a (detail)                             |
| `/payees`                      | ✅                                                 | ✅                                        | ✅                                       |
| `/payees/$payeeId`             | ❌ **none**                                        | ✅ `PayeeDetailError`                     | n/a (detail)                             |
| `/recurring`                   | ✅                                                 | ✅                                        | ✅ `RecurringEmptyState`                 |
| `/recurring/$seriesId`         | ✅                                                 | ✅                                        | n/a (detail)                             |
| `/recurring/candidates`        | ✅                                                 | ✅                                        | ✅                                       |
| `/import`                      | ❌ **none**                                        | ❌ **none**                               | ✅ `import.history.empty.*`              |
| `/import/$batchId`             | ❌ **none** for the loader                         | ❌ **none**                               | ✅                                       |
| `/settings`                    | n/a — no loader, no query, nothing async           | n/a                                       | n/a                                      |
| `/settings/members`            | ✅                                                 | ✅                                        | ✅                                       |
| `/settings/billing`            | ✅                                                 | ✅                                        | ✅                                       |
| `/invite/$invitationId`        | ❌ **none**                                        | ✅ `InvitationMissing`                    | n/a (single row)                         |

Twenty-seven rows. `/settings` is genuinely async-free, so the denominator for "declares a loading
state" is twenty-six, and **nineteen of twenty-six** declare one.

**Seven** route modules declare none: `/transactions/rules`, `/transactions/rules/$ruleId`,
`/transactions/rules/new`, `/payees/$payeeId`, `/import`, `/import/$batchId` and
`/invite/$invitationId`. Three of those also declare no error state. `/invite/$invitationId` is in
this list on purpose: the round's criterion is about "screens a new user meets", and an invitation
link is literally the first screen a new member sees.

Two corrections to what a fast read suggests. `/payees/$payeeId` has **no** `notFoundComponent` of
its own — it throws the router's not-found sentinel and the **root's** `notFoundComponent`
(`src/routes/__root.tsx`) renders it. And `/transactions/$transactionId` renders
`transactions.detail.notFound.*` for _any_ detail query failure; before #16 that was defensible
because a missing row and a broken read were indistinguishable, but #16 shipped (`#64`, merged
`723e991`) and `src/server/fns/not-found.ts` now separates them, so the conflation tells a reader
their transaction does not exist when the read merely failed.

### 2. Measured: what the running app actually renders

Reading the modules is not evidence. The app was booted (`.ai/scripts/test-env-up.sh`,
`http://127.0.0.1:3012`, seeded demo workspace) and driven with Playwright. Three findings, each
from a run whose output was read.

**The empty state is designed and reachable — the round just never signed in as anyone who had
one.** Signing in as the `tenant-b` fixture workspace (a real workspace with no rows) and opening
`/accounts` renders `AccountEmptyState` in full: a heading "No accounts yet", a sentence explaining
what an account is for, a primary "Add your first account", and three quick-start cards. Light and
dark both. The round's finding against `/accounts` is therefore a **reachability** finding, and the
same is true of `/budgets`.

**The data endpoint is `/_serverFn/*`, and it is only reachable on a client-side navigation.**
Navigating through the shell rail produces exactly two requests, both `document`: `GET /accounts`
and `GET /accounts?status=active`. No data fetch at all — the loaders run server-side during SSR.
Navigating through the dashboard's `WidgetLink` instead produces `GET /_serverFn/<base64>` fetches
and no document request. The reason is already documented in the codebase:
`src/components/app/dashboard/widget-link.tsx` states that the design system's `Link` routes through
React Aria's `RouterProvider`, that **no `RouterProvider` is mounted in this app**, and that a `ui`
link therefore does a full document load. The shell rail uses the design-system `Link`; `WidgetLink`
uses TanStack Router's. So the whole primary navigation of the product is a document reload, and no
route's `pendingComponent` can render on it.

**On a genuine client-side navigation, the loading state still does not render.** Holding every
`/_serverFn/*` response open and taking the dashboard's "All your spending" link, then sampling at
1.5 s, 3 s and 5 s:

| t     | URL             | `h1`          | `role="status"` regions | skeleton bars |
| ----- | --------------- | ------------- | ----------------------- | ------------- |
| 1.5 s | `/transactions` | `"Dashboard"` | 0                       | 0             |
| 3 s   | `/transactions` | `"Dashboard"` | 0                       | 0             |
| 5 s   | `/transactions` | `"Dashboard"` | 0                       | 0             |

Releasing the hold snaps `h1` to `"Transactions"`.

For five seconds the reader is shown **the previous screen's financial figures**, under a URL and a
highlighted rail item naming a different screen, with **nothing announced** to a screen reader. In a
product about money that is worse than a blank hold: the numbers on screen are real, they are
stale, and nothing says so. `src/router.tsx` configures `defaultPreload`, `defaultPreloadStaleTime`
and `defaultErrorComponent`, and sets **no** `defaultPendingMs`, `defaultPendingMinMs` or
`defaultPendingComponent`.

This is the finding the round was circling and could not name. It is also why "add a
`pendingComponent` to seven route modules" is, on its own, worth very little: nineteen surfaces
already declare one and it does not render either.

### 3. The house style is already consistent

`Spinner` is imported by six modules outside `components/ui`, plus the `Button` primitive itself —
`transaction-list`, three dialogs, the import preview and the import batch screen. Every one is a
control or an inline row. Nowhere does a spinner stand in for a page or region load; skeletons do
that. The issue's Out-of-scope clause therefore resolves to **"say so and stop"**, and the rule is
written down in the inventory rather than re-derived by the next author.

### 4. One finding outside this issue's scope

`ErrorPanel` — the retryable failure panel every surface uses — lives at
`src/components/app/accounts/error-panel.tsx` and is imported by **37 modules outside
`components/app/accounts`**, spanning budgets, categories, dashboard, goals, payees, recurring,
settings, transactions and rules. `docs/SPEC.md` §8 gives a concept exactly one owner, and the error
treatment this issue wants made consistent is owned by one product area that everyone else reaches
into.

It is **not** fixed here. It is a 37-file mechanical move with no behaviour change and no dependency
on anything below; bundling it would make this spec two capabilities. Phase 1 records it and files
it as its own issue.

## 📝 Proposed Solution

1. **Commit the inventory** as `docs/STATE-INVENTORY.md` — the read, the measurements, the
   house-style rule, and the reachability verdict. This is the issue's stated first deliverable and
   it is what makes everything after it small. File the `ErrorPanel` ownership issue from it.
2. **Answer the pending-machinery question** (below) — it decides whether the loading work is a
   seven-route patch or a router-level change, and it is the one thing here a human has to decide.
3. **Close the seven bare route modules**, and split not-found from error on
   `/transactions/$transactionId`.
4. **Make each state reachable deliberately**, then assert and photograph it:
   - **empty** — a fifth fixture workspace, seeded with nothing and written to by nothing;
   - **loading** and **error** — Playwright interception of `/_serverFn/*` **on a client-side
     navigation**, which the measurements above show is the only navigation that produces one;
   - the same interception behind one `capture.mjs` flag, which for the same reason has to drive a
     client-side navigation rather than `page.goto`.

### The one question a human has to answer

⚠ **NEEDS HUMAN CONFIRMATION.** The measurements say the loading state is not primarily missing
because seven routes lack a `pendingComponent`; it is missing because the router shows the previous
route's content indefinitely while a load is in flight, and because the product's primary navigation
is not client-side at all. There are two ways to read that, and they are different amounts of work:

- **(a) Treat it as configuration.** Set `defaultPendingMs` / `defaultPendingMinMs` (and possibly a
  `defaultPendingComponent`) on `src/router.tsx` so the declared `pendingComponent`s engage. Small,
  reversible, and it makes the nineteen existing skeletons worth something.
- **(b) Treat it as architecture.** The rail does a document load because no React Aria
  `RouterProvider` is mounted (`widget-link.tsx` names this and says "when that provider lands, this
  file is the one place that has to change"). Mounting it makes every design-system `Link` a
  client-side navigation — which is what makes a loading state reachable in normal use at all, and
  which changes navigation, focus and scroll behaviour across the whole product.

This spec **assumes (a)** and scopes (b) out, because (a) is the smaller, more reversible half and
(b) is an architectural decision that deserves its own ADR (`AGENTS.md` → Ask First). But (a) alone
means the loading state remains invisible on the navigation path most readers use, which is a real
limit on what this work delivers and is why the PR carrying this spec stays a draft until someone
confirms the split.

### Why not the alternatives

**A dev-only query parameter the loader honours (`?__state=loading`).** Rejected. It puts a
test-only branch in production route code on every surface forever, and it proves a branch renders
rather than proving the real loading path renders. Interception adds no production code.

**An `MSW`-style mock layer.** Rejected on `docs/SPEC.md` §3 — a new dependency for something
`page.route` already does.

**A `defaultPendingComponent` as the whole answer.** `RoutePending` draws a title, four figure cards
and six list rows. That shape is right for `/accounts` and wrong for `/import`, whose page is two
upload cards and a history table; a default that is the wrong shape everywhere reintroduces the jump
the skeleton exists to prevent. It is a reasonable _floor_ under option (a), never the per-surface
answer.

**Screenshot diffing.** Refused: ADR 0016 removed pixel comparison from this repository. A baseline
here is a DOM assertion plus a frame filed outside the repo for a human.

## 📝 Architecture

### Owner modules (`docs/SPEC.md` §8)

| Concept                       | Owner module                                  | Status                                   |
| ----------------------------- | --------------------------------------------- | ---------------------------------------- |
| The empty state               | `src/components/ui/empty-state.tsx`           | exists, unchanged                        |
| The loading placeholder       | `src/components/ui/skeleton.tsx`              | exists, unchanged                        |
| The retryable failure panel   | `src/components/app/accounts/error-panel.tsx` | exists; ownership filed as its own issue |
| The route-level pending shell | `src/components/app/shell/route-pending.tsx`  | exists, unchanged                        |
| The not-found sentinel        | `src/server/fns/not-found.ts` → `__root.tsx`  | exists (#16), unchanged                  |
| Router pending thresholds     | `src/router.tsx`                              | **new configuration**                    |
| The empty fixture workspace   | `e2e/support/session.ts`                      | one new credential                       |
| Deliberate state reach        | `e2e/support/states.ts` — **new**             | new                                      |
| Capture-side state reach      | `scripts/visual/capture.mjs`                  | one new flag                             |

Per-surface skeletons stay with the area whose layout they draw
(`src/components/app/<area>/`, or the route's own `-ui/` directory where the area has no
`components/app` module — `/import` and `/invite` are route-local). Only the primitive is shared.

`docs/SPEC.md` §6.1 is untouched throughout: no SQL is written or moved, no server function changes
shape, and `components/ui` still neither fetches nor imports from `server/`. No amount is read,
formatted, summed or converted anywhere in this work, so `docs/MONEY.md` has no section to cite.

### How each state is reached deliberately

**Empty is a data condition**, reached with data: a workspace with no rows. A fifth credential joins
`DEMO`, `TENANT_A` and `TENANT_B` in `e2e/support/session.ts`, minted once by the `setup` project
and **read-only by contract** — no spec writes to it, which is why it is not a reuse of `tenant-b`,
whose docblock says each test creates its own rows inside it. Nothing in `src/` changes. Proven to
work: signing in as `tenant-b` already renders `/accounts`'s full empty state.

**Loading is a timing condition**, reached by holding `/_serverFn/*` open — and **only on a
client-side navigation**. `e2e/support/states.ts` exports `holdServerFns(page)` returning a
disposable release. Two constraints the measurements force, and which every caller must respect:

- the test must already be on a hydrated page and must navigate through a **TanStack Router `Link`**
  or `navigate()`. A `page.goto`, or a click on the shell rail, is a document navigation and
  produces no `/_serverFn/*` request to hold;
- release the hold **before** `unroute`. Unrouting while a handler is suspended makes Playwright
  throw `Route is already handled!` when the handler resumes — observed, not theorised.

**Error is a response condition**, reached with `failServerFns(page)`, fulfilling `500`. Note
`src/router.tsx` sets `retry: 1` on the query client, so one failure is **two** requests; the
handler must survive being called twice, and a hold released after one request will be re-entered by
the retry.

`scripts/visual/capture.mjs` gets one flag, `--force-state <loading|error>`, which for the same
reason cannot be a `page.goto`: it navigates to a stated origin route, installs the interception,
then drives a client-side navigation to the target. It composes with the existing `--state` filename
prefix, so an error run writes `error-1440x900-light-A.png` and cannot overwrite the at-rest frame.
The script is a development tool and never touches the shipped bundle.

### Accessibility

`docs/ACCESSIBILITY.md` §5.1 is the gate and this spec does not widen it — AA, same axe rules, no
waiver. An empty state is a screen like any other. Two properties the primitives already provide and
the new work must preserve: an empty state's title is a **real heading** at the level that keeps the
page outline correct, and a loading region announces itself **once** in a `role="status"` element
with `aria-busy` on the container and `aria-hidden` on every bar. The measurement above — zero
`role="status"` regions for five seconds — is the current state of that second property.

The axe scan of the empty states runs in the **e2e suite** (`e2e/states.spec.ts`), where
`e2e/accessibility.spec.ts` and `e2e/support/budgets.ts` already run `AxeBuilder`. It does not join
`.github/a11y/routes.json`: that gate signs in as the demo account by construction, and its `access`
field has three values (`public`, `form`, `session`) whose header explicitly refuses to be pinned to
a fixture.

## 📝 Data Model and API contracts

None. No table, column, index or migration, so `pnpm db:generate` is a no-op here. No server
function added, removed or re-shaped; no route search parameter changed; no envelope changed. No
`BACKWARD_COMPATIBILITY.md` surface is touched.

## 📝 UI/UX

### The three states, stated once

- **Empty** — says what the screen is _for_ and offers the one action that fills it. Never "No
  data". `accounts.empty.*` and `import.history.empty.*` are the models.
- **Loading** — holds the layout that is coming, with its blocks where the real content will sit, so
  nothing jumps when it is replaced. One announced sentence, never eleven announced rectangles.
- **Error** — says what did not load, says whether anything was changed, offers a retry that
  retries. The raw message stays behind a closed disclosure. This is `ErrorPanel`'s documented
  contract; it does not change.

### The house-style rule the inventory writes down

> A region that is loading draws a **skeleton** of the layout it is about to show. A **spinner**
> appears only inside a control that is working, or on an inline row awaiting one value. A spinner
> never stands in for a page or a region load.

A description of what nineteen of twenty-six surfaces already do, promoted to a rule so the seven
being fixed do not each invent an answer.

### Not-found is not an error

Post-#16 a detail screen has three outcomes and owes three renderings: the row (content), the row is
gone (`notFound()` → the root's `notFoundComponent`), the read broke (`ErrorPanel` with a retry).
`/transactions/$transactionId` collapses the last two into the first's copy and is corrected here.

## 📝 Visual change expected

Light and dark, 360px and 1280px. Nothing below is a redesign of a screen that already renders.

| Route                          | State   | What changes on screen                                                                                           |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `/import`                      | loading | New: an import-shaped skeleton (two source cards, a history table).                                              |
| `/import`                      | error   | New: `ErrorPanel` + retry, in place of the generic shell failure.                                                |
| `/import/$batchId`             | loading | New: a batch-shaped skeleton (header, progress, row table).                                                      |
| `/import/$batchId`             | error   | New: `ErrorPanel` + retry.                                                                                       |
| `/payees/$payeeId`             | loading | New: a payee-detail skeleton (header, totals, transaction rows).                                                 |
| `/transactions/rules`          | loading | New: a rules-list skeleton (ordered rows).                                                                       |
| `/transactions/rules/$ruleId`  | loading | New: a rule-editor skeleton.                                                                                     |
| `/transactions/rules/new`      | loading | New: the same rule-editor skeleton.                                                                              |
| `/transactions/rules/new`      | error   | New: `ErrorPanel` + retry.                                                                                       |
| `/invite/$invitationId`        | loading | New: an invitation-card skeleton.                                                                                |
| `/transactions/$transactionId` | error   | Changed: `ErrorPanel` + retry, where not-found copy was shown for a read failure.                                |
| every surface                  | loading | Changed under option (a): a skeleton appears where the previous screen's content used to sit for the whole load. |
| every surface                  | empty   | Unchanged code, **newly photographed** — the frames the round could not take.                                    |

## 📝 Copy

Every key lands in `src/lib/i18n/messages/en.ts` **and** `src/lib/i18n/messages/pl.ts` in the same
change (`i18n-messages`; `docs/SPEC.md` §9). Naming follows the established
`<area>.list.loading` / `<area>.<surface>.error.{title,body}` shape already used by
`accounts.list.loading`, `budgets.list.loading`, `rules.error.*` and `payees.detail.error.*`.

`import.error.*` is unavailable: those twelve keys are the per-row import parse errors
(`import.error.date_empty` … `import.error.amount_zero`). The page-level failure uses
`import.load.error.*`.

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
| `invite.loading`                  | Loading this invitation…                                             |
| `transactions.detail.error.title` | This transaction could not be loaded                                 |
| `transactions.detail.error.body`  | Nothing was changed. Try again in a moment.                          |

`transactions.detail.notFound.*` keeps its current job — the row is gone. No existing key is removed
or re-worded, so no stored row referencing a key is affected (`docs/SPEC.md` §9).

## 📝 Edge Cases & Failure Scenarios

- **A deliberate `500` trips the console policy.** `e2e/support/console-policy.ts` says the
  tolerated list "is never the shape a hydration mismatch, a missing key or a 500 arrives in", and
  `e2e/support/console.ts` treats every `pageerror` as fatal. A spec that answers `500` on purpose
  is red by construction. `e2e/states.spec.ts` therefore needs an explicit, narrowly scoped opt-out
  for the error cases it authors — and the policy file is where that decision is recorded and
  justified, not somewhere the spec quietly widens. If it cannot be scoped narrowly, the error half
  asserts through the route's `errorComponent` in a component test instead and the browser run keeps
  the policy intact. **This is the first thing Phase 3 has to settle**, because it decides whether
  step 13 is writable at all.
- **`retry: 1` doubles every failure.** One intercepted `500` produces two requests. A `failServerFns`
  handler must be idempotent; a `holdServerFns` release must survive being re-entered.
- **`unroute` while a handler is suspended throws.** `Route is already handled!` — observed during
  the probe. Release first, then unroute, and swallow the resume error when the context is gone.
- **The interception leaks into a later navigation.** Both helpers return a disposable and every
  caller releases in a `finally`; each matches `**/_serverFn/**` and nothing else.
- **The empty fixture workspace stops being empty.** The credential's docblock states the read-only
  contract, and `e2e/states.spec.ts` asserts the workspace reads zero accounts and zero transactions
  before it asserts anything about a screen.
- **The sign-up rate limit.** `e2e/auth.setup.ts` records that `/sign-up/email` allows five attempts
  per five minutes, shared with the real sign-up in `core-flow.spec.ts`, which is why `TENANT_A` and
  `TENANT_B` are provisioned in one serial step. A fifth workspace makes that three sign-ups in the
  step plus one in `core-flow` on a cold run. The step must keep them serial and the spec must
  tolerate a `429` as a retry rather than report it as a product failure.
- **`e2e/support/states.ts` imports Playwright.** `vitest.config.ts` justifies keeping
  `e2e/support/__tests__/*.test.ts` in the node project on the grounds that "the modules it matches
  import no Playwright". A helper over `Page` and `Route` breaks that premise. Either the helper's
  unit test stubs the Playwright surface and stays out of the node project's import graph, or it is
  covered by the browser run alone and no unit test is written. Decide it in Phase 4, do not let the
  first implementer discover it.
- **A new skeleton announces itself twice.** Two `role="status"` regions on one screen read two
  sentences for one load. Each new skeleton carries exactly one announcement, at the level that owns
  the load, and the e2e assertion counts it.

## 📝 Risks & Impact Review

**Blast radius.** Small and additive: seven route modules gain one or two properties each, one route
module changes which copy one branch renders, `src/router.tsx` gains pending thresholds under option
(a), and the rest is fixtures, tests and a development script. The 37-file `ErrorPanel` move — the
one genuinely wide edit the inventory found — is deliberately not in this spec.

**What could regress.** Two things. A mis-shaped skeleton makes a page jump when content lands,
which is worse than the hold it replaced; each skeleton is therefore drawn from the layout of the
screen it fronts and gets a frame in both themes at both widths. And setting `defaultPendingMs`
changes what _every_ existing surface does during a load — nineteen skeletons that never rendered
start rendering. That is the intended effect and it is also the largest behavioural change here, so
it lands in its own step with its own frames.

**Compatibility and the accessibility claim.** Neither changes. No protected surface, no schema, no
server function signature, no removed key; AA on more surfaces is the existing gate applied wider,
and nothing here claims AAA.

**Rollback.** Per Phase, each a single revert. Phase 1 is a document. Phase 2 is one line of router
configuration. Phase 3 removes route properties and restores one branch's copy. Phase 4 removes
test and script code and one fixture credential.

**Cost.** `e2e/states.spec.ts` runs under all three browser projects in `playwright.config.ts`
(`chromium`, `mobile-safari`, `webkit`), and the axe step adds two themes and two locales, so one
spec file is 3 × 2 × 2 executions per surface. Budget it — or scope the axe matrix to `chromium`
the way `accessibility.spec.ts` reasons about its own axes. `pnpm e2e` is not in the validation
gate; CI runs it per PR.

## 📝 Resolved assumptions (autonomous defaults)

Written by `om-auto-write-spec` in `--autonomous` mode. Each was resolved toward the smallest, most
reversible option and can be overridden on the PR before implementation starts.

| #   | Question                                                                        | Resolution                                                                                                        | Why                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Does this bundle more than one independently deployable capability?             | **The `ErrorPanel` ownership move is split out** to its own issue. What remains is one arc in four Phases.        | The mandatory split check. The move has no dependency on anything here and the issue did not ask for it; the rest does not stand up without the inventory.     |
| Q2  | Is the pending machinery a configuration fix or an architectural one?           | **⚠ NEEDS HUMAN CONFIRMATION.** Assume (a) configuration; scope the `RouterProvider` question out to its own ADR. | (a) is smaller and reversible, but it leaves the loading state invisible on the rail — the navigation most readers use. That trade is not the agent's to make. |
| Q3  | How is an **empty** state reached deliberately?                                 | **A fifth read-only fixture workspace**, minted by the existing `setup` project.                                  | `tenant-a`/`tenant-b` are written to by the specs that use them. One credential beats a per-surface filter trick that only works where a filter exists.        |
| Q4  | Skeleton or spinner — is the product already inconsistent?                      | **Consistent.** The rule is recorded in the inventory; no code changes for it.                                    | The issue's Out-of-scope clause says to say so and stop. Six `Spinner` modules outside the primitive, all controls or inline rows.                             |
| Q5  | Does the `/transactions/$transactionId` not-found/error conflation belong here? | **Here**, one step in Phase 3.                                                                                    | The issue asks the error half to be reconciled with what #16 landed, and this is exactly that. Two keys and one branch.                                        |
| Q6  | Does the empty state join the `.github/a11y` gate or the e2e suite?             | **The e2e suite** (`e2e/states.spec.ts`), at the AA tag set `e2e/accessibility.spec.ts` uses.                     | The gate signs in as demo by construction and its header refuses fixture pinning.                                                                              |
| Q7  | Where does the inventory live?                                                  | **`docs/STATE-INVENTORY.md`**, linked from `docs/plans/01-design-system.md`.                                      | `docs/rounds/` holds comparison rounds; an inventory of our own routes is a different genus.                                                                   |

Q2 carries the `⚠` marker, so **the PR carrying this spec opens as a draft** and merge is gated on
someone confirming the configuration-versus-architecture split. Nothing else here weakens security,
tenant scoping, a money path, an accessibility claim or a `BACKWARD_COMPATIBILITY.md` surface.

## 📋 Phasing

Each Phase is one `om-auto-create-pr` run, no migration, and leaves the application working
(`docs/SPEC.md` §8).

- **Phase 1 — Inventory.** Documentation, plus the `ErrorPanel` follow-up issue. Useful alone.
- **Phase 2 — Pending thresholds.** One router change, gated on the Q2 answer. Makes the nineteen
  existing skeletons render.
- **Phase 3 — Close the seven bare surfaces.** New skeletons, new error components, the not-found
  split. Each surface is independently correct.
- **Phase 4 — Reachability, coverage and evidence.** Fixture workspace, interception helper, e2e
  spec, axe scans, the `capture.mjs` flag, captured frames as PR evidence.

Phase 2 lands before Phase 3 so a new skeleton is verifiable the moment it is written. Phase 4 lands
last because it asserts and photographs what 2 and 3 built.

## 📋 Implementation Plan

A note on verification that every step below obeys. `vitest.config.ts` runs `src/components/**` and
`src/lib/**` in the `ui` project (jsdom + React) and `src/routes/**` in the `server` project (node,
no React plugin, `*.test.ts` only — **not** `.tsx`). A component that must be render-tested
therefore lives under `src/components/app/<area>/`; one that stays route-local is verified in the
browser run instead. Steps say which.

### Phase 1 — Inventory

1. **Write `docs/STATE-INVENTORY.md`.** The read table with a file path per row, the three
   measurements with the commands that produced them, and the skeleton-versus-spinner rule. State
   the method so the next reader can re-run it.
   _Verification:_ each row names the file it was read from; `pnpm check` clean. (A reviewer reads
   it — this is a review gate, not an automated one, and says so.)
2. **Link it from `docs/plans/01-design-system.md`**, beside that plan's note that the component
   gallery has no async surface.
   _Verification:_ `pnpm lint`; the link resolves.
3. **File the `ErrorPanel` ownership issue** — move to `src/components/app/shell/`, 37 importers,
   `docs/SPEC.md` §8 as the rationale, no behaviour change.
   _Verification:_ the issue exists and is linked from the inventory.

### Phase 2 — Pending thresholds (gated on Q2)

4. **Set `defaultPendingMs` and `defaultPendingMinMs` on `src/router.tsx`**, with a docblock giving
   the numbers and the reason, in the register the file's existing comments use.
   _Verification:_ an e2e case holding `/_serverFn/*` on a client-side navigation asserts a
   `role="status"` region appears within the threshold, and that `h1` is no longer the previous
   route's — the exact measurement this spec recorded as failing, inverted into a test.
5. **Re-photograph three existing surfaces** (`/accounts`, `/budgets`, `/goals`) in the loading
   state to confirm the nineteen declared skeletons now render and the layout does not jump.
   _Verification:_ frames in `.ai/qa/artifacts_*/`, read by a human; no console output outside
   policy.

### Phase 3 — Close the seven bare surfaces

6. **Settle the console-policy question first** (see Edge Cases): decide how a deliberate `500` is
   tolerated, record it in `e2e/support/console-policy.ts` with its justification, or decide the
   error half is asserted outside the browser run.
   _Verification:_ `e2e/support/__tests__/console-policy.test.ts` covers the new case.
7. **`/import`** — `ImportPageSkeleton` in `src/routes/_app/import/-ui/` (two source cards, a
   history table, one `role="status"` carrying `import.list.loading`) as `pendingComponent`, plus an
   `errorComponent` rendering `ErrorPanel` with `import.load.error.{title,body}` and a `reset`
   retry. Keys in EN + PL.
   _Verification:_ route-local, so the browser run: an e2e case holding `/_serverFn/*` asserts one
   `status` region and the announced sentence; the i18n parity test covers the keys.
8. **`/import/$batchId`** — the same, batch-shaped, with `import.detail.{loading,error.*}`. The
   existing in-component `FileUnavailable` probe state is not touched.
   _Verification:_ as step 7.
9. **`/invite/$invitationId`** — an invitation-card skeleton as `pendingComponent` with
   `invite.loading`. The existing `InvitationMissing` error component is not touched.
   _Verification:_ as step 7.
10. **`/payees/$payeeId`** — a detail skeleton beside the list one in
    `src/components/app/payees/payee-states.tsx`, wired as `pendingComponent` with
    `payees.detail.loading`.
    _Verification:_ a Vitest render in `src/components/app/payees/__tests__/` asserting one `status`
    region and one announced sentence.
11. **`/transactions/rules`, `/transactions/rules/$ruleId`, `/transactions/rules/new`** —
    `RulesListSkeleton` and `RuleEditorSkeleton` in `src/components/app/transactions/`, wired as
    `pendingComponent` on all three, with `rules.list.loading` and `rules.editor.loading`; plus an
    `errorComponent` on `new` with `rules.editor.error.{title,body}`.
    _Verification:_ a Vitest render in `src/components/app/transactions/__tests__/`.
12. **Split not-found from error on `/transactions/$transactionId`.** The `detailQuery.isError`
    branch renders `ErrorPanel` with `transactions.detail.error.*` and a `refetch` retry; the
    not-found copy is reached only through the router's not-found path.
    _Verification:_ the branch is route-local, so an e2e case under `failServerFns` asserts the
    retry is present and the not-found copy is not; `e2e/not-found.spec.ts` passes unchanged, which
    is what proves the not-found path was not disturbed.

_No repository function is added, so no tenant-isolation case is owed. No amount is read or written,
so no money-invariant case is owed. Message keys land EN + PL per step._

### Phase 4 — Reachability, coverage and evidence

13. **Add the empty fixture workspace.** An `EMPTY` credential in `e2e/support/session.ts` with the
    read-only contract in its docblock, `storageStateFor('empty')`, and its sign-in inside the
    existing serial `fixture workspaces` step, tolerating a `429` as a retry (see Edge Cases).
    _Verification:_ `pnpm exec playwright test --project=setup` mints `e2e/.auth/empty.json` on a
    cold run and on a warm one.
14. **Write `e2e/support/states.ts`** — `holdServerFns(page)` and `failServerFns(page)` over
    `**/_serverFn/**`, each returning a disposable, each idempotent under `retry: 1`, releasing
    before unrouting. Settle the Playwright-import question from the Edge Cases here.
    _Verification:_ whichever the settled answer allows — a stubbed unit test beside
    `e2e/support/__tests__/console-policy.test.ts`, or the browser run alone with the gap stated.
15. **Write `e2e/states.spec.ts`.** Per surface: the empty state under the empty workspace; the
    loading state under `holdServerFns` reached by a **client-side** navigation; the error state
    under `failServerFns` with the retry exercised after the interception is removed. Assert the
    workspace reads zero rows before asserting any screen, and exactly one `role="status"` per
    loading region.
    _Verification:_ `pnpm e2e` green locally and in CI, under the console policy as settled in step 6.
16. **Axe-scan the empty states** in the same spec, with the WCAG A/AA tag set and
    `withoutKnownAxeDefects`, matching `e2e/accessibility.spec.ts`. Scope the matrix explicitly and
    say why.
    _Verification:_ zero violations at the A/AA tags on every empty surface across the stated
    matrix.
17. **Add `--force-state <loading|error>` to `scripts/visual/capture.mjs`.** It navigates to an
    origin route, installs the interception, then drives a **client-side** navigation to the target
    — `page.goto` produces no `/_serverFn/*` request, as measured. Composes with `--state`.
    _Verification:_ two runs against a local dev server produce `loading-*` and `error-*` frames
    whose reported landed URL is the requested one, written outside the repository.
18. **Capture the evidence.** Every state, light and dark, 360px and 1280px, into
    `.ai/qa/artifacts_*/` — never into the repository — attached to the implementation PR.
    _Verification:_ a human reads the frames and confirms each shows the state its filename claims;
    `git status` clean of PNGs.

_Nothing in this Phase ships to a user: fixtures, tests and a development script._
