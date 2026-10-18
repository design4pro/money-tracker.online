---
name: om-approve-merge-pr
description: Repo-local extension of om-approve-merge-pr - the develop → main promotion pull request merges with a merge commit, never a squash.
---

# om-approve-merge-pr (money-tracker.online)

This file extends the shared `om-approve-merge-pr` skill installed at
`.claude/skills/om-approve-merge-pr/SKILL.md`. Follow its full workflow (gate checks, approving
review, merge, optional follow-up, report) with the rule below layered on top.

## The promotion merges; everything else squashes

Step 4 of the installed skill says "Squash-merge. Run tracker operation **merge-pr** - squash is
the default merge strategy per the descriptor." That default is right for a feature branch into
`develop` and wrong for exactly one pull request in this repository.

**A pull request whose base is `main` and whose head is `develop` merges with a merge commit:**

```bash
gh pr merge {prNumber} --merge
```

Never `--squash`, never `--rebase`. `develop` and `main` are two long-lived branches whose whole
relationship is shared ancestry, and the merge commit's second parent is the only thing that tells
`main` it already contains what `develop` contains; a squash writes the content onto `main` under a
commit with no ancestral link to what it flattened, so the next promotion re-proposes it
(ADR 0003, amendment 2026-09-09 - #148 is the promotion that did).

Read the base and the head off the pull request rather than off its title. The promotion is opened
by `.github/workflows/promote-develop.yml` under a fixed title, but a person can open the same pull
request by hand under any title at all.

## The agent full gate is the merge evidence (ADR 0033)

Step 1 of the installed skill treats GitHub **required checks** as the CI gate. After the owner
clears those contexts from the rulesets they will be empty; until then they may still block the
GitHub merge button. Either way this overlay **refuses** `om-approve-merge-pr` into `develop`
unless all of the following hold on the current head:

1. The **newest** conversation comment that contains `<!-- agent-gate-report -->`
   (`.ai/agentic.config.json` → `prVerification.evidenceMarker`) was posted by one of
   `prVerification.evidenceAuthors`, and says `Head: <the full 40-character head SHA>` and
   `Status: green`. An older green comment does not outlive a newer red one, and a comment from
   anyone else is not evidence. Read the head with **get-pr** (`headRefOid`) immediately before the
   merge and merge with `gh pr merge --squash --match-head-commit <that SHA>`, so a push after the
   read makes the merge fail instead of landing ungated code.
2. That comment lists a pass for every `validation.commands` rung, for
   `prVerification.buildCheck` and for `prVerification.browserCommands` (`pnpm e2e
   --project=chromium --project=mobile-chromium` and `pnpm exec tsx .github/a11y/axe-scan.mjs`).
   The browser rungs may read `skipped (change-scope)` only when `node scripts/ci/change-scope.mjs`
   prints `browser=false` for this head: run it yourself and compare. A rung that fails is red even
   when it fails identically on `develop`; the base is fixed first.
3. `Migrations: additive` or `Migrations: none`, matching
   `node scripts/ci/assert-additive-migrations.mjs` (unique journal `idx`, snapshot `prevId`
   chain, no `DROP TABLE` / `DROP COLUMN` in SQL this branch added). Rebase onto `develop` and run
   `pnpm db:generate` when two PRs added migrations from the same parent.
4. Any GitHub required status checks that still remain in the ruleset are genuinely green — never
   bypass them. Do not wait on `vps-ci-*` jobs whose workflows this repository no longer runs.

A local `validation.commands` pass without the posted comment is this run's own notes, not merge
evidence. If staging/`develop` is red, open a fix or revert PR; never push a commit onto
`develop` outside a pull request.

## Rules

- Merging into `develop` is `pr-autopilot`'s job (`om-pr-autopilot --allow-merge`, ADR 0027); a
  person merges the rest. The label rules in `SDLC.md` (`do-not-merge`, `blocked`, `qa-failed`,
  `in-progress`, and `needs-qa` without `qa-approved`) are a convention this skill reads and
  honours; no GitHub Actions check enforces them (ADR 0027). The agent full gate above does.
- The `develop` to `main` promotion requires a person's release decision. An unattended run
  (`CEZ_TASK_ID` is set, or no person is in the session) merges only a PR whose `baseRefName` is
  `develop`; any other base, or a PR carrying `do-not-merge` (the promotion carries it), is
  reported as merge-ready and left for the owner. Every PR is authored by the owner's one account,
  so the author tells nothing apart.
  Do not use the installed skill's GitHub `APPROVE` step on an author's own PR; GitHub does not
  permit it.
- In that unattended run into `develop`, a gate that would ask a person routes back to
  `om-pr-autopilot`'s agents instead (owner decision 2026-10-06, ADR 0031), overriding the
  installed "never resolve a merge gate autonomously" and "the QA gate never routes to automation"
  rules: report the PR not mergeable now and name the route. `needs-qa` without `qa-approved`, a
  stale `QA head:`, and `needs-qa` beside `skip-qa` route to
  `om-auto-qa-pr <number> --self-qa-signoff` on the current head (treat the pair as `needs-qa`);
  `changes-requested` and a `qa-failed` the QA panel set route to `om-auto-fix-pr <number>`. Never
  merge past one of them in this run. A `risk-high` or `security` PR merges with
  `--match-head-commit <head the security verdict judged>` (`.ai/skills/om-pr-autopilot/SKILL.md`). A
  `qa-failed` a person set, an active `qa`, `blocked` and `do-not-merge` still stop and report.
- A second review is not a merge requirement (ADR 0027 removed the mandatory second reviewer). An
  approving review is needed only when the base branch's ruleset asks for one; read it before step
  3: `gh api "repos/{owner}/{repo}/rules/branches/<baseRefName>" --jq '[.[] | select(.type ==
"pull_request") | .parameters] | {approvals: (map(.required_approving_review_count) | max // 0),
codeOwners: (map(.require_code_owner_review) | any)}'`. With `approvals: 0` and
  `codeOwners: false` (true for `develop` today), skip the approval when the run's account
  authored the PR, and go straight to step 4 without asking. Never report "needs an approving
  review from someone other than the author" as a blocker then. Only when the ruleset requires
  approvals or code-owner review and none exists is a missing approval a real blocker.
- Base `main` and head `develop` → `--merge`. Every other pull request keeps the descriptor's
  `--squash`.
- A promotion that will not merge cleanly is a back-merge of `main` into `develop` first, never a
  rewrite of `main`: `AGENTS.md` forbids the force-push and ADR 0003 records the back-merge as the
  repair.
