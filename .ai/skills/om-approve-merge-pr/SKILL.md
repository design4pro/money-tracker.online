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

## Rules

- Merging into `develop` is `pr-autopilot`'s job (`om-pr-autopilot --allow-merge`, ADR 0027); a
  person merges the rest. The label rules in `SDLC.md` (`do-not-merge`, `blocked`, `qa-failed`,
  `in-progress`, and `needs-qa` without `qa-approved`) are a convention this skill reads and
  honours; no CI check enforces them (ADR 0027).
- The `develop` to `main` promotion requires a person's release decision. An unattended run
  (`CEZ_TASK_ID` is set, or no person is in the session) merges only a PR whose `baseRefName` is
  `develop`; any other base, or a PR carrying `promotion`, is reported as merge-ready and left for
  the owner. Every PR is authored by the owner's one account, so the author tells nothing apart.
  Do not use the installed skill's GitHub `APPROVE` step on an author's own PR; GitHub does not
  permit it.
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
