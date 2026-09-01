# 18 — Dashboard

## Area brief

The workspace home: a **configurable widget grid** over the areas that already exist — net worth,
cashflow, budget status, upcoming recurring, goal progress, recent transactions, account balances.
The dashboard **invents no data**. Every widget calls a loader another plan already owns and shipped
tests for, which is why this plan sits at the end of wave 4 with five dependencies.

Three structural commitments:

1. **The grid is a list, semantically.** It is presented as a two-dimensional arrangement but the DOM
   is an ordered list of sections, so a screen reader and a keyboard user get a linear, predictable
   walk. `grid-cell.tsx` and `widget-frame.tsx` (`00-S13`) enforce that shape.
2. **Reordering has a keyboard path that is not drag and drop.** Drag is an enhancement; the
   authoritative mechanism is a per-widget "Move" menu (up / down / to position N), the same
   `reorder-menu.tsx` pattern `00-S8` built. A dashboard reorderable only by pointer is unusable for
   part of the audience and would fail 2.1.1 outright.
3. **One widget's failure does not blank the dashboard.** Each widget is inside its own error
   boundary and renders its own `ErrorPanel` (`05-S2`) in place, sized to its cell.

---

## Stage 18-S1 — Layout persistence and the grid

### Stage id

`18-S1` · Wave 4 · effort **L**.

### Reference rows

`DASH-01 missing → done` — the `dashboard_layouts` store and its repository.
`DASH-02 missing → done` — the grid shell with keyboard reordering, add and remove.

### Owned paths

- `src/server/repos/dashboard.ts` — new
- `src/server/repos/__tests__/dashboard.test.ts` — new
- `src/server/functions/dashboard.ts` — new
- `src/routes/_app/index.tsx` — new
- `src/routes/_app/-ui/widget-grid.tsx` — new
- `src/routes/_app/-ui/widget-catalog.ts` — new
- `e2e/dashboard.spec.ts` — new

### Data and migration

`dashboard_layouts` is created by `00-S11` (which owns `schema.ts`): `id`, `workspace_id`, `user_id`,
`layout_json`, `updated_at`, unique on `(workspace_id, user_id)`. **A layout is per user per
workspace**, not per workspace — two people sharing a household should not fight over widget order.

`layout_json` holds `{ version: 1, widgets: [{ id, kind, size, params }] }` and is **validated on
read** by `layoutSchema`. An unknown `kind` (a widget removed in a later release) is **dropped on
read with a console-free, logged note**, never rendered as a broken cell, and the pruned layout is
written back on the next save rather than on read — a read path that writes is a surprise.

### Server (repo, server function, Zod)

- `createDashboardRepository(scope)` with `get(userId)` and `save(userId, layout)`. `get` returns the
  **default layout** (from `widget-catalog.ts`) when no row exists; it does not insert one, so a
  person who never customises never occupies a row.
- `layoutSchema` — at most **12 widgets**, `kind` from the catalogue enum, `size` in `sm | md | lg`,
  `params` a per-kind discriminated union (a budget widget carries a `budgetId`, a goal widget a
  `goalId`, a cashflow widget a `period`). Duplicate `id`s are rejected; duplicate `kind`s are
  allowed, because two budget widgets for two budgets is a reasonable thing to want.
- **Referential honesty.** `params` may name a `budgetId` that has since been deleted. The loader does
  not join-and-fail; the widget resolves it and renders a designed **"This budget no longer exists"**
  cell with a remove action. Cascading deletes into a JSON blob is a worse cure than the disease.

### UI (route, components)

- **Route.** `/` inside `_app` — the post-login landing.
- **Components.** `widget-grid.tsx` (an ordered list rendering `grid-cell` from `00-S13`);
  `widget-catalog.ts` (the single source of widget kinds, their default sizes, their param schemas and
  their labels — adding a widget touches one file).
- **States.** **Default** (a first-run layout: net worth, cashflow, budget status, recent
  transactions); **customised**; **empty** (every widget removed — a designed panel offering the
  default layout back, never a blank page); **saving** (an inline status, not a blocking overlay);
  **save failed** (the layout stays as the person arranged it and a retry is offered — silently
  reverting someone's arrangement is the worst possible response).
- **Tokens.** Grid gaps and cell radii from `tokens.css`; no new tokens.
- **Accessibility.** The grid is `<ul>`/`<li>` with `aria-label="Dashboard widgets"`. Each widget's
  frame is a `<section>` with an `<h2>`. The Move menu announces the result through a polite live
  region ("Net worth moved to position 2 of 5"). Drag, where offered, uses React Aria's
  `useDragAndDrop` so it carries its own keyboard and screen-reader affordances rather than raw
  pointer events. Every control is 44px (2.5.5 AAA). Reordering is **not** time-limited (2.2.6 AAA).

### Quota

Widget count is capped at 12 by the schema for layout sanity, on every plan. It is **not** an
`assertWithinLimit` call and the code says so in a comment, because routing a non-plan cap through
the quota machinery would make `EffectiveLimits` lie about what the plan sells.

### Tenant isolation test

In `tenant-isolation.test.ts`: A cannot read or write B's layout; `save` with a forged `user_id`
writes to the caller's own row, not the named one; and a layout whose `params` name B's `budgetId`
resolves to the "no longer exists" cell rather than B's data — the widget loaders are scoped, so a
forged id is a miss, not a leak. That last assertion is the one that matters and it is named
explicitly.

### Money invariant

_The grid moves widgets; it never touches a number._ Case in `dashboard.test.ts`: _`save` and `get`
round-trip a layout byte-identically for a fixture containing every widget kind_, and the repository
exposes **no** method that reads a transaction, a balance or an amount. A grep-style assertion in the
test that `dashboard.ts` imports nothing from `repos/transactions` or `repos/balances` keeps the
boundary from eroding.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `dashboard.test.ts`: the round trip; the default-when-absent path; the 12-widget rejection; the
  unknown-kind prune; the duplicate-id rejection; the dangling-`budgetId` resolution.
- `e2e/dashboard.spec.ts`: reorder by **keyboard only** and assert the persisted order after a
  reload; remove and re-add a widget; the empty state and its restore action; the save-failed retry
  (with the network intercepted).
- Browser evidence at the pinned clock: `/` in both themes at **360 / 1280 / 2560 px**, plus the
  **Move menu open**, a **focused widget frame**, the **empty state**, and the **dangling-reference
  cell**.
- axe on `/` in both themes with the Move menu open: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 18-S2 — The widget set

### Stage id

`18-S2` · Wave 4 · effort **L**.

### Reference rows

`DASH-03 missing → done` — net worth, cashflow and account-balances widgets.
`DASH-04 missing → done` — budget status, upcoming recurring and goal progress widgets.
`DASH-05 missing → done` — recent transactions widget.

### Owned paths

- `src/routes/_app/-ui/widgets/net-worth-widget.tsx` — new
- `src/routes/_app/-ui/widgets/cashflow-widget.tsx` — new
- `src/routes/_app/-ui/widgets/accounts-widget.tsx` — new
- `src/routes/_app/-ui/widgets/budget-widget.tsx` — new
- `src/routes/_app/-ui/widgets/recurring-widget.tsx` — new
- `src/routes/_app/-ui/widgets/goal-widget.tsx` — new
- `src/routes/_app/-ui/widgets/recent-widget.tsx` — new
- `src/routes/_app/-ui/widgets/index.ts` — new

### Data and migration

None.

### Server (repo, server function, Zod)

None new. Each widget calls an existing server function: `17-S1`'s `netWorth` and `cashflow`,
`06-S1`'s account list, `12-S1`'s budget utilisation, `13-S1`'s upcoming periods, `15-S1`'s goal
progress, `07-S2`'s transaction query with `limit: 5`.

**One batched loader.** `loadDashboard` (in `18-S1`'s `functions/dashboard.ts`) takes the layout and
issues exactly the queries the present widgets need — seven widgets do not mean seven round trips, and
two budget widgets issue one batched budget query. `e2e/dashboard.spec.ts` asserts the request count.

### UI (route, components)

- **Components.** Seven widgets, each a `widget-frame` (`00-S13`) with a title, an optional "View all"
  link to its full route, and a body sized to `sm | md | lg`.
- **States.** Every widget implements the same five: skeleton, loaded, **empty** (its own copy and its
  own call to action — "No budgets yet · Create one"), **error** (its own `ErrorPanel`, cell-sized),
  and **dangling** (the referenced entity is gone). A widget missing one of the five is not done, and
  the state matrix in the gallery (`01-S1`) gains a row per widget so this is checkable rather than
  asserted.
- **Charts.** Net worth and cashflow use plan 16's line chart at a reduced density; the goal widget
  uses the sparkline; the budget widget uses a labelled progress bar, not a donut — a donut at 200px
  with a percentage is unreadable and the label carries the meaning anyway.
- **Accessibility.** Each widget's heading is unique on the page even when the kind repeats ("Budget:
  Groceries", not two "Budget" headings). Every chart carries its visually-hidden table (`16-S1`).
  "View all" links have distinct accessible names ("View all budgets"), never seven identical "View
  all" links, which is the single most common dashboard accessibility failure.

### Quota

No countable row.

### Tenant isolation test

Covered by each widget's own source repository; this stage adds one assertion to
`tenant-isolation.test.ts`: _`loadDashboard` for a member of A returns no row from B for any of the
seven widget kinds_, run against a seed where both workspaces have entities with identical names.

### Money invariant

_A widget is a smaller view of a number another plan already proved._ Cases in
`money-invariants.test.ts`:

- _the net-worth widget's headline equals `analytics.netWorth`'s last bucket_ for the same fixture —
  the widget does not compute, it displays.
- _the budget widget's remaining amount equals `budgets.utilisation`'s `remainingMinor`_, including
  when the budget is overspent and the figure is negative, which renders as a negative amount with the
  overspend styling and **not** as a clamped zero.
- _the accounts widget's total equals the sum of the per-account balances in base currency_, using
  each account's stored `ref` balance, never a live conversion.
- _the recent widget shows amounts in each transaction's **own** currency with the base-currency
  equivalent beneath_, matching the transaction list's rendering exactly — two surfaces showing the
  same row must not choose different currencies.
- _a widget for a zero-decimal currency renders no decimal separator_, including inside the
  progress bar's label.

### Verification

- Command gate.
- Unit tests per widget for the five states, driven by fixtures rather than mocks of the loaders.
- `e2e/dashboard.spec.ts` extended: the batched request-count assertion; each widget's "View all" link
  landing on the right route; the negative-remaining budget rendering.
- Browser evidence at the pinned clock: `/` with **all seven widgets present**, both themes, at
  **360 / 1280 / 2560 px** (at 360px the grid is a single column and the evidence must show that),
  plus the **empty state of the budget widget**, an **errored widget beside healthy ones**, and a
  **focused data point in the net-worth widget**.
- axe: zero `serious`, zero `critical`; the duplicate-accessible-name check must find none.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 18-S3 — First-run and the greeting header

### Stage id

`18-S3` · Wave 4 · effort **S**.

### Reference rows

`DASH-06 missing → done` — the dashboard header with the period summary.
`DASH-07 missing → done` — the first-run dashboard for a workspace with no data.

### Owned paths

- `src/routes/_app/-ui/dashboard-header.tsx` — new
- `src/routes/_app/-ui/first-run-panel.tsx` — new

### Data and migration

None. "Has data" is derived from a single `COUNT` across accounts and transactions in the batched
loader, not a stored flag — a flag would drift the moment someone deleted their last account.

### Server (repo, server function, Zod)

`loadDashboard` gains `hasData: boolean` and `summary: { periodLabel, inMinor, outMinor, netMinor }`
for the current month, from `17-S1`'s `cashflow` with `granularity: 'month'`.

### UI (route, components)

- **Components.** `dashboard-header.tsx` — the workspace name, the current period label and the
  three summary figures; `first-run-panel.tsx` — shown **instead of** the grid when `hasData` is
  false, offering three actions: add an account, import a file, explore with sample data.
- **The sample-data action is a link into plan 26's onboarding**, not a second implementation of it.
  This stage renders the entry point; plan 26 owns what happens next. If plan 26 has not landed, the
  action is **absent**, not disabled — a disabled button with no explanation is worse than no button.
  `first-run-panel.tsx` reads the action list from a constant so plan 26 adds its entry in one line.
- **Greeting.** The header does **not** say "Good morning" — a time-of-day greeting derived from a
  server clock is wrong for a person in another time zone often enough to look broken, and it earns
  nothing. It states the period and the numbers.
- **Accessibility.** The three summary figures are a `<dl>`, so the label-value relationship survives
  linearisation. The header is inside the route's `<h1>` region and does not introduce a second `h1`.

### Quota

No countable row.

### Tenant isolation test

One assertion: _`hasData` is computed within the scope_ — a workspace with no rows reports `false`
even when a sibling workspace is full.

### Money invariant

_The header's three figures are the month's `cashflow` bucket, unchanged._ Case in
`money-invariants.test.ts`: _the header's `netMinor` equals `inMinor − outMinor` and equals the
cashflow widget's current-month bucket_ for the same fixture, so the header and the widget cannot
disagree on the same screen.

### Verification

- Command gate.
- Unit: the header's `<dl>` structure and formatting; `first-run-panel` renders exactly the actions
  present in the constant.
- `e2e/dashboard.spec.ts` extended: a fresh workspace lands on the first-run panel; adding one
  account moves it to the grid on the next load.
- Browser evidence at the pinned clock: the **first-run panel** and the **header above a populated
  grid**, both themes, 360 / 1280 / 2560 px.
- axe on both states: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None. The plan-26 dependency is handled by the constant-driven action list rather than by waiting.
