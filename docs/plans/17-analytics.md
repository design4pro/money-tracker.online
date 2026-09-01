# 17 — Analytics

## Area brief

The reporting surface: **cashflow over time**, **spending by category**, **spending by payee**,
**net worth over time**, and **period comparison** (this month vs last, this year vs last). Everything
here is a **read**; analytics never writes a row and never derives a number the ledger does not
already hold.

Two rules shape the whole area:

1. **Analytics reads `ref_amount_minor`, never a live conversion.** A report that re-converted history
   at today's rate would change last March's total every morning. `ref_amount_minor` was written once
   at the rate of `booked_on` (`03-S2`, `07-S1`) and is never recomputed — so a report run twice
   returns the same number, and that is the property the tests assert.
2. **Every aggregate is a SQL aggregate.** No `SELECT *` followed by a JavaScript reduce. D1 rows are
   cheap to count and expensive to ship; the indexes for these queries are created by `00-S11`.

Net worth reads the balance snapshots from plan 09 rather than re-summing transactions, which is why
this plan depends on 09. Budget context comes from plan 12, and the charts come from plan 16.

---

## Stage 17-S1 — The aggregate query layer

### Stage id

`17-S1` · Wave 4 · effort **L**.

### Reference rows

`ANL-01 missing → done` — the analytics repository with the five aggregate queries.
`ANL-02 missing → done` — the shared period resolver and comparison window logic.

### Owned paths

- `src/server/repos/analytics.ts` — new
- `src/server/repos/__tests__/analytics.test.ts` — new
- `src/lib/period.ts` — new
- `src/lib/__tests__/period.test.ts` — new
- `src/server/functions/analytics.ts` — new

### Data and migration

No new table. This stage **requisitions** the covering indexes from `00-S11` (which owns
`schema.ts`): `(workspace_id, booked_on)`, `(workspace_id, category_id, booked_on)`,
`(workspace_id, payee_id, booked_on)` on `transactions`, and `(workspace_id, account_id, as_of)` on
`balance_snapshots`. If those indexes are absent the queries still return correct results, so the
stage is not blocked — it is slow, and `analytics.test.ts` asserts the query plan uses an index via
`EXPLAIN QUERY PLAN` rather than asserting a wall-clock time (a timing assertion in CI is a flake
generator).

### Server (repo, server function, Zod)

- **Repo.** `createAnalyticsRepository(scope)` over `createTenantRepository`, exposing:
  - `cashflow({ from, to, granularity })` → `{ bucket, inMinor, outMinor, netMinor }[]`
  - `byCategory({ from, to, direction, limit })` → `{ categoryId, name, amountMinor, share }[]`
  - `byPayee({ from, to, direction, limit })` → same shape keyed by payee
  - `netWorth({ from, to, granularity })` → `{ bucket, assetsMinor, liabilitiesMinor, netMinor }[]`
  - `compare({ current, previous })` → both windows' totals plus `deltaMinor` and `deltaRatio`
- **Scoping.** Every query goes through `tenantFilter`; `assertScopedWrite` is not involved because
  there are no writes, and the test asserts the repository exposes **no** write method.
- **Zod.** `analyticsRangeSchema` — `from`/`to` as ISO dates with `to >= from` and a **hard 5-year
  span cap**; `granularity` in `day | week | month | quarter | year`; `direction` in
  `expense | income | both`; `limit` clamped to 50.
- **Excluded rows.** Planned transactions, and both legs of an **internal transfer**, are excluded
  from cashflow and category reports — an internal transfer is not spending, and counting it doubles
  a person's apparent expenses. `external_out` and `external_in` legs **are** counted, once, on the
  side that leaves or enters the workspace. This is the single subtlest rule in the area and it gets
  its own named test.
- **Period resolver.** `src/lib/period.ts` resolves named windows (`this-month`, `last-month`,
  `this-quarter`, `last-90-days`, `this-year`, `last-year`, `custom`) into concrete date pairs using
  `@internationalized/date` and the workspace time zone, never `new Date()` arithmetic. The
  comparison window for a named period is the immediately preceding window of the same length,
  **anchored to the calendar** — last month is the previous calendar month, not "30 days earlier".

### UI (route, components)

None in this stage; the server functions ship first so `17-S2` composes rather than invents.

### Quota

No countable row. Reports are not a plan-limited resource; the 5-year span cap is a **cost** control,
not a plan boundary, and it applies on every plan equally.

### Tenant isolation test

In `tenant-isolation.test.ts`: seed two workspaces with overlapping category names, payees and dates;
for each of the five queries assert workspace A's result contains no row sourced from B, and that a
hand-built request naming B's `categoryId` returns an **empty bucket, not B's data**. Also assert the
repository object has no method that writes.

### Money invariant

_A report is a sum of stored integers in the base currency, and it is stable over time._ Cases in
`analytics.test.ts`:

- _`cashflow` sums `ref_amount_minor`_ — a fixture whose FX rate is then changed produces an
  **identical** report, proving no live conversion.
- _`inMinor + outMinor = netMinor` exactly_, with `outMinor` held as a positive magnitude and the
  sign carried by the field name, so a template cannot accidentally double-negate.
- _an internal transfer contributes zero to cashflow and appears in no category bucket_, while an
  `external_out` leg contributes exactly once.
- _`byCategory` shares are integers-derived and sum to exactly 100%_ via largest remainder, with the
  `limit`-truncated tail folded into an explicit `Other` row whose amount is the exact remainder.
- _a multi-currency workspace's report equals the sum of the per-account reports_ converted at the
  stored rates — never a re-conversion of the total.
- _a zero-decimal currency's totals carry no fractional part at any granularity_.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `analytics.test.ts`: the six money cases, the exclusion rules, the 5-year cap rejection, and
  `EXPLAIN QUERY PLAN` showing an index scan for each of the five queries.
- `period.test.ts`: each named window across a month boundary, a leap day, a year boundary, and a
  DST transition in `Europe/Warsaw`; the comparison window for a 31-day month compared to a 28-day
  month (the previous calendar month, with the length difference reported, not hidden).
- `tenant-isolation.test.ts` passes.
- No browser evidence — this stage renders nothing, and a screenshot of nothing is not evidence.

### Definition of done

All six §7 items; the §2 visual clauses are carried by `17-S2`, and this stage's DoD says so
explicitly rather than silently ticking them.

### Blockers

None.

---

## Stage 17-S2 — The reports route

### Stage id

`17-S2` · Wave 4 · effort **L**.

### Reference rows

`ANL-03 missing → done` — `/reports` with the period picker and the five report panels.
`ANL-04 missing → done` — drill-down from a report bucket into the filtered transaction list.

### Owned paths

- `src/routes/_app/reports/index.tsx` — new
- `src/routes/_app/reports/-ui/period-picker.tsx` — new
- `src/routes/_app/reports/-ui/cashflow-panel.tsx` — new
- `src/routes/_app/reports/-ui/breakdown-panel.tsx` — new
- `src/routes/_app/reports/-ui/net-worth-panel.tsx` — new
- `src/routes/_app/reports/-ui/comparison-panel.tsx` — new
- `e2e/reports.spec.ts` — new

### Data and migration

None.

### Server (repo, server function, Zod)

`loadReports` composes the five queries in **one** server function so the route makes one round trip,
not five. The period and granularity live in the **URL search params**, validated by
`analyticsRangeSchema` through TanStack Router's `validateSearch`, so a report is linkable and a
malformed link produces the designed error panel from `05-S2` rather than a crash.

### UI (route, components)

- **Route.** `/reports`, with `?period=this-month&granularity=month&direction=expense` and friends.
- **Components.** `period-picker.tsx` (a named-window listbox plus a custom range with two date
  fields); four panels, each a `chart-frame` (`00-S10`) wrapping a plan-16 chart plus a real
  `<table>` of the same numbers that is **visible on the panel's "Table" tab**, not only hidden.
  Analytics is the one area where the table is a first-class view: a table is often the better
  answer, and hiding it behind assistive tech only would be a design failure.
- **States.** Skeleton (the frame's reserved height, so the page does not reflow); **empty** ("No
  transactions in this period" with a link to widen the range); **partial** (fewer buckets than the
  range implies, labelled); error (`ErrorPanel` from `05-S2`); and a **truncated** state when the
  `Other` row is non-zero, which states how many rows it folds.
- **Tokens.** Chart palette from `00-S3`; no new tokens.
- **Accessibility.** The period picker is a React Aria `ListBox` with a `DatePicker` pair for custom
  ranges. Changing the period announces the new range through a polite live region and moves focus
  nowhere — a focus jump on every filter change is a screen-reader trap. Each panel is a
  `<section>` with a heading, so heading navigation walks the report. Drill-down links are real
  `<a href>` to `/transactions?...`, not click handlers, so they open in a new tab. Target size 44px
  on every picker control and every chart data point (2.5.5 AAA).

### Quota

No countable row.

### Tenant isolation test

Covered by `17-S1`; the route adds an e2e assertion that a `/reports` link carrying another
workspace's `categoryId` in a drill-down param renders the empty state.

### Money invariant

_What the chart draws, the table states, and the drill-down lists must be the same number._ Cases:

- in `e2e/reports.spec.ts`: _the category panel's largest bucket amount equals the sum shown by the
  transaction list it drills into_, read from the DOM on both screens against the same seed.
- _the comparison panel's delta equals `current − previous`_ in integer minor units, with the
  percentage derived from those integers and suppressed (rendered as `—` with an explanatory title)
  when `previous` is zero, because a division by zero rendered as `Infinity%` is a bug users report.
- _switching granularity re-buckets but does not change the period total_, asserted across
  day/week/month for the same range.

### Verification

- Command gate.
- `e2e/reports.spec.ts`: the three money assertions; the period picker's keyboard path; the
  linkable-URL round trip; the drill-down landing on a correctly filtered list; the empty and
  truncated states.
- Browser evidence at the pinned clock (`x-mt-server-today: 2026-08-20`): `/reports` in both themes at
  **360 / 1280 / 2560 px**, plus the **period picker open**, the **Table tab of the category panel**,
  the **empty state**, and a **focused chart data point**.
- axe on `/reports` in both themes, with the picker open: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 17-S3 — Saved views and CSV export of a report

### Stage id

`17-S3` · Wave 4 · effort **M**.

### Reference rows

`ANL-05 missing → done` — saved report views per workspace.
`ANL-06 missing → done` — export the current report as CSV.

### Owned paths

- `src/server/repos/saved-views.ts` — new
- `src/server/repos/__tests__/saved-views.test.ts` — new
- `src/routes/_app/reports/-ui/saved-views-menu.tsx` — new
- `src/server/lib/report-csv.ts` — new
- `src/server/lib/__tests__/report-csv.test.ts` — new

### Data and migration

Requisitions `saved_views` into `00-S11`: `id`, `workspace_id`, `name`, `kind`
(`cashflow|category|payee|net_worth|comparison`), `params_json`, `created_by`, `created_at`, with a
unique index on `(workspace_id, name)`. `params_json` is **re-validated with `analyticsRangeSchema` on
read**, not trusted — a saved view is user input that has been sitting in a database, which makes it
more suspect than fresh input, not less.

### Server (repo, server function, Zod)

- `createSavedViewsRepository(scope)` with `list`, `create`, `rename`, `remove`. No `update` of
  `params_json`: a changed report is a new view, which keeps a shared link's meaning stable.
- `savedViewSchema` — name 1–60 chars after trim, `kind` enum, `params` parsed by the range schema.
- `exportReportCsv` returns a `text/csv` response built by `report-csv.ts`. **No R2 object and no
  queue job**: a report CSV is small and synchronous. Plan 20 owns the asynchronous, whole-workspace
  export; this is deliberately the small sibling and the two must not be confused, so
  `report-csv.ts` carries a header comment saying which is which.

### UI (route, components)

- **Components.** `saved-views-menu.tsx` — a React Aria `MenuTrigger` listing views, with save,
  rename and delete. Delete is a `AlertDialog` confirm; rename is inline with an accessible name.
- **States.** Empty ("No saved views yet"), list, and a **stale** state: if a saved view's params fail
  re-validation (a schema tightened since it was saved), the row renders disabled with a "This view
  is out of date" note and a delete action — never a silent drop and never a crash.
- **Accessibility.** The menu is keyboard-complete; save opens a dialog whose focus returns to the
  trigger on close. The CSV download is a real link with `download`, and the button announces the row
  count that will be exported so a person is not surprised by an empty file.

### Quota

`saved_views` is countable: `assertWithinLimit('savedViews', ...)` inside `create`, before the insert.
The ceiling comes from `resolveLimits()`; the free tier's number is `OPEN-1`.

### Tenant isolation test

In `tenant-isolation.test.ts`: workspace A cannot `list`, `rename` or `remove` B's saved views;
`create` with a forged `workspace_id` in the payload is overwritten by the scope, not honoured; and
the `(workspace_id, name)` unique index does not leak B's names through a conflict error message —
the conflict is reported as a generic "A view with this name already exists" for the caller's own
workspace only.

### Money invariant

_A CSV of a report contains the same integers the screen showed._ Cases in `report-csv.test.ts`:

- _amounts are serialised from minor units through `formatAmountForCsv`_, which writes a decimal
  string with exactly `currencies.digits` places and a `.` separator regardless of UI locale — a
  CSV is a data interchange format, not a localised document, and a Polish `1 234,56` in a CSV
  breaks every spreadsheet import that assumes otherwise. The **display locale is recorded in a
  header comment row**, so the choice is visible rather than surprising.
- _the currency code is its own column_, never glued to the amount.
- _the CSV's column total equals the screen's stated total_, asserted against the same fixture the
  e2e uses.
- _a value containing a separator, a quote or a newline is quoted and escaped per RFC 4180_, and a
  leading `=`, `+`, `-` or `@` in a text field is prefixed with a `'` — CSV injection into a
  spreadsheet is a real attack, and `docs/SECURITY.md` §6 names it.

### Verification

- Command gate.
- `saved-views.test.ts`: create/rename/remove; the name uniqueness path; the quota rejection with the
  typed error; the stale-params path.
- `report-csv.test.ts`: the four money cases plus the injection-prefix case.
- Browser evidence: `/reports` with the **saved-views menu open**, the **save dialog**, and the
  **stale view row**, both themes, 360 / 1280 / 2560 px.
- axe with the menu and dialog open: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

`OPEN-1` — the saved-view ceiling per plan is unset. Ship with the row ceiling from `plans.ts`
(`00-S15`) and a named constant so the number changes in one place.
