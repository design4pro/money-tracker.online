# 0027. No merge gates

Status: accepted
Date: 2026-09-25
Amends: ADR 0003 (the promotion no longer waits for `merge-gate`), ADR 0017 (the label protocol is a
convention the skills read, not a check), ADR 0020 (`merge-gate` is no longer a required context),
ADR 0021 (the gate scripts it names as governance paths are gone), ADR 0022 (the `gate` runner slot
is folded into `ci`).

## Context

Beside the three CI checks, this repository grew a second layer that decided whether a pull request
could merge: a required `merge-gate` check that read the labels and the comment receipts
(`Risk approval: <sha>`, `QA head: <sha>`), a `trusted-merge-gate` that re-ran it from the base
branch, an advisory `governance-gate` that asked for a `governance-approved` label on decision
documents, and an `auto-merge` controller that enabled GitHub auto-merge on a `Cezar review: <sha>`
receipt once `AUTO_MERGE_ENABLED` was set. Each one came with a test suite, repository variables
(`RISK_APPROVERS`, `QA_APPROVERS`, `CEZAR_REVIEWERS`, `AUTO_MERGE_ENABLED`) and prose in `SDLC.md`,
`CODE_REVIEW.md`, the tracker descriptor and the skills that had to stay in step with the code.

Around them sat tests that pinned text rather than behaviour: the shared region of `SDLC.md` against
the sibling repositories, the agent layer's prompts against each other, the promotion's merge
strategy against the wording of an ADR, and the plan and spec audits over `docs/plans/` and
`.ai/specs/`.

The whole layer guarded a repository with one maintainer, who merges by hand. The reference point,
Open Mercato, runs the same `om-*` skills and the same label vocabulary with none of it.

## Decision

1. `merge-gate`, `trusted-merge-gate`, `governance-gate` and `auto-merge` are deleted, with their
   scripts in `scripts/ci/` and their tests. The rulesets on `develop` and `main` require only the
   three CI checks: `generated · typecheck · lint · build`, `unit tests · coverage` and
   `e2e · merged report`.
2. The label rules in `SDLC.md` stay, as a convention that `om-merge-buddy` and
   `om-approve-merge-pr` read and the person merging honours: `do-not-merge`, `blocked`,
   `qa-failed` and `in-progress` hold a pull request, and `needs-qa` waits for `qa-approved`.
3. `risk-approved`, the `Risk approval:`, `QA head:` and `Cezar review:` receipts, the mandatory
   second reviewer for auth and money, and the rule that CI enforces exactly one `risk-*` label are
   removed. The `risk-*` labels stay as triage information.
4. Merging into `develop` is cezar's `pr-autopilot` workflow, which runs
   `om-pr-autopilot --allow-merge`: the chain ends in `om-approve-merge-pr`, which refuses on
   `do-not-merge`, `blocked`, `qa-failed`, and `needs-qa` without `qa-approved`. It starts on a
   pull request a maintainer opens (**Autopilot new pull requests**) and on an agent pull request
   reviewed into `merge-queue` (**Merge reviewed agent pull requests**, `pull_request.reviewed`, author `design4pro-agent`). The `develop` → `main`
   promotion is authored by a maintainer and opened carrying `merge-queue`, so neither automation
   matches it. Everything else a person merges, by hand or with GitHub's native
   `gh pr merge --auto`. No GitHub workflow enables auto-merge.
5. The `gate` runner slot is folded into the `ci` pool: every job that ran on
   `["self-hosted","linux","X64","gate"]` falls back to `["self-hosted","linux","X64","ci"]`.
6. The text-parity tests (the `SDLC.md` shared region, the agent-layer parity, the promotion
   stand-down and merge-strategy wording, workflow YAML regexes) and the plan and spec audits
   (`scripts/plans/`, `scripts/specs/registry.ts`) are deleted. `pnpm generate-spec-index` keeps a
   lenient parser of its own and still runs in the gate.

## Consequences

- Nothing in CI stops a merge on a label. A `do-not-merge`, `blocked`, `qa-failed` or a `needs-qa`
  without `qa-approved` holds a pull request only because the skills and the person merging read
  it. A `--auto` merge set before such a label was applied still lands when the checks pass.
- A `qa-approved` label is not pinned to a commit any more: a push after the sign-off does not stale
  it by itself. The vendored `om-merge-buddy` and `om-approve-merge-pr` still look for a `QA head:`
  line and treat its absence as a sign-off that predates pinning.
- A change to a decision document (`DESIGN.md`, `BACKWARD_COMPATIBILITY.md`,
  `docs/ACCESSIBILITY.md`, `docs/MONEY.md`, `docs/adr/`) needs no label or receipt; `CODEOWNERS`
  still requests the owner's review. It is `risk-high`, which means a deeper review and no self-QA,
  as the `om-*` skills define it - not a manual merge.
- The shared part of `SDLC.md` can drift from the sibling repositories, a spec's metadata table can
  disagree with its directory, and a plan can name a shared path in its Owned paths, without a test
  failing. Review is what catches them.
- The short jobs that ran on the `gate` slot (`change scope`, the promotion) queue behind whatever
  the `ci` pool is running.
- The repository variables `RISK_APPROVERS`, `QA_APPROVERS`, `CEZAR_REVIEWERS` and
  `AUTO_MERGE_ENABLED` are read by nothing and are deleted from the repository settings.

## Amendment (2026-10-01)

The owner retired the `design4pro-agent` account: every agent action runs as `rafalwolak`. That
changes how this decision tells pull requests apart, not what it decides:

- **Merge reviewed agent pull requests** swaps its `authors` filter from the retired account to
  `rafalwolak`, which it never matched; `merge-queue` tells agent pull requests apart, and the
  author keeps dependabot and outside contributors out of an unattended merge.
- `implement-ticket` no longer stops at an open PR: its last step runs
  `om-pr-autopilot --allow-merge`, so a ticket goes from `ready-for-agent` to `develop` in one run.
- The promotion PR can no longer be told apart by author. `promote-develop.yml` opens it with
  `promotion` as well as `merge-queue`, every PR automation excludes `promotion`, and
  `om-approve-merge-pr` merges unattended only into `develop`. A person still merges the
  promotion.
- QA below `risk-high` is signed off by the run on a QA specialist's verdict (`SDLC.md`, QA gate);
  `risk-high` QA stays with the owner.
