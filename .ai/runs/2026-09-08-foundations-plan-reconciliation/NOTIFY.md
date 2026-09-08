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

## 2026-09-08T15:38:00Z — finding: a red `hooks.test.ts` was the temp directory, not this branch

- `guard-generated.sh, fails closed when the base ref is missing` failed with `expected +0 to be 2`.
  The test builds an orphan directory with `mkdtemp` and expects the guard to fail closed because
  `origin/develop` cannot be resolved there. In a cezar worktree `$TMPDIR` points inside the main
  checkout, so `git -C <orphan> rev-parse origin/develop` walks up and answers — the guard has an
  answer and exits 0. `git -C "$TMPDIR/probe" rev-parse --show-toplevel` prints the repository root,
  which is the whole diagnosis. `TMPDIR=/tmp pnpm test` is green.
- Neither the test nor the hook is touched. Recorded in `HANDOFF.md` under Environment caveats.

## 2026-09-08T15:38:00Z — the guard was watched failing

- Broke `docs/plans/00-foundations.md:500` from `src/server/db/schema.ts` to
  `src/server/db/schema-renamed.ts` and re-ran the guard. Assertion 1 went red naming the stage, the
  line and the path: `00-S5 (line 500)`, the renamed path, "edit declares a file, found absent, and
  no stage declares it new". That is what the plan asked to see before calling it a guard.
- Reverted. `git diff` on the document is empty and the suite is green again: 175 passed.

## 2026-09-08T15:41:00Z — checkpoint 2: Phase 2 closed, and the six-command gate is green

- Steps 2.1–2.4 landed as `5b32bb0`, `ccea7cc`, `da24fbb`, `c6d30ca`; the guard as `f5dffdc`.
- All four audit assertions PASS, from 2 / 27 / 0 / 30 violations at checkpoint 1.
- 34 reference rows before and after — 23 `done`, 2 `partial`, 9 `missing`. No row was deleted.
- Seven declared paths are still absent and every one belongs to a stage with an open reference row.
  That is the backlog the plan is for, not drift.
- All six `validation.commands` pass, both codegen checks with a clean diff. See
  `checkpoint-2-checks.md` and `final-gate-checks.md`.

## 2026-09-08T15:41:00Z — decision: no new reference-row id was minted

- Plan decision D6 reserved `FND-35` on `00-S1` to give assertion 2 coverage there. Measurement made
  it unnecessary: `FND-02` and `FND-18` both resolved to `partial`, which is an open row. Inventing
  an id to satisfy a guard would have been the guard writing the plan, so D6 was dropped.

## 2026-09-08T15:44:00Z — the four follow-ups are filed

- #105 `dependencies` — decide the fate of the unused `@tanstack/react-table`.
- #106 `refactor` — measure, then consolidate the two `amount-field.tsx` components. The issue puts
  the differential test over `parseMoney` and `scaleDecimalString` before any consolidation, because
  whether they agree on a half-way tie is the unmeasured part.
- #107 `documentation` — `docs/plans/OPEN-FINDINGS.md` is promised by `README.md` and does not exist.
- #108 `documentation` — audit and reconcile the 28 unmeasured plan documents.
- All four are referenced back from `docs/plans/00-foundations.md`: #105 and #106 at the Blockers
  entries they came from, #107 and #108 in the stage register, because they belong to the plan set
  rather than to any stage in this document.
