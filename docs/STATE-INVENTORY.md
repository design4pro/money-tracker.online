# State inventory — empty, loading and error, per surface

What every route module in this product declares for the three states a reader meets when a screen
has nothing in it, is fetching, or failed. Written for issue #21, from the design in
`.ai/specs/2026-09-09-designed-empty-loading-error-states.md`.

`docs/agents/reference.md` names **state completeness** as one of the six things a comparison round
judges. The round of 2026-09-03 (`docs/rounds/2026-09-03-blind-comparison.md` §5) recorded "no
designed empty or loading state" against `/accounts` and declined to score `/budgets` on the same
criterion. That round photographs the seeded demo workspace, where an empty list is unreachable and
a loading frame is gone before the shutter, so what it established was **"we have no evidence these
states exist"**, not "they do not exist".

This document separates the two questions. They have different answers: the empty and error states
are designed on almost every surface and the round could not reach them, while the loading state
was declared on nineteen surfaces and **rendered on none**.

## 1. Method

Anyone can re-run every claim below. The three commands that produced this document:

```bash
# Which route modules declare which route-level options.
for f in $(find src/routes -name '*.tsx' | sort); do
  echo "$f | loader=$(grep -c 'loader:' "$f") pending=$(grep -c 'pendingComponent' "$f")" \
       "error=$(grep -c 'errorComponent' "$f") notFound=$(grep -c 'notFoundComponent' "$f")"
done

# Which modules reach for the spinner primitive, and which for the failure panel.
grep -rl "Spinner" src | sort
grep -rl "ErrorPanel" src | grep -v "components/app/accounts" | wc -l
```

A route-level option is not the whole story: four transaction surfaces hold their state branches
inside the component, on a TanStack Query result, rather than in `createFileRoute`. Those rows were
read by hand and the file and line are named.

The measurements in §3 came from the probe run recorded in the spec: the app booted with
`.ai/scripts/test-env-up.sh` on `http://127.0.0.1:3012` against the seeded demo workspace, driven
with Playwright.

## 2. Read: what the route modules declare

Twenty-seven surfaces. `/settings` is genuinely async-free — no loader, no query, nothing to wait
for — so the denominator for "declares a loading state" is **twenty-six**, and **nineteen of
twenty-six** declare one.

| Surface                        | File                                              | Loading declared                                           | Error declared                                     | Empty designed                               |
| ------------------------------ | ------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| `/dashboard`                   | `src/routes/_app/dashboard/index.tsx`             | ✅ `pendingComponent`                                      | ✅ `errorComponent`                                | ✅ per widget                                |
| `/accounts`                    | `src/routes/_app/accounts/index.tsx`              | ✅ `AccountListSkeleton`                                   | ✅ `ErrorPanel` + retry                            | ✅ `AccountEmptyState` + `FilteredEmpty`     |
| `/accounts/$accountId`         | `src/routes/_app/accounts/$accountId.tsx`         | ✅                                                         | ✅                                                 | n/a (detail)                                 |
| `/transactions`                | `src/routes/_app/transactions/index.tsx`          | ✅ in `TransactionsScreen` (`transactions-screen.tsx:301`) | ✅ `transactions-screen.tsx:304`                   | ✅ `TransactionsEmpty` (`index.tsx:77`)      |
| `/transactions/planned`        | `src/routes/_app/transactions/planned.tsx`        | ✅ via `TransactionsScreen`                                | ✅ via `TransactionsScreen`                        | ✅ own `EmptyState` (`planned.tsx:73`)       |
| `/transactions/groups`         | `src/routes/_app/transactions/groups.tsx`         | ✅                                                         | ✅                                                 | ✅                                           |
| `/transactions/new`            | `src/routes/_app/transactions/new.tsx`            | ✅ `TransactionFormSkeleton` (`new.tsx:110`)               | ✅ `TransactionListError` (`new.tsx:115`)          | ✅ `noAccounts` precondition (`new.tsx:119`) |
| `/transactions/$transactionId` | `src/routes/_app/transactions/$transactionId.tsx` | ✅ `TransactionFormSkeleton` (`:121`)                      | ⚠️ any query error renders not-found copy (`:124`) | n/a (detail)                                 |
| `/transactions/rules`          | `src/routes/_app/transactions/rules/index.tsx`    | ❌ **none**                                                | ✅ `RulesListError`                                | ✅                                           |
| `/transactions/rules/$ruleId`  | `src/routes/_app/transactions/rules/$ruleId.tsx`  | ❌ **none**                                                | ✅                                                 | n/a (detail)                                 |
| `/transactions/rules/new`      | `src/routes/_app/transactions/rules/new.tsx`      | ❌ **none**                                                | ❌ **none**                                        | n/a (form)                                   |
| `/budgets`                     | `src/routes/_app/budgets/index.tsx`               | ✅ `BudgetListSkeleton`                                    | ✅ `BudgetsListError`                              | ✅                                           |
| `/budgets/$budgetId`           | `src/routes/_app/budgets/$budgetId.tsx`           | ✅                                                         | ✅                                                 | ✅ (empty period)                            |
| `/categories`                  | `src/routes/_app/categories/index.tsx`            | ✅                                                         | ✅                                                 | ✅                                           |
| `/goals`                       | `src/routes/_app/goals/index.tsx`                 | ✅                                                         | ✅                                                 | ✅ `GoalEmptyState`                          |
| `/goals/$goalId`               | `src/routes/_app/goals/$goalId.tsx`               | ✅                                                         | ✅                                                 | n/a (detail)                                 |
| `/payees`                      | `src/routes/_app/payees/index.tsx`                | ✅                                                         | ✅                                                 | ✅                                           |
| `/payees/$payeeId`             | `src/routes/_app/payees/$payeeId.tsx`             | ❌ **none**                                                | ✅ `PayeeDetailError`                              | n/a (detail)                                 |
| `/recurring`                   | `src/routes/_app/recurring/index.tsx`             | ✅                                                         | ✅                                                 | ✅ `RecurringEmptyState`                     |
| `/recurring/$seriesId`         | `src/routes/_app/recurring/$seriesId.tsx`         | ✅                                                         | ✅                                                 | n/a (detail)                                 |
| `/recurring/candidates`        | `src/routes/_app/recurring/candidates.tsx`        | ✅                                                         | ✅                                                 | ✅                                           |
| `/import`                      | `src/routes/_app/import/index.tsx`                | ❌ **none**                                                | ❌ **none**                                        | ✅ `import.history.empty.*`                  |
| `/import/$batchId`             | `src/routes/_app/import/$batchId.tsx`             | ❌ **none** for the loader                                 | ❌ **none**                                        | ✅                                           |
| `/settings`                    | `src/routes/_app/settings/index.tsx`              | n/a — no loader, no query, nothing async                   | n/a                                                | n/a                                          |
| `/settings/members`            | `src/routes/_app/settings/members.tsx`            | ✅                                                         | ✅                                                 | ✅                                           |
| `/settings/billing`            | `src/routes/_app/settings/billing.tsx`            | ✅                                                         | ✅                                                 | ✅                                           |
| `/invite/$invitationId`        | `src/routes/invite.$invitationId.tsx`             | ❌ **none**                                                | ✅ `InvitationMissing`                             | n/a (single row)                             |

**Seven** route modules declare no loading state: `/transactions/rules`,
`/transactions/rules/$ruleId`, `/transactions/rules/new`, `/payees/$payeeId`, `/import`,
`/import/$batchId` and `/invite/$invitationId`. **Three** of those declare no error state either:
`/transactions/rules/new`, `/import` and `/import/$batchId`.

`/invite/$invitationId` is on that list on purpose. The round's criterion is about "screens a new
user meets", and an invitation link is literally the first screen a new member sees.

Two corrections to what a fast read suggests:

- **`/payees/$payeeId` has no `notFoundComponent` of its own.** The only match for that string in
  the file is the comment at `src/routes/_app/payees/$payeeId.tsx:65`, which records that the route
  throws the router's not-found sentinel and the **root's** `notFoundComponent`
  (`src/routes/__root.tsx`) renders it.
- **`/transactions/$transactionId` renders `transactions.detail.notFound.*` for _any_ detail query
  failure** (`src/routes/_app/transactions/$transactionId.tsx:124`). Before #16 that was defensible,
  because a missing row and a broken read were indistinguishable. #16 shipped and
  `src/server/fns/not-found.ts` now separates them, so the conflation tells a reader their
  transaction does not exist when the read merely failed.

## 3. Measured: what the running app actually renders

Reading the modules is not evidence. Three findings, each from a run whose output was read.

### The empty state is designed and reachable — the round never signed in as anyone who had one

Signing in as the `tenant-b` fixture workspace (a real workspace with no rows) and opening
`/accounts` renders `AccountEmptyState` in full: a heading "No accounts yet", a sentence explaining
what an account is for, a primary "Add your first account", and three quick-start cards. Light and
dark both. The round's finding against `/accounts` is therefore a **reachability** finding, and the
same is true of `/budgets`.

### The data endpoint is `/_serverFn/*`, and only a client-side navigation produces one

Navigating through the shell rail produces exactly two requests, both `document`: `GET /accounts`
and `GET /accounts?status=active`. No data fetch at all — the loaders run server-side during SSR.
Navigating through the dashboard's `WidgetLink` instead produces `GET /_serverFn/<base64>` fetches
and no document request.

The reason is already written down in the codebase.
`src/components/app/dashboard/widget-link.tsx` states that the design system's `Link` routes through
React Aria's `RouterProvider`, that **no `RouterProvider` is mounted in this app**, and that a `ui`
link therefore does a full document load. The shell rail uses the design-system `Link`; `WidgetLink`
uses TanStack Router's.

So the product's primary navigation is a document reload, and no route's `pendingComponent` can
render on it.

### On a genuine client-side navigation, the loading state still did not render

Holding every `/_serverFn/*` response open and taking the dashboard's "All your spending" link, then
sampling at 1.5 s, 3 s and 5 s:

| t     | URL             | `h1`          | `role="status"` regions | skeleton bars |
| ----- | --------------- | ------------- | ----------------------- | ------------- |
| 1.5 s | `/transactions` | `"Dashboard"` | 0                       | 0             |
| 3 s   | `/transactions` | `"Dashboard"` | 0                       | 0             |
| 5 s   | `/transactions` | `"Dashboard"` | 0                       | 0             |

Releasing the hold snapped `h1` to `"Transactions"`.

For five seconds the reader was shown **the previous screen's financial figures**, under a URL and a
highlighted rail item naming a different screen, with **nothing announced** to a screen reader. In a
product about money that is worse than a blank hold: the numbers on screen are real, they are stale,
and nothing says so.

### The cause is two different things, and only one of them is configuration

The spec that commissioned this inventory read the finding above as "`src/router.tsx` sets no
pending thresholds". Re-measuring against the installed framework says that is not it, and the real
answer has two halves.

**The thresholds were never missing.** `@tanstack/router-core@1.171.27` applies
`defaultPendingMs: 1000` and `defaultPendingMinMs: 500` before it spreads the caller's options
(`dist/esm/router.js:620`). Restating either number in `src/router.tsx` would have changed nothing.

**What was missing is a default pending _component_.** The router only offers a pending state when
the pending match resolves one:

```js
// dist/esm/load-client.js:666
const component = route.options.pendingComponent ?? router.options.defaultPendingComponent
if (!component || typeof delay !== 'number' || delay === Infinity) { …; return }
```

A route with no `pendingComponent` and no router-level default therefore gets no pending state at
all, and the previous route's component stays mounted for the whole load. Navigating to
`/transactions/rules` — one of the seven bare surfaces — under a held `/_serverFn/*`, before and
after adding `defaultPendingComponent`, same probe:

| `src/router.tsx`                  | `role="status"` regions        | announced                | `aria-busy` |
| --------------------------------- | ------------------------------ | ------------------------ | ----------- |
| without `defaultPendingComponent` | 2 — both the previous screen's | `"50 of 600 loaded"`     | 0           |
| with `defaultPendingComponent`    | 3                              | `+ "Loading this page…"` | 1           |

**And the first client-side navigation of a tab is blocked before any of that can happen.** Reading
the router's own store during the held navigation above:

```
status: "pending"   isLoading: true
location: "/transactions"   resolvedLocation: "/dashboard"
matches:        [__root__ success, /_app success, /_app/dashboard/ success]   ← the old screen
pendingMatches: []
held request:   /_serverFn/…  →  {"file":"/src/routes/_app.tsx…"}
```

The one held request is `_app.tsx`'s `loadShell`. `_app`'s `beforeLoad` awaits
`queryClient.ensureQueryData` for it, and the client's query cache starts empty on a fresh document,
so the **first** client-side navigation in a tab always makes that round trip. Until it returns the
router produces no pending matches, so neither `_app`'s own `pendingComponent` nor the new route's
can render, and the reader keeps the previous screen. Every navigation **after** the first resolves
the shell from cache within its 30-second window and does render a loading state — which is exactly
what the two rows of the table above measure.

That first-navigation block is **not** fixed here. `_app.beforeLoad` is the session and tenant guard
and `AGENTS.md` → Ask First covers it. It is recorded here so the next reader does not re-derive it.

This is also why "add a `pendingComponent` to seven route modules" is, on its own, worth very little:
nineteen surfaces already declared one and it did not render either.

## 4. The house style is already consistent

`Spinner` is reached for by **six** modules outside `src/components/ui`, plus the `Button` primitive
itself:

| Module                                                 | What it is                     |
| ------------------------------------------------------ | ------------------------------ |
| `src/components/ui/button.tsx`                         | the primitive's own busy state |
| `src/components/app/transactions/transaction-list.tsx` | an inline row                  |
| `src/routes/_app/goals/-ui/contribution-dialog.tsx`    | a dialog's submit control      |
| `src/routes/_app/recurring/-ui/mark-paid-dialog.tsx`   | a dialog's submit control      |
| `src/routes/_app/transactions/-ui/refund-dialog.tsx`   | a dialog's submit control      |
| `src/routes/_app/import/-ui/preview-step.tsx`          | an inline row                  |
| `src/routes/_app/import/$batchId.tsx`                  | an inline row                  |

Every one is a control or an inline row. Nowhere does a spinner stand in for a page or a region
load; skeletons do that. Issue #21's out-of-scope clause said to say so and stop if the product was
already consistent, so the rule is recorded here rather than re-derived by the next author:

> **A region that is loading draws a skeleton of the layout it is about to show. A spinner appears
> only inside a control that is working, or on an inline row awaiting one value. A spinner never
> stands in for a page or a region load.**

## 5. One finding outside issue #21's scope

`ErrorPanel` — the retryable failure panel every surface uses — lives at
`src/components/app/accounts/error-panel.tsx` and is reached by **37 modules outside
`src/components/app/accounts`**, spanning budgets, categories, dashboard, goals, payees, recurring,
settings, transactions and rules. `docs/SPEC.md` §8 gives a concept exactly one owner, and the error
treatment issue #21 wants made consistent is owned by one product area that everyone else reaches
into.

It is not fixed here: it is a 37-file mechanical move with no behaviour change and no dependency on
anything in #21, and bundling it would make that one issue two capabilities. It is filed as
[#208](https://github.com/design4pro/money-tracker.online/issues/208).

## 6. What the inventory decided

- The **empty** state was a reachability gap, not a design gap. It is reached deliberately by a
  fifth read-only fixture workspace with no rows (`e2e/support/session.ts`), not by a query
  parameter that would put a test-only branch in production route code.
- The **loading** state was a missing router-level default first and a per-route gap second.
  `src/router.tsx` now sets a `defaultPendingComponent`, which is what lets a route that draws no
  shape of its own announce its load at all, and the seven bare modules got a shape each. The
  first-navigation block in `_app.beforeLoad` is named above and left alone.
- The **error** state was designed almost everywhere. The two gaps were the three modules declaring
  none, and `/transactions/$transactionId` conflating a broken read with a missing row — reconciled
  with what #16 landed rather than given a second error treatment beside it.
- **Loading** and **error** are reached in a test and in a capture run by intercepting
  `**/_serverFn/**` on a **client-side** navigation (`e2e/support/states.ts`,
  `scripts/visual/capture.mjs --force-state`). A `page.goto` produces no such request, as §3
  measured.
