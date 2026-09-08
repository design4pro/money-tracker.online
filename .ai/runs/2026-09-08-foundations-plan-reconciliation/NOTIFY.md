# Notify — 2026-09-08-foundations-plan-reconciliation

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-09-08T15:10:06Z — run started

- Brief: implement `.ai/specs/2026-09-07-foundations-plan-reconciliation.md` — reconcile
  `docs/plans/00-foundations.md` with HEAD and add the parser-backed drift guard (issue #77).
- Engine: `om-auto-create-pr-loop`, selected by an explicit `--loop` on the invocation (the drafted
  plan is 11 Steps, below the configured threshold of 20, so the flag is what routes it).
- External skill URLs: none.

## 2026-09-08T15:10:06Z — decision: the specification's numbers were re-derived before planning

- Re-ran the measurement against `origin/develop` (`f0ce37a`): 56 `Owned paths` entries, 40 distinct
  paths, 29 missing entries under the resolved-glob rule, 27 distinct missing, 30 missing under the
  naive rule, 34 reference rows. Every figure matches the specification, so Phase 2 may start from
  the specification's table rather than re-opening it.

## 2026-09-08T15:10:06Z — decision: the four implementation-affecting corrections from issue #77 are folded into Phase 1

- D1 names the audit `scripts/plans/audit.ts` so it sits inside `pnpm typecheck`; D2 ships guard
  assertion 4 in the Phase 1 audit so Step 2.3's verification is no longer circular; D3 makes
  `drift-classes.ts` a permanent, as-of-dated historical record; D5 lands the two prose corrections
  as an append-only `Amendments` section on the specification. Full rationale in `PLAN.md`.

## 2026-09-08T15:23:00Z — checkpoint 1: Phase 1 (Audit) closed

- Steps 1.1–1.4 landed as `89034aa`, `d775692`, `bcf2bb9`, `3bfddb2`.
- Targeted validation green: `pnpm typecheck` clean, `pnpm lint` 0 errors (2 pre-existing warnings
  in a generated file), `pnpm vitest run --project tooling` 169 passed, prettier clean.
- The audit reproduces the specification's numbers exactly, which is the specification's own gate
  on starting Phase 2.
- Assertion baseline before the rewrite: 2 / 27 / 0 / 30 violations across assertions 1–4.

## 2026-09-08T15:23:00Z — finding: two Class E landing sites the specification assumed do not exist

- No `chart-frame.test.tsx` exists anywhere; `ChartFrame` is covered only through the three chart
  tests that render it. `GridListMoveButton` has no test file at all.
- Recorded in `scripts/plans/drift-classes.ts` and the specification's amendments. The
  `reorder-menu.test.tsx` entry stays open in Phase 2 rather than being repointed at a file that is
  not there. This is the "gap reclassified as shipped" failure the specification calls the real
  risk, caught at classification time rather than by the guard.

## 2026-09-08T15:23:00Z — skipped UI pass, with reason

- No browser evidence this run: the specification's _Visual change expected_ is **None**, the diff
  touches no route, component, token or style file, and `--no-ui` was passed on the invocation.
