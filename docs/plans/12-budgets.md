# 12 — Budgets

## Area brief

Two kinds of budget: **category** budgets (auto-including every transaction in their categories) and
**manual** budgets (an explicit list of transactions). Both run over **materialised periods**, which
is what makes rollover auditable — a carry computed on read is a number nobody can check.

`rollover_policy` is `none | carry_surplus | carry_all`, and it is the feature that decides whether
this product competes with envelope budgeting at all. The **semantics of an overspent envelope are an
open product decision** (`99-boundaries-and-blockers.md` `OPEN-5`), so this plan ships the mechanism
and the two uncontested policies, and names the third's open question rather than guessing.

---

## Stage 12-S1 — Budgets, membership and utilisation

### Stage id

`12-S1` · Wave 3 · effort **L**.

### Reference rows

`BUD-01 missing → done` — the budgets repository, both kinds, with membership.
`BUD-02 missing → done` — utilisation computed over the current period.
`BUD-03 missing → done` — the budget list screen.

### Owned paths

- `src/server/repos/budgets.ts` — new
- `src/server/budgets/utilisation.ts` — new
- `src/server/fns/budgets.ts` — new
- `src/routes/_app/budgets/index.tsx` — new
- `src/routes/_app/budgets/-ui/budget-card.tsx` — new
- `src/routes/_app/budgets/-ui/budget-form.tsx` — new
- `src/server/repos/__tests__/budgets.test.ts` — new
- `e2e/budgets.visual.spec.ts` — new

### Data and migration

`budgets`, `budget_categories` and `budget_transactions` exist from `00-S7`. No schema change.

`kind` is `manual | category`; `period` is `one_off | monthly | quarterly | yearly`; `status` is
`active | closed | archived`; `alert_thresholds` is a JSON array defaulting to `[50, 80, 100]`.

### Server (repo, server function, Zod)

- **Repository.** `budgets.ts`: `listBudgets`, `getBudget`, `createBudget`, `updateBudget`,
  `archiveBudget`, `deleteBudget`, `setBudgetCategories`, `addBudgetTransactions`,
  `removeBudgetTransactions`.
- **`auto_include`** applies to `category` budgets: a transaction in a covered category joins the
  budget's current period automatically, resolved **at read time from the category set**, not
  materialised into `budget_transactions`. Materialising it would need a backfill on every category
  change and would drift.
- **`budget_transactions` is only for `manual` budgets**, and the repository refuses to add a row to a
  `category` budget. Two mechanisms for the same membership question is how a budget ends up counting
  a transaction twice.
- **`utilisation.ts`** computes `{ spentMinor, limitMinor, carriedInMinor, remainingMinor, ratio,
state }` for a period, where `state` is `under | approaching | over` derived from
  `alert_thresholds`. Everything is integer; `ratio` is computed for display only and never fed back
  into arithmetic.
- **Server function.** One per repository export, plus `loadBudgets` (GET) returning the list with
  each budget's current-period utilisation in one call.
- **Zod.** `limit_minor` is `z.number().int().positive()`; `alert_thresholds` is a sorted array of
  integers 1–200 (over 100 is legitimate — some people want to know at 150%).
- **Authorisation.** `requireOrg()`.
- **Ledger batching.** Budgets read transactions and write none. **No rebuild is enqueued**, stated
  explicitly.

### UI (route, components)

- **Route.** `/budgets`, SSR default.
- **Components.** Reuses `Card`, `Meter`, `Dialog`, `Select`, `MoneyField`, `DatePicker`, `Badge`,
  `Menu`. New: `budget-card.tsx`, `budget-form.tsx`.
- **States.** Empty: _"No budgets yet"_ with a one-line explanation of the two kinds and one primary
  action. Skeleton: three cards with the meter's shape reserved, so nothing shifts when the numbers
  land. Error: `ErrorPanel` retryable; a budget whose utilisation failed shows `—`, never `0%`, which
  would read as "nothing spent".
- **Tokens.** None new. The meter uses `success`, `warning` and `danger` at the threshold boundaries.
- **Accessibility.** The meter is a RAC `Meter` with `aria-valuetext` reading the **amounts**, not the
  percentage: _"1 240,00 zł of 2 000,00 zł spent, 62 percent"_. The `state` is a text badge as well as
  a colour — colour alone would fail the product's own rule and, more practically, is the difference
  between "you are fine" and "you are over" for a colour-blind reader.

### Quota

`budgets` is a metered metric. `createBudget` calls `assertWithinLimit(scope, 'budgets', current + 1)`
**inside the repository, before the insert**. Archived budgets count, for the same reason archived
accounts do (`06-S1`), and the copy says so.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A attempts every write on B's budget ids, `setBudgetCategories`
with B's category ids, and `addBudgetTransactions` with B's transaction ids onto A's budget. Every one
is a `NotFoundError`; B's budgets are unchanged. Functions covered: all nine exports.

**Plus:** `loadBudgets` in A's scope never includes a transaction of B's in a utilisation figure, even
when both workspaces have a category with the same name and slug.

### Money invariant

_Utilisation sums `ref_amount_minor` in the workspace base, in integers, and excludes what must be
excluded._ Cases in `money-invariants.test.ts`:

- _spent is an integer SQL `SUM` of `ref_amount_minor`_, never a JavaScript reduction over a page.
- _transfers are excluded_ — both legs carry `transfer_kind !== 'none'` and the budget policy excludes
  them. A budget that counts a transfer between your own accounts as spending is the classic budgeting
  bug.
- _balance adjustments are excluded_, for the same reason: a correction is not spending.
- _refunded amounts reduce spend by the refund's amount, once_, not twice, and not at all if the
  refund's own transaction is also in the budget's categories (which would double-count).
- _a split transaction contributes each split to its own category's budget_, and the sum of those
  contributions equals the parent's `ref_amount_minor` exactly (composing with `11-S1`'s
  largest-remainder rounding).
- _a budget in a currency other than the base compares like with like_: the limit is stored with its
  own `currency_code`, and utilisation converts the **limit** into base once at read, never the
  individual transactions a second time.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `budgets.test.ts`: the manual/category membership refusal; `auto_include` resolving from categories
  rather than a materialised list; the six money cases; the isolation cases.
- Browser evidence: `/budgets` with **one under, one approaching and one over** budget, both themes, at
  **360 / 1280 / 2560 px** — the three states are the point of the stage — plus the empty state.
- `e2e/budgets.visual.spec.ts` runs axe on `/budgets`: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

**`OPEN-7`** — splits in one category. Case five above assumes two splits in one category contribute
as two rows summing correctly; if the decision is that they contribute as one merged line, the case
changes but the arithmetic does not.

---

## Stage 12-S2 — Periods and rollover

### Stage id

`12-S2` · Wave 3 · effort **L**. The stage that makes rollover auditable.

### Reference rows

`BUD-04 missing → done` — `budget_periods` materialisation and closing.
`BUD-05 missing → done` — `carry_surplus` and `carry_all`.
`BUD-06 missing → done` — the rollover ledger on the budget detail screen.

### Owned paths

- `src/server/repos/budget-periods.ts` — new
- `src/server/budgets/rollover.ts` — new
- `src/server/budgets/materialize.ts` — new
- `src/routes/_app/budgets/$budgetId.tsx` — new
- `src/routes/_app/budgets/-ui/rollover-ledger.tsx` — new
- `src/routes/_app/budgets/-ui/period-timeline.tsx` — new
- `src/server/budgets/__tests__/rollover.test.ts` — new
- `src/server/repos/__tests__/budget-periods.test.ts` — new
- `e2e/budget-detail.visual.spec.ts` — new

### Data and migration

`budget_periods` exists from `00-S7`: `(budget_id, period_start, period_end)`, `limit_minor`,
`carried_in_minor`, `spent_minor`, `closed_at`. No schema change.

**The table is materialised on purpose.** A rollover computed on read cannot be audited, cannot be
corrected without rewriting history, and changes retroactively when a past transaction is edited — so
the number a person saw last month would not be the number they see today, with no record of why.

### Server (repo, server function, Zod)

- **Repository.** `budget-periods.ts`: `listPeriods(budgetId)`, `getCurrentPeriod(budgetId)`,
  `closePeriod({ budgetId, periodStart })`, `reopenPeriod`, `recomputeOpenPeriod`.
- **`materialize.ts`** creates the next period when the current one ends, driven by the `7 * * * *`
  cron branch. It is **idempotent per `(budget_id, period_start)`** — a re-run creates nothing.
- **`rollover.ts`** computes `carried_in_minor` for a new period from the **closed** previous period:
  - `none` → `0`.
  - `carry_surplus` → `max(0, limit + carriedIn - spent)`. Overspend does not carry.
  - `carry_all` → `limit + carriedIn - spent`, which may be negative.
  - **A closed period's `carried_in_minor` and `spent_minor` never change.** Editing a transaction in
    a closed period produces a **correction entry in the next open period**, not a rewrite. That is
    the auditability property, and it is why the table exists.
- **Server function.** `loadBudgetDetail` (GET) returning the budget, its periods, its rollover ledger
  and the current period's transactions; plus the close/reopen writes.
- **Zod.** `closePeriod` takes `{ budgetId, periodStart: z.iso.date() }`.
- **Authorisation.** `requireOrg()`; closing a period requires `owner | admin` in a multi-member
  workspace, because it fixes a number everybody else reads.
- **Ledger batching.** No account balance changes. **No rebuild**, stated explicitly.

### UI (route, components)

- **Route.** `/budgets/$budgetId`, SSR default.
- **Components.** Reuses `Table`, `Meter`, `Tabs`, `Dialog`, `Badge`, `data-table`. New:
  `rollover-ledger.tsx`, `period-timeline.tsx`. The category breakdown chart comes from plan `16` and
  is rendered, not built, here.
- **States.** Empty (a brand-new budget with one open period): the timeline shows one period and says
  so rather than rendering an empty chart. Skeleton: the header block, the timeline's shape, six
  table rows. Error: `ErrorPanel` per section.
- **Tokens.** None new.
- **Accessibility.** `rollover-ledger.tsx` is a real `<table>` with a caption, one row per period, and
  columns _Period · Limit · Carried in · Spent · Carried out_. **Every figure has its currency**, and
  a negative carry is rendered with a minus sign and the word _over_, not only in red. The timeline is
  the chart-frame primitive with its required visually-hidden data table (`00-S10`), so the same
  numbers are available in two forms.

### Quota

No new metric; the budget was counted at creation (`12-S1`).

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A attempts `listPeriods`, `closePeriod`, `reopenPeriod` and
`recomputeOpenPeriod` on B's budget, and `loadBudgetDetail` on B's budget id. Every one is a
`NotFoundError`; B's periods keep their `closed_at`. Functions covered: all five plus the loader.

### Money invariant

**A closed period is immutable, and the carry chain is exact.** Cases in `money-invariants.test.ts`:

- _a closed period's `carried_in_minor` and `spent_minor` never change_ when a transaction inside it
  is edited or deleted; a correction appears in the next open period instead.
- _the carry chain telescopes_: for `carry_all` over six periods, `carriedOut(n) = limit(n) +
carriedIn(n) - spent(n)` and `carriedIn(n+1) = carriedOut(n)` exactly, with no rounding step
  anywhere — every value is an integer sum of integers.
- _`carry_surplus` floors at zero_ and the overspend is **not** silently absorbed: it is reported in
  the ledger's _Carried out_ column as `0` with an _over by X_ annotation, so the information is not
  lost.
- _materialisation is idempotent_: running the cron branch twice creates one period.
- _a period's `spent_minor` at close equals the utilisation the screen showed_, asserted by computing
  both and comparing — the stored number and the displayed number must never be produced by two
  different code paths, and this case is what stops that.

### Verification

- Command gate.
- `rollover.test.ts`: the three policies, the telescoping chain over six periods, the floor case, and
  a negative-carry period followed by a surplus one.
- `budget-periods.test.ts`: idempotent materialisation, the immutability case, the correction-entry
  behaviour, the isolation cases.
- Browser evidence: `/budgets/$id` for a **`carry_all` budget with six periods including one
  negative carry**, both themes, at 360 / 1280 / 2560 px, plus the **close-period confirmation** and
  a **correction entry visible in the open period** — the correction is the point of the auditability
  design and a resting ledger is not evidence about it.
- `e2e/budget-detail.visual.spec.ts` runs axe on the route: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

**`OPEN-5` blocks the `carry_all` overspend behaviour.** The mechanism ships (a negative
`carried_in_minor` is representable and the chain telescopes correctly); what is undecided is the
**product** answer for what the budget detail screen tells somebody whose envelope is negative, and
whether `carry_all` is offered at all in v1. `none` and `carry_surplus` are uncontested and ship
regardless. The stage does not choose.

---

## Stage 12-S3 — Threshold alerts

### Stage id

`12-S3` · Wave 3 · effort **S**.

### Reference rows

`BUD-07 missing → done` — threshold crossing detection and its notification dispatch.

### Owned paths

- `src/server/budgets/thresholds.ts` — new
- `src/server/cron/budget-thresholds.ts` — new
- `src/server/budgets/__tests__/thresholds.test.ts` — new

### Data and migration

None. The dedupe marker lives in KV, keyed `budget:threshold:v1:<budgetId>:<periodStart>:<threshold>`,
written **after** dispatch so a failed dispatch retries rather than being silently swallowed.

### Server (repo, server function, Zod)

- `thresholds.ts` exports `findCrossings({ scope, now })`, returning `{ budgetId, periodStart,
threshold, spentMinor, limitMinor }` for each threshold newly crossed since the last marker.
- It runs from the `*/15 * * * *` cron branch, **per workspace, per scope** — never as one
  cross-tenant query.
- Dispatch is `21-S1`'s `dispatchQuietly` with the events `budget.threshold_crossed` and
  `budget.exceeded`. This stage detects; plan `21` delivers. That split keeps the notification
  channels in one place.
- **Ledger batching.** None; reads only.

### UI (route, components)

None. The notification surfaces are plan `21`; the meter states are `12-S1`.

### Quota

No countable row. The cron cost is one query per workspace per 15 minutes and is the line in
`docs/ARCHITECTURE.md` §7.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: `findCrossings` in A's scope returns only A's budgets, and A's
dedupe markers do not suppress B's identical crossing. Function covered: `findCrossings`.

### Money invariant

_A threshold is crossed on an integer comparison against the same `spent_minor` the screen shows._
Cases:

- _the crossing comparison uses `spent >= limit × threshold / 100` in integer arithmetic_, with the
  multiplication before the division so no intermediate rounding occurs.
- _a threshold fires once per period_, and the marker is written after dispatch, so a dispatch failure
  retries.
- _a refund that brings spend back below a threshold does not re-arm it within the same period_ —
  re-arming would notify somebody twice for one overspend, and the marker's presence is the guard.
- _crossing is evaluated against the period's `spent_minor`, not a live recomputation_, so the alert
  and the screen agree.

### Verification

- Command gate.
- `thresholds.test.ts`: the four money cases, the per-scope iteration, and a 100%-threshold budget
  that goes from 99% to 101% in one transaction firing exactly one crossing.
- A local `wrangler dev --test-scheduled` invocation for `*/15 * * * *` showing one dispatch and the
  marker written afterwards.
- No browser evidence and no axe run: no surface.

### Definition of done

§7 items 1–3 and 5–7. Item 4 does not apply (no surface).

### Blockers

**A dependency on plan `21`**: `dispatchQuietly` must exist before this stage can dispatch. Plan `21`
is wave 5 and this stage is wave 3, so the detection ships first and calls a **no-op dispatcher** that
`21-S1` replaces. The no-op is a named export with a test asserting it is replaced — a permanent no-op
is a silent feature failure.
