# 26 — Onboarding

## Area brief

The first fifteen minutes. A personal finance product's hardest problem is not a feature — it is that
an empty ledger is useless and filling it is work. Onboarding exists to get a new workspace from zero
to a screen that tells its owner something they did not already know, as quickly as honestly possible.

Four paths, offered together and never forced:

1. **Add accounts manually** — the shortest path to a real balance.
2. **Import a file** — the shortest path to real history (plan 19).
3. **Start with a template** — a category set and a starter budget, seeded from a chosen preset.
4. **Explore sample data** — a fully populated demo workspace, clearly marked, deletable in one click.

The rules that govern the area:

- **Nothing here is a modal that blocks the product.** Onboarding is a set of routes and a dismissible
  checklist. A person who wants to skip it can, immediately, from every step, and skipping is not
  penalised or re-prompted.
- **Sample data is never mixed into a real workspace.** It goes into its own workspace named as
  sample, and its transactions are marked with an origin so nothing can silently become real. The
  demo-workspace question (`99-boundaries-and-blockers.md` BND-15) is settled here in its narrow form:
  a **private** sample workspace per user, not a public shared demo.
- **Progress is derived, not stored as a wizard position.** "Has an account", "has a transaction",
  "has a budget" are counts. A stored step index desynchronises from reality the moment someone
  deletes something, and then the checklist lies.

---

## Stage 26-S1 — Workspace creation, the template preset and the checklist

### Stage id

`26-S1` · Wave 6 · effort **L**.

### Reference rows

`ONB-01 missing → done` — the create-workspace flow with base currency, time zone and locale.
`ONB-02 missing → done` — category and budget presets.
`ONB-03 missing → done` — the derived onboarding checklist.

### Owned paths

- `src/routes/onboarding/route.tsx` — new
- `src/routes/onboarding/index.tsx` — new
- `src/routes/onboarding/workspace.tsx` — new
- `src/routes/onboarding/-ui/checklist.tsx` — new
- `src/server/onboarding/presets.ts` — new
- `src/server/onboarding/progress.ts` — new
- `src/server/onboarding/__tests__/presets.test.ts` — new
- `src/server/onboarding/__tests__/progress.test.ts` — new
- `src/routes/_app/-ui/first-run-panel.tsx` — edit
- `e2e/onboarding.spec.ts` — new

### Data and migration

Requisitions into `00-S14`: `onboarding_state` (`workspace_id`, `user_id`, `dismissed_at`,
`sample_workspace_id` nullable, `created_at`), unique on `(workspace_id, user_id)`.

The table stores **dismissal and the sample link only** — never a step index. Progress itself is
computed by `progress.ts` from counts, every time. That is a few extra `COUNT`s on a screen a person
sees for a week, in exchange for a checklist that is never wrong.

### Server (repo, server function, Zod)

- **`createWorkspace`** takes name, base currency, time zone, locale and an optional preset key. It
  creates the organization (Better Auth, `04-S1`), the owner `member` row, `workspace_settings`
  (`23-S2`), the currency row (`03-S3`) and, if a preset was chosen, the preset's categories and
  budget — **in one D1 batch**, so a half-created workspace cannot exist. If the batch fails, nothing
  landed and the person retries; a workspace with settings but no owner is unrecoverable from the UI.
- **Base currency is chosen here and only here** — `23-S2` made it permanently read-only afterwards,
  for the `ref_amount_minor` reason recorded there. The form therefore states, at the point of choice,
  that it cannot be changed later. Telling someone afterwards is the definition of a dark pattern.
- **`presets.ts`** declares two or three named presets (`household`, `personal`, and `minimal`), each
  a typed structure of categories (respecting the depth cap of 2 from `08-S1`) and an optional budget
  skeleton with **no amounts** — a preset that guesses someone's grocery budget is worse than one that
  leaves it blank, because a wrong anchor is stickier than an empty field. Presets are
  **localised**: the `pl` preset is a real Polish category set, not a machine translation of the
  English one.
- **`progress.ts`** returns `{ hasAccount, hasTransaction, hasCategory, hasBudget, hasRecurring,
hasImported, percentComplete }` from scoped counts in a single batched query.

### UI (route, components)

- **Route.** `/onboarding` (the hub), `/onboarding/workspace` (creation). The route tree sits outside
  `_app` for creation (there is no workspace yet) and the hub is reachable from inside the app.
- **Components.** `checklist.tsx` — the derived items, each with a link to the screen that satisfies
  it, a done state, and a **Dismiss** control that hides the checklist permanently with an
  "undo" available in settings. `first-run-panel.tsx` (from `18-S3`) gains its sample-data and
  template actions here — the constant-driven action list that stage built is filled by this stage,
  which is why no route file is edited beyond that one component.
- **States.** Creating; created; **creation failed** (with the form's values preserved — losing a
  filled form on a network blip is the most avoidable frustration in the flow); checklist with 0/6
  through 6/6; dismissed; **already has a workspace** (the creation route redirects rather than
  making a second one by accident).
- **Accessibility.** The checklist is a list with each item's state in text ("Done" / "Not started"),
  never a colour tick alone. Its heading states the progress ("2 of 6 complete") so the number is
  announced without walking the list. The currency and time-zone fields are `ComboBox`es with
  type-ahead over the full lists, labelled, with the current selection announced. No step is
  time-limited (2.2.6 AAA); nothing must be retyped (3.3.9 AAA).

### Quota

`assertWithinLimit('workspaces', ...)` before creating — a person on the free plan can own a bounded
number of workspaces. The sample workspace **counts against a separate, dedicated allowance of one**,
so exploring the demo never consumes the real allowance; that is a named constant, not a special case
in the resolver.

### Tenant isolation test

In `tenant-isolation.test.ts`: `createWorkspace` makes the caller the owner and no one else a member;
a preset applied during creation writes only into the new workspace; `progress` counts only within its
scope, asserted with a second populated workspace present; and `onboarding_state` is per user per
workspace, so one member dismissing the checklist does not dismiss it for another.

### Money invariant

_Onboarding creates structure, not amounts._ Cases in `presets.test.ts`:

- _no preset contains a monetary amount_ — asserted structurally, so a future preset cannot smuggle
  one in.
- _the chosen base currency is written once and every subsequent read agrees_, including
  `workspace_settings`, the currency row and `resolveLimits`'s view.
- _a workspace created with a zero-decimal base currency renders every subsequent amount without a
  decimal separator_, asserted end-to-end by creating with `JPY` and reading a seeded transaction's
  rendering — the case that catches a hard-coded `2` surviving somewhere.
- _the preset's budget skeleton is created with a null amount, not zero_ — zero is a real budget of
  nothing and would immediately report 100% overspent.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `presets.test.ts`: the four money cases; the depth cap; both locales' category sets present and
  non-identical.
- `progress.test.ts`: each flag from empty to satisfied; a deletion moving a flag **back** to
  incomplete, which is the property that a stored step index would get wrong.
- `e2e/onboarding.spec.ts`: create a workspace with a preset; assert the categories exist and the
  checklist reads 1/6; delete the account and assert it reads 0/6.
- Browser evidence at the pinned clock: `/onboarding/workspace` and `/onboarding` in both themes at
  **360 / 1280 / 2560 px**, plus the **checklist at 0/6, part-way and complete**, the **creation
  failure with preserved values**, and the **currency ComboBox open**.
- axe on both routes: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

`OPEN-1` — the workspace allowance per plan. `OPEN-2` — if a household turns out to be linked
workspaces rather than seats, the creation flow gains a "join a household" branch; the flow is built
so that is an added route, not a rewrite.

---

## Stage 26-S2 — Guided setup: accounts, first transaction, first budget

### Stage id

`26-S2` · Wave 6 · effort **M**.

### Reference rows

`ONB-04 missing → done` — the guided account setup step.
`ONB-05 missing → done` — the guided first transaction and first budget steps.
`ONB-06 missing → done` — the import hand-off.

### Owned paths

- `src/routes/onboarding/accounts.tsx` — new
- `src/routes/onboarding/first-entry.tsx` — new
- `src/routes/onboarding/first-budget.tsx` — new
- `src/routes/onboarding/-ui/step-frame.tsx` — new

### Data and migration

None. Every step writes through the **owning plan's** server function — `06-S1`'s `createAccount`,
`07-S1`'s `createTransaction`, `12-S1`'s `createBudget`. Onboarding has **no write path of its own**,
which is what guarantees a transaction created here is identical in every respect to one created
later: same policies, same quota checks, same ledger notification, same `ref_amount_minor`.

### Server (repo, server function, Zod)

None new. The steps compose existing server functions and existing Zod schemas. A separate,
looser "onboarding schema" would be a second definition of validity, and the two would drift.

### UI (route, components)

- **Components.** `step-frame.tsx` — a titled step with a progress indicator, a primary action, a
  **Skip this step** and a **Do this later** that returns to the hub. Skip is always present and never
  visually de-emphasised into invisibility.
- **Accounts step.** Add one to three accounts with name, type, currency and opening balance. The
  opening balance is recorded as a **real balance-adjustment transaction** through
  `06-S3`'s path, dated at the account's start date — not as a magic column. This is the same decision
  plan 06 made, restated here because onboarding is exactly where a shortcut would be tempting and
  would break the balance rebuild's whole-history property.
- **First transaction step.** The full entry form from `07-S3`, pre-focused, with the account
  preselected — not a reduced form, because a person's first transaction teaches them the form they
  will use forever, and a simplified version teaches the wrong one.
- **First budget step.** One category, one amount, one period. Skippable and commonly skipped.
- **Import hand-off.** A link into `/import` (plan 19) with a return path back to the checklist. If a
  person imports, the checklist's `hasTransaction` and `hasImported` both flip on their own, because
  progress is derived.
- **States.** Each step: empty, filled, saving, saved, error, skipped. The hub reflects each.
- **Accessibility.** Each step is its own route with its own `<h1>` and browser history — a wizard
  that hijacks back is a wizard people escape by closing the tab. Progress is announced on entry
  ("Step 2 of 4"). Errors are inline, associated, and never clear the form.

### Quota

Each step's write is quota-checked by the owning plan's function. If a person hits a ceiling during
onboarding, the step shows the same typed error and the same upgrade link as anywhere else — a
special-cased onboarding message would be a second copy to maintain and a second place to be wrong.

### Tenant isolation test

Covered by the owning plans' repositories. This stage adds one e2e assertion: a step reached with a
workspace id in the URL that the person is not a member of renders not-found.

### Money invariant

_An amount entered during onboarding is indistinguishable from one entered later._ Cases in
`money-invariants.test.ts`:

- _an opening balance creates a balance-adjustment transaction whose `amount_minor` equals the entered
  integer_, and the account's computed balance equals it — no separate opening-balance column exists.
- _a transaction created through the onboarding step and one created through `/transactions/new` with
  identical input produce byte-identical rows_ (excluding id and timestamps) — the assertion that
  proves there is one write path.
- _`ref_amount_minor` is computed at the entered `booked_on`'s rate_, even when that date is in the
  past, which it usually is for an opening balance.
- _a budget created here is a null-amount-free real budget_, with its first period materialised by
  `12-S2`'s path.

### Verification

- Command gate.
- Unit: `step-frame`'s skip and later paths; the pre-selection of the account.
- `e2e/onboarding.spec.ts` extended: walk all four steps, then assert the dashboard shows a real
  balance and the checklist reads 4/6; separately, skip every step and assert the product is fully
  usable and the checklist is dismissible.
- Browser evidence at the pinned clock: the three step routes in both themes at
  **360 / 1280 / 2560 px**, plus a **step with a validation error**, a **skipped step's hub state**,
  and the **step progress indicator**.
- axe on all three steps: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 26-S3 — Sample data, tours and the empty-state programme

### Stage id

`26-S3` · Wave 6 · effort **M**.

### Reference rows

`ONB-07 missing → done` — the sample workspace: generate, mark, delete.
`ONB-08 missing → done` — contextual first-visit hints on the main screens.
`ONB-09 missing → done` — the empty-state audit across the product.

### Owned paths

- `src/server/onboarding/sample-data.ts` — new
- `src/server/onboarding/__tests__/sample-data.test.ts` — new
- `src/routes/onboarding/sample.tsx` — new
- `src/routes/_app/-ui/sample-banner.tsx` — new
- `src/routes/_app/-ui/first-visit-hint.tsx` — new
- `docs/EMPTY-STATES.md` — new

### Data and migration

Requisitions into `00-S14`: `workspaces.is_sample` (boolean, default false) via
`workspace_settings`, and `transactions.origin` already exists as `manual|import|recurring|sample`
from `07-S1`'s enum — this stage uses the `sample` value rather than adding a column.

### Server (repo, server function, Zod)

- **`sample-data.ts`** generates a deterministic twelve months of history for a fictional household:
  three accounts (current, savings, credit card), ~40 categories from the preset, ~25 payees, ~600
  transactions including transfers, splits and refunds, three budgets with rollover, two recurring
  series and two goals. It is **seeded from a fixed seed**, so the same sample is byte-identical every
  time — which makes it a usable test fixture as well as a demo, and the visual-regression suite uses
  it rather than maintaining a second seed.
- **Dates are relative to the server clock**, anchored so the newest transaction is yesterday and the
  oldest is twelve months back. Under the pinned clock (`x-mt-server-today`) the output is fully
  deterministic; in production it slides. Both properties are tested.
- **Generation runs as a queue job** (`onboarding.sample`), not in a request — 600 transactions
  through the real write path with a ledger rebuild does not fit a request budget. It runs inside
  `runWithLedgerBatch` (`09-S2`) and writes through the same `createTransaction` as everything else,
  because a sample workspace that behaves differently from a real one demonstrates the wrong product.
- **Deletion** reuses `23-S3`'s purge path with the 30-day window **collapsed to immediate** for
  sample workspaces only — the safety window exists to protect real financial history, and a
  deterministic regenerable demo has none to protect. The exception is a single named flag with a test
  asserting it cannot apply to a non-sample workspace.

### UI (route, components)

- **Components.** `sample-banner.tsx` — a persistent, non-dismissible banner in the app shell while a
  sample workspace is active, stating it is sample data and offering **Delete sample and start
  real**; `first-visit-hint.tsx` — a small, dismissible, keyboard-reachable hint anchored to one
  element per screen, at most **one per route**, never a multi-step spotlight tour. A tour that dims
  the page and marches through eight steps is skipped by most people and is an accessibility problem
  for the rest.
- **Hint dismissal** is per user per hint id, stored in `localStorage` **and** mirrored to
  `onboarding_state` when a session exists, so a hint dismissed on a laptop does not reappear on a
  phone.
- **`docs/EMPTY-STATES.md`** is the audit artefact: one row per route, naming its empty state's
  heading, body, primary action and where that action leads. The audit **finds and fixes** any route
  shipped with a bare "No data" — every plan required an empty state, and this stage verifies the
  claim across the whole product rather than trusting twenty-six separate assertions.
- **States.** Sample: generating (with progress), ready, deleting, deleted. Hints: unseen, seen,
  dismissed.
- **Accessibility.** The sample banner is `role="status"`, not `alert`. Hints are focusable, dismissed
  by `Escape`, return focus to their anchor, and are never the only place a piece of information
  appears — a hint is a shortcut, not documentation.

### Quota

The sample workspace uses the dedicated allowance of one from `26-S1`. Its 600 transactions are
**exempt from the transaction quota**, enforced by the `is_sample` flag inside `assertWithinLimit`
with a test proving the exemption cannot apply to a real workspace — that test is the guard on an
otherwise obvious hole.

### Tenant isolation test

In `tenant-isolation.test.ts`: sample generation writes only into the sample workspace, asserted with
the person's real workspace populated and untouched; the immediate-purge flag is refused for a
workspace with `is_sample = false`; the quota exemption is refused likewise; and a second call to
generate for a workspace that already has sample data is a no-op, not a doubling.

### Money invariant

_Sample data is real data in every arithmetic respect, and it never touches a real workspace._ Cases
in `sample-data.test.ts`:

- _every generated transaction has an integer `amount_minor` and a correct `ref_amount_minor`_ at its
  own `booked_on` rate, including the multi-currency account.
- _the generated ledger balances_: each account's rebuilt balance equals the sum of its transactions,
  every transfer's two legs net to zero in base, and every split's children sum to their parent.
- _generation is deterministic_: two runs under the pinned clock produce identical amounts, dates and
  ids-modulo-id-generation, asserted by hashing the sorted amount and date columns.
- _deleting the sample workspace leaves every other workspace's balances byte-identical_, recomputed
  by the ledger.
- _no sample transaction can be moved into a real workspace_ — the write path rejects a cross-workspace
  move, and the test attempts one.

### Verification

- Command gate.
- `sample-data.test.ts`: the five money cases; the queue job's chunking and idempotency; the
  no-op-on-second-call path; the sliding-date property under a moved clock.
- `e2e/onboarding.spec.ts` extended: generate the sample, land on a dashboard with real charts, delete
  it, and land back on the first-run panel.
- **The empty-state audit is an acceptance criterion, not a document**: `docs/EMPTY-STATES.md` must
  list every route in `src/routes/_app/**`, and a test enumerates the route tree and fails if a route
  is missing from the table. That is what makes the audit stay true after this stage.
- Browser evidence at the pinned clock: the **populated sample dashboard** (both themes,
  360 / 1280 / 2560 px), the **sample banner**, a **first-visit hint open and focused**, and three
  representative **empty states** from the audit.
- axe on the sample dashboard and with a hint open: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None. BND-15's public shared demo remains dropped; the private per-user sample workspace built here is
the substitute and is recorded as such.
