# Handoff — 2026-09-09-issue-18-desktop-layout-density

**Last updated:** 2026-09-09T20:25:00Z
**Branch:** `feat/issue-18-desktop-layout-density`
**PR:** https://github.com/design4pro/money-tracker.online/pull/156 (draft, claimed)
**Current phase/step:** Phase 4 Step 4.1
**Last commit:** `76d758d` — feat(recurring): give the loading picture the same two panes as the screen

## What just happened

- Phase 2 landed in two commits: `/categories` and `/transactions/groups` both capped at
  `max-w-list`, each covering its skeleton and empty state (and, on `/categories`, its error panel).
  Step 2.1 finally exercised the token guard the spec predicted — deleting `--container-list` makes
  `token-classes.test.ts` fail with `max-w-list` in `dead`.
- Phase 3 landed in three commits: `/recurring` is a two-pane grid from `lg` up with `Due soon`
  moved after the series list in the DOM, the rail's 20rem track asserted against collapse, and the
  loading picture given the same geometry through the new shared `RECURRING_PANES` constant.
- Checkpoint 2 passed. `typecheck`, `lint`, `build` and `prettier` green; `pnpm test` 2456/2458 with
  the same two machine-flaky dashboard timeouts checkpoint 1 recorded; 64/64 across
  `desktop-density`, `narrow-viewport` and `accessibility` on chromium in both locales.
- Sixteen frames captured and read, including the `/recurring` 360 before/after pair the spec asks
  for in the PR body.

## Next concrete action

- Step 4.1 — lay the budget list out as `grid gap-4 lg:grid-cols-2` with `items-start` in
  `src/routes/_app/budgets/index.tsx`, leaving `BudgetCard` itself untouched. Verify with a **pair**
  assertion: with ≥3 budgets, two cards share a row at 1440×900 (equal `y`, differing `x`) and each
  is ≤ 620px; one column at 1023px and below.
- Then 4.2 (a single budget renders at `max-w-list`, not at half the grid) and 4.3 (the same through
  `budget-skeletons.tsx` and the filtered empty state), then **checkpoint 3**.

## Blockers / open questions

- none

## Environment caveats

- Dev runtime runnable: **yes** — `sh .ai/scripts/test-env-up.sh` serves `http://127.0.0.1:3016`
  (vite dev, local D1, seeded demo workspace). Stop it with `.ai/scripts/test-env-down.sh`.
- Browser / UI checks: enabled. `pnpm exec playwright test <file> --project=chromium` with
  `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3016`.
- Frames: `.ai/qa/artifacts_issue-18/<phase>/`, outside the repository by `.gitignore:32`.
- Database/migration state: clean — this run touches no schema and regenerates no `drizzle/`.
- `pnpm test` is load-flaky on this machine in
  `src/routes/_app/dashboard/-server/__tests__/dashboard-data.test.ts` and
  `.claude/hooks/__tests__/hooks.test.ts`. Both pass alone; neither is reachable from this branch.

## Worktree

- Path: `/Users/rafalwolak/dev/cloudflare/money-tracker.online/.ai/cezar/worktrees/bbb45f6f-7fb3-4923-ba7e-d450c548032e`
- Created this run: no — reused the Cezar task worktree, branched from `origin/develop`.
