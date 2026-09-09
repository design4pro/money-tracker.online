# Notify — 2026-09-09-issue-18-desktop-layout-density

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-09-09T18:55:00Z — run started

- Brief: implement `.ai/specs/2026-09-09-desktop-layout-density.md` — the width vocabulary and the
  per-surface cap-or-earn decision for the seven `_app` surfaces of issue #18.
- External skill URLs: none.
- Engine decision: `om-auto-create-pr-loop` (steps: 24, `--loop`: no) — the spec's Implementation
  Plan has 24 Steps, above `engine.loopStepThreshold` (20).
- Plan decision: the spec's six "capture and read frames" steps produce no commit (no PNG enters the
  repository) and map onto this engine's checkpoint passes, leaving 18 commit-bearing Steps.
- Plan decision: every Step is `inline`. Each is a one-to-three-line presentational change plus its
  assertion and depends on `DESIGN.md` vocabulary and comment prose the main session already holds;
  executor overhead would exceed the work.
- Spec correction carried into the plan: Step 3.2's rail copy is `recurring.upcoming.empty`, the key
  `UpcomingPanel` actually renders. The spec names `recurring.due.none`, which is a different
  existing key used elsewhere. No new key either way.

## 2026-09-09T19:25:00Z — checkpoint 1 (Steps 1.1 … 1.4)

- Phase 1 closed. `typecheck`, `lint`, `build`, `prettier` green; `e2e/desktop-density.spec.ts`
  18/18 on chromium in both locales; the new case proven red without the cap.
- Twelve frames captured and read at 1440 and 360, light and dark, for `/payees`, `/goals` and
  `/transactions/rules`. Outside the repository, attached to PR #156.
- **Problem, not a blocker:** `pnpm test` reports load-flaky 5s timeouts in
  `.claude/hooks/__tests__/hooks.test.ts` and
  `src/routes/_app/dashboard/-server/__tests__/dashboard-data.test.ts`. Both green alone, red as a
  pair, neither reachable from this branch's diff. Five other dev servers were on 3011-3015. CI is
  the arbiter.
- **Decision:** per-Step commits write `pending` in the Tasks table's `Commit` cell and each
  checkpoint backfills the real short SHA. The reference's amend recipe records a pre-amend SHA that
  the amend then makes unreachable, which happened once (`b4a8975`).
- **Observed, not acted on:** `/transactions/rules` rows carry the same void issue #18 describes,
  but that route is not one of the spec's seven surfaces. Recorded, not widened into this PR.
- Environment: `.ai/scripts/test-env-up.sh` → `http://127.0.0.1:3016`.
