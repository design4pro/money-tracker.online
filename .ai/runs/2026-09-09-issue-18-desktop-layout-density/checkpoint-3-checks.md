# Checkpoint 3 — Phase 4 closed (Steps 4.1 … 4.3)

**UTC:** 2026-09-09T22:45:00Z
**Steps covered:** 4.1 … 4.3 (`4929a02`, `74fbbff`, `a1f010f`)
**Touched areas:** `/budgets` (route), `budget-card.tsx`, `budget-skeletons.tsx`, the new
`list-layout.ts`, `e2e/desktop-density.spec.ts`, two new unit files.

## Checks

| Check                                                                       | Result                                       |
| --------------------------------------------------------------------------- | -------------------------------------------- |
| `pnpm typecheck`                                                            | **pass** — no diagnostics                    |
| `pnpm lint`                                                                 | **pass** — 0 errors, 2 pre-existing warnings |
| `pnpm build`                                                                | **pass** — built in 2.28s                    |
| `pnpm test`                                                                 | **pass with the same caveat** — see below    |
| `npx prettier --check` on every touched file                                | **pass** — all four unchanged                |
| `e2e/desktop-density.spec.ts` (chromium, both locales)                      | **pass** — 30/30                             |
| `e2e/budgets.visual.spec.ts` + `narrow-viewport` + `accessibility`          | **pass** — 47/47 together                    |
| Red-then-green on the new browser case                                      | **pass** — see below                         |
| Frames for `/budgets` at 1440 + 360, light + dark, plus a 1440 before/after | **captured and read**                        |

### Red-then-green on the new browser cases

- **`/budgets` pairs** (Step 4.1) — with the list still a single column, the `en` case failed on
  `expect(second.x).toBeCloseTo(…)`: the second card measured `x = 244.4375` against the first
  card's `446.4375`, i.e. directly below it. Paired: passes.
- **The filtered-empty panel** (Step 4.3) — the cap removed from the archived-empty `Card`, the case
  re-run in both locales: **failed** on `expect(1156).toBeLessThanOrEqual(912)`. Restored: passes.
  1156 is the full well, which is exactly the fault: a filter that finds nothing was changing how
  wide the page is.

### The two claims a browser could not make

- **A workspace with exactly one budget.** The seeded workspace holds three and the e2e suite only
  reads it, so `budgetListClass(1)` is asserted as a unit case
  (`src/components/app/budgets/__tests__/list-layout.test.ts`) rather than in a browser. The
  decision is a property of the class the list is given, not of the rendered card, and that is
  precisely what the function is.
- **The loading picture.** `BudgetListSkeleton` is a pending component; racing a browser against it
  would assert about how fast a local D1 answers. Instead
  `src/components/app/budgets/__tests__/budget-skeletons.test.tsx` asserts the skeleton's `<ul>`
  carries `budgetListClass(3)` verbatim — the same class the loaded `<ul>` gets for three cards, so
  "skeleton and screen agree" is checked at its source rather than measured twice.

### `pnpm test` — the caveat, unchanged from checkpoints 1 and 2

One failure out of 2462, `Error: Test timed out in 5000ms` in
`src/routes/_app/dashboard/-server/__tests__/dashboard-data.test.ts` ("the recent list"). The two
new budgets files run 4/4 green in 1.08s on their own. Nothing on this branch reaches that file —
this phase's diff is one route module, three component modules, one e2e file and two new unit
files — and it was already flaky on this machine at checkpoint 1, before any of it existed. CI is
the arbiter and the final gate re-runs it.

## Environment

- `sh .ai/scripts/test-env-up.sh` → `http://127.0.0.1:3016`, still up from checkpoint 1.
- Frames: `.ai/qa/artifacts_issue-18/phase-4/` — six PNGs, outside the repository (`AGENTS.md` →
  Never), attached to PR #156.

## What the frames say

- **`/budgets` at 1440, before** — three cards stacked full width. Each card's facts stop at
  x≈770 (`12 days left in this period · zł 11,331.34 carried in · 2 categories`) while its border
  runs to x≈1407, and the meter track is stretched across the whole width, so a 6% bar is a 35px
  sliver at the far left of a 1140px rule.
- **`/budgets` at 1440, after** — `Dom` and `Transport` share the first row at ~570px each,
  `Zakupy spożywcze` opens the second. Each card's rule now ends where its own content ends, and
  `On track` / `Over budget` sits beside the amount instead of a screen away from it. The third
  card's empty right-hand half is the honest remainder of an odd count, not a void inside a card.
- **`/budgets` at 360, light and dark** — one column, unchanged. `lg:grid-cols-2` is the only
  breakpoint touched, and the phone never reaches it.

## Decisions taken in this phase

- **A function, not a ternary at the call site.** `budgetListClass(count)`
  (`src/components/app/budgets/list-layout.ts`) is what both the route and the skeleton import. It
  exists because the interesting part is the decision — one budget takes the list band, two or more
  pair — and a decision that lives inside JSX is one no test can hold without rendering a route.
- **A lone budget is not half a grid.** A single card in `lg:grid-cols-2` is the same void the
  pairing exists to close, moved to the right-hand half rather than removed. It takes `max-w-list`
  instead, which is the answer `/categories` and `/transactions/groups` already give for a screen
  that is one column of content.
- **The card got its own ground** (Step 4.1). The list was a stack of hairline-separated rows; a
  hairline between rows says "the row below is the next one", which stops being true the moment the
  next one is beside it. The `<li>` is now a bordered `surface` card. No `overflow-hidden` — a focus
  ring in this product is an `outline` and nothing may clip one.
- **The unfiltered empty state was left alone.** `BudgetEmptyState` is a dashed, centred call to
  action for a workspace with no budgets at all, not a list that came back empty; the spec's step
  names the layout the list uses, and a centred invitation is not laid out by the list. Only the
  **filtered** empty panel — the one that literally replaces the list — took the band.
