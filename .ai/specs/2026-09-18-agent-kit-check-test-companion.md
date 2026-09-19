# A test companion for agent-kit-check.mjs

| Field              | Value |
| ------------------ | ----- |
| **Status**         | draft |
| **Issue**          | #127  |
| **Spec PR**        | #334  |
| **Implementation** | none  |

## 📝 TLDR

`.ai/scripts/agent-kit-check.mjs` is the first command of the validation gate and, since #126, a
required step of the `verify` job in `ci.yml` - and it is the one kit-rendered script in this
repository with no test companion. `design4pro/agent-kit` should render
`.ai/scripts/__tests__/agent-kit-check.test.mjs` into its consumers, the way it already renders
`.ai/scripts/__tests__/backlog-status.test.mjs` and the `scripts/ci/__tests__` files, so that the
`--base` / `--head` staleness logic is asserted by `pnpm test` here. The test drives the committed
checker as a black box against throwaway git repositories and asserts exit codes and the words each
failure is required to say.

## 📝 Problem Statement

- `pnpm test` runs no case that touches `agent-kit-check.mjs` (issue #127 counts 2452 tests across
  159 files at the time of #126, none of them on it). The checker's `--base` half adds exit 3 and
  several exit-2 paths whose whole purpose is that a misconfiguration is red, never a silent pass.
- The coverage that exists lives in the kit's `test/sync-check.mjs`, section
  `--base: is this branch behind the base's pipeline layer?`. It runs in the kit's own
  `render-parity.yml`, against the kit's template, in a repository with no `vitest`. Nothing runs it
  against the copy committed here, and the copy committed here is what gates this repository's pull
  requests.
- Every other kit-managed script this repository executes ships a companion that the `tooling`
  vitest project already collects (`vitest.config.ts`, include `.ai/scripts/**/__tests__/*.test.mjs`
  and `scripts/**/__tests__/*.test.{ts,mjs}`). The checker is the exception, and the exception is the
  script that can block a merge.
- The failure it guards against has already happened once: #126's review found that on a
  `pull_request` event `actions/checkout` hands the job `refs/pull/N/merge`, a three-way merge takes
  the base's side of the lock, and judging the worktree then passes every stale branch. That is fixed
  by `--head`, and nothing in this repository would notice if a later render lost it.

## 📝 Proposed Solution

The kit renders one new file, `.ai/scripts/__tests__/agent-kit-check.test.mjs`, tier 1, mode
`100644`, into every consumer. It is a vitest file (both consumers' `tooling` project already
collects the path). Each case:

1. creates a temporary directory, `git init`s it and copies the repository's own
   `.ai/scripts/agent-kit-check.mjs` into it at the same relative path - the checker derives `ROOT`
   from its own location, so the copy judges the fixture and never the real checkout;
2. writes a minimal `.ai/agent-kit.lock.json` (`{ "kitVersion": N, "rendered": {} }`) and commits
   the states the case needs, with `kitVersion` set per commit;
3. spawns `node <copy> <args>` with `spawnSync` and asserts `status`, plus the substring of
   stdout/stderr that the checker's contract promises (for example the merge remedy on exit 3, the
   fetch hint on an unresolvable ref, "carries no lock" on a lockless base).

Copying the committed checker rather than importing functions from it is deliberate: the checker is a
top-level script with `process.exit` calls, its exit codes are the contract CI and cezar runs act on,
and asserting them black-box needs no change to the checker at all.

### Alternatives considered

- **Refactor the checker into exported pure functions and unit-test those.** Rejected: it changes the
  checker (a kit-wide change to the one script that judges every other render) to test something the
  process boundary already exposes, and the regressions worth catching - wrong exit code, silent pass,
  wrong remedy - live exactly at that boundary.
- **Run the kit's `test/sync-check.mjs` from this repository.** Rejected: it needs the kit checked out
  beside the repository and runs the kit's `sync`, which is a host action CI here cannot perform (the
  bot PAT is deliberately not scoped to `design4pro/agent-kit`, per the checker's own header).
- **Hand-write the test in this repository only.** Rejected: under agent mode `guard-generated.sh`
  refuses writes under `.ai/scripts/`, and a hand-written file there is not in the lock, so the next
  sync would not know about it and `planned.travel` would not get it. Every other companion is
  kit-rendered for the same reason.

## 📝 Architecture

- **Owner module:** the template `templates/.ai/scripts/__tests__/agent-kit-check.test.mjs` in
  `design4pro/agent-kit`, plus its `manifest.json` entry (tier 1, `100644`) next to the existing
  `.ai/scripts/__tests__/backlog-status.test.mjs` entry, and a `kit.version` bump (the kit's rule:
  every template change bumps it).
- **In this repository** the change arrives as an ordinary kit-sync pull request: the new file, the
  lock (new `rendered` entry, new `kitVersion`), and the `# agent-kit:begin … # agent-kit:end` block
  in `.prettierignore`, all written by `node ../agent-kit/bin/sync.mjs --repo .`
  (`docs/agents/agent-kit.md`). No file outside what the sync writes changes.
- **Runner:** the existing `tooling` vitest project. No config change: its include list already has
  `.ai/scripts/**/__tests__/*.test.mjs`, in this repository and in `planned.travel`.
- **Relation to `test/sync-check.mjs`:** the overlap is deliberate and bounded. `sync-check.mjs`
  keeps proving the kit's tools round-trip (sync writes, check judges, idempotency, executable bits)
  against the template, in the kit's CI. The companion proves the committed copy's `--base`/`--head`
  contract in the consumer's CI. They share a scenario list, not code; the kit has no vitest to share
  code through.
- Nothing touches `src/`, the database, tenant scoping, money or the ledger.

## 📝 Data Model

None. The fixture lock is written into a temporary directory and never into the repository.

## 📝 API Contracts

The contract under test is the checker's CLI, unchanged:

| Invocation (in a fixture repository)                                         | Expected                                                    |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `--base <ref>` whose `kitVersion` is lower than the worktree's               | exit 0, stdout says "not behind"                            |
| `--base <ref>` whose `kitVersion` equals the worktree's                      | exit 0, stdout says "not behind"                            |
| `--base <ref>` whose `kitVersion` is higher                                  | exit 3, stderr carries the merge remedy (`git merge`)       |
| `--base <ref>` naming a commit that carries no lock                          | exit 0, stdout says "carries no lock"                       |
| `--base <ref>` whose lock is malformed JSON                                  | exit 2, stderr says "not valid JSON"                        |
| `--base <ref>` whose `kitVersion` is not a number                            | exit 2, stderr says "cannot be ordered"                     |
| `--base` with no value, and `--base=` with an empty value                    | exit 2                                                      |
| `--base <ref>` that does not resolve                                         | exit 2, stderr names the fetch; never exit 0                |
| worktree is the merge of a stale head into its base; `--base <b> --head <h>` | exit 3 - the case #126's review found                       |
| same merge tree, `--base <b>` without `--head`                               | exit 0 - pinned so the reason `--head` exists stays visible |
| `--head <ref>` without `--base`, or an unrecognised argument                 | exit 2                                                      |

The merge case is built the way GitHub builds `refs/pull/N/merge`: a head branch cut at version N, a
base that moves to N+1 in a commit the head never saw, and a real `git merge --no-ff` of head into
base whose tree therefore carries the base's lock.

## 📝 UI/UX

None. This is a test file in the tooling layer.

## Visual change expected

None - tooling-only work with no rendered surface in any route, theme or viewport.

## Copy

None - the file adds no user-facing string, so nothing lands in the EN or PL catalogue.

## 📝 Edge Cases & Failure Scenarios

- **Git identity and signing on the runner.** A commit in the fixture must not depend on the
  developer's or the runner's global git config: pass `-c user.name=… -c user.email=…
-c commit.gpgsign=false -c init.defaultBranch=develop` on every call (or the equivalent `GIT_*`
  env), and never read the caller's hooks (`-c core.hooksPath=/dev/null`). Otherwise the case fails on
  a machine with signing enabled and passes on CI.
- **Inherited environment.** `GITHUB_ACTIONS` and `CEZ_TASK_ID` do not change the checker's
  behaviour, but git variables such as `GIT_DIR` or `GIT_WORK_TREE` would point the fixture at the
  real repository. The spawn strips every `GIT_*` variable before adding its own.
- **Cleanup.** Each fixture directory is removed in `afterEach`/`afterAll`; a failing case must not
  leave directories behind that a later case trips over.
- **Speed.** Each case forks `git` a handful of times and `node` once. One shared fixture repository
  with named branches (the shape `sync-check.mjs` uses) keeps the file well inside the `tooling`
  project's 15000 ms `testTimeout`; per-case fresh repositories are only needed where a case mutates
  shared state.
- **A render that changes the checker's wording.** The assertions match short, contract-bearing
  substrings (`not behind`, `carries no lock`, `git merge`, `does not resolve`), not whole messages,
  so rewording a sentence does not break the test while dropping a remedy does.
- **What a failure here means.** The file is rendered, so a red case in this repository is fixed in
  the kit's template and re-synced, never by editing either copy here (`docs/agents/agent-kit.md`).

## 📝 Risks & Impact Review

- **Blast radius:** one new test file in `tooling`. It cannot change a gate's verdict except by adding
  a red case, and it touches no runtime code.
- **Backward compatibility:** no surface in `BACKWARD_COMPATIBILITY.md` changes; the checker's CLI is
  asserted, not modified.
- **Delivery path:** the file is kit-rendered and lives under `.ai/scripts/`, which
  `guard-generated.sh` blocks for agent runs, so an unattended run in this repository cannot land it.
  The change is made in `design4pro/agent-kit` and arrives here through a host-run sync.
- **Rollback:** revert the sync pull request here, or remove the manifest entry in the kit and
  re-sync. Nothing else depends on the file.

## Resolved assumptions (autonomous defaults)

| #   | Question                                                                                  | Applied default                                                                                                                                                                             | Why                                                                                                                                      | Confirm?                   |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Q1  | Who delivers it, given `.ai/scripts/` is agent-blocked here and the file is kit-rendered? | The kit's template and manifest change first, then a host-run sync pull request here that `Closes #127`. An `autofix` run in this repository is not the delivery path.                      | Every rendered file moves this way (`docs/agents/agent-kit.md`), and `guard-generated.sh` refuses an agent's write under `.ai/scripts/`. | ⚠ NEEDS HUMAN CONFIRMATION |
| Q2  | Black-box spawn of the committed checker, or refactor it to export testable functions?    | Black box: copy the committed checker into a fixture repository and spawn it.                                                                                                               | No change to the checker; its exit codes are the contract callers act on.                                                                | ok                         |
| Q3  | Which cases?                                                                              | The `--base` paths from #127 plus equal and non-numeric `kitVersion`, the merge-tree case with and without `--head`, and the argument-parser exit-2 paths - one case per API Contracts row. | Every listed path is one the checker's comments document as a silent pass it exists to prevent; each costs one spawn.                    | ok                         |
| Q4  | Also cover the hash half (exit 1 hand edit, exit 1 executable bit, exit 2 missing file)?  | No - defer. `sync-check.mjs` covers it in the kit, and #127 scopes the gap to `--base`.                                                                                                     | Smallest scope that closes the stated gap; can be a later companion case.                                                                | ok                         |
| Q5  | Share code with `test/sync-check.mjs`?                                                    | No. Share the scenario list, keep two files.                                                                                                                                                | The kit has no vitest and CI here cannot fetch the kit; the two files test different copies.                                             | ok                         |
| Q6  | Split into more than one spec?                                                            | No - one file, one capability.                                                                                                                                                              | Nothing here ships independently of the rest.                                                                                            | ok                         |

## 📋 Phasing

One phase: the template, its manifest entry and the `kit.version` bump in `design4pro/agent-kit`,
followed by the sync pull request in this repository (and the same sync in `planned.travel`, which
the kit owns scheduling).

## 📋 Implementation Plan

### Phase 1 - render the companion

1. **In `design4pro/agent-kit`:** add `templates/.ai/scripts/__tests__/agent-kit-check.test.mjs` with
   the kit-managed header the other companions carry, the fixture helper (temp dir, sanitised `git`,
   checker copy, lock writer) and one case per row of the API Contracts table. Verify: run it
   under vitest in a consumer checkout against the current checker - every case green.
2. **Prove it catches the regression it is for.** Temporarily make the checker judge the worktree even
   when `--head` is passed; the merge-tree `--head` case must go red, then restore. Verify: the
   failing vitest output is quoted in the kit PR description; the mutation is not committed.
3. **Register it:** a `manifest.json` entry (`tier: 1`, `mode: "100644"`) beside
   `.ai/scripts/__tests__/backlog-status.test.mjs`, and a `kit.version` bump. Verify:
   `node test/sync-check.mjs` and `node test/render-parity.mjs` green in the kit.
4. **Sync this repository** from the host: `node ../agent-kit/bin/sync.mjs --repo .`, branch
   `feat/issue-127-agent-kit-check-test-companion`, PR against `develop` with `Closes #127`. Verify:
   `node .ai/scripts/agent-kit-check.mjs` exits 0 with the new `kitVersion`, and
   `pnpm exec vitest run --project=tooling .ai/scripts/__tests__/agent-kit-check.test.mjs` passes; then
   the full gate from `validation.commands`.
5. **Move this spec** to `.ai/specs/implemented/` with `Status: implemented` and the sync pull request
   in `Implementation`, then `pnpm generate-spec-index`.
