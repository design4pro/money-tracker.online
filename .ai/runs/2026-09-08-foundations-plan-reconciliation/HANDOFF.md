# Handoff — 2026-09-08-foundations-plan-reconciliation

**Last updated:** 2026-09-08T15:23Z
**Branch:** `feat/issue-77-foundations-plan-reconciliation`
**PR:** https://github.com/design4pro/money-tracker.online/pull/98 (draft)
**Current phase/step:** Phase 2 Step 2.1 (Phase 1 closed at checkpoint 1)
**Last commit:** `3bfddb2` — docs(specs): record the foundations reconciliation amendments

## What just happened

- Phase 1 shipped in four commits: the parser (`89034aa`), the audit (`d775692`), the class map
  (`bcf2bb9`) and the specification amendment (`3bfddb2`).
- The audit reproduces every number the specification pinned — 56 / 40 / 29 / 27, and 30 under the
  naive rule — so Phase 2 starts from the specification's table rather than re-opening it.
- Two Class E landing sites the specification assumed turned out not to exist. Recorded, not
  smoothed over; the `reorder-menu.test.tsx` entry stays open in Phase 2.

## Next concrete action

- Step 2.1: repoint the 12 Class A entries in `docs/plans/00-foundations.md` at the paths
  `scripts/plans/drift-classes.ts` records, with a sentence at each of the three inlined subjects
  (`enumCheck`, the queue dispatch, the cron switch) saying it is inlined and into what.

## Blockers / open questions

- None.

## Environment caveats

- Dev runtime runnable: not needed; this run ships no rendered surface.
- Browser / UI checks: skipped. `--no-ui` was passed and the specification's _Visual change
  expected_ is **None**.
- Database/migration state: clean. The run never edits `drizzle/`; Step 2.2 asserts that with
  `pnpm db:generate < /dev/null && git diff --exit-code -- drizzle/`.
- `pnpm exec tsx` needs `TMPDIR=/tmp` **in this worktree only**: `tsx` opens a unix socket under
  `$TMPDIR`, and this worktree's cezar temp path is long enough to exceed the socket-path limit
  (`EINVAL: listen`). Nothing in the repository depends on it — the guard runs under vitest, which
  does not use that socket — and no workaround is committed.
- `pnpm test` needs `TMPDIR=/tmp` **in this worktree only**, for a second and unrelated reason.
  `.claude/hooks/__tests__/hooks.test.ts` builds an "orphan" directory with `mkdtemp` and asserts
  `guard-generated.sh` fails closed there because `origin/develop` cannot be resolved. In a cezar
  worktree `$TMPDIR` is `…/money-tracker.online/.ai/cezar/tmp/<run-id>` — inside the main checkout —
  so `git -C <orphan> rev-parse origin/develop` walks up to the repository and answers
  `6ac3c38`. The guard then has an answer, exits 0, and the test reads `expected +0 to be 2`.
  Verified directly: `git -C "$TMPDIR/probe" rev-parse --show-toplevel` prints the repository root.
  The test is correct and the guard is correct; only the temp location is wrong. Nothing about this
  branch is involved, and no test or hook is changed for it.

## Worktree

- Path: `/Users/rafalwolak/dev/cloudflare/money-tracker.online/.ai/cezar/worktrees/6e7d19db-d00d-46cd-b0b2-875977dada41`
- Created this run: no — the existing linked cezar worktree is reused, so there is nothing to clean
  up at the end.
