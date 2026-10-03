---
name: om-pr-autopilot
description: Repo-local extension of om-pr-autopilot - the PR state is re-read before every push, because a human may merge or close the PR mid-run, and the limits of an unattended run.
---

# om-pr-autopilot (money-tracker.online)

This file extends the shared `om-pr-autopilot` skill installed at
`.claude/skills/om-pr-autopilot/SKILL.md`. Follow its full workflow with the additions below.

## Re-read the PR state before every push

Diagnosis reads the PR state once, at the start, but a human may merge or close the PR while the
run works. This rule covers every push the run makes, including those of the skills it chains
that push to the PR head (`om-auto-continue-pr`, `om-auto-continue-pr-loop`, `om-auto-fix-pr`,
`om-auto-review-pr --autofix`), whether or not their own overrides were read:

- Immediately before each `git push` to the PR head, run **get-pr** and read `state`. Keep the
  check and the push in one command so nothing runs between them.
- Anything other than `OPEN` stops the run: do not push, release the claim, post one comment
  saying why the run stopped, and report the commits that were not pushed.

GitHub deletes a merged PR's head branch, and a push to it recreates that branch on the remote.
It happened on #447 (2026-09-24): the PR was merged while the base-merge gate ran, and the push
that followed brought `ci/vps-only-runners` back.

## "Approvable" follows the ruleset

A PR is approvable (state matrix row 9) when no review requests changes, no review thread is
unresolved, and the base branch's ruleset requirements for approvals and code-owner review are met.
With `required_approving_review_count: 0` and no code-owner review, that holds without any
approving review: read the ruleset as `.ai/skills/om-approve-merge-pr/SKILL.md` § Rules says. A
missing approval this run cannot give itself (its own account authored the PR) is not a reason to
stop at merge-ready under `--allow-merge` when the ruleset requires none.

`--allow-merge` means a merge into `develop` only. A PR whose base is not `develop`, or that
carries `do-not-merge`, ends at merge-ready under `--allow-merge` too: the `develop` -> `main`
promotion deploys production and is the owner's to merge.

## A spec PR the plan-to-spec run opened merges

The installed skill treats a spec-only design PR as draft-by-intent
(`.claude/skills/om-pr-autopilot/references/state-matrix.md`, `.claude/skills/om-auto-fix-pr/references/pr-finalize.md`),
and `om-approve-merge-pr` refuses a draft, so a spec-only PR ends at merge-ready and a person merges
it. One kind is the exception, because a specialist panel has approved it before the PR exists
(ADR 0030, which amends ADR 0027): a spec-only PR that **all** of these describe merges under
`--allow-merge` like any other PR into `develop`:

- its branch is `spec/<slug>` and the `plan-to-spec` workflow or `afk-plan-to-spec` opened it: the
  panel's verdicts and a Resolved assumptions table are in its body, and its spec's metadata table
  has a `Plan` row where an `Issue` row would be;
- it is ready for review (a draft is the not-approved path of `afk-plan-to-spec` step 5, which also
  puts `blocked` on it);
- it does not carry `blocked`, `do-not-merge` or any other hold.

Every other spec-only PR keeps the person's merge, the `spec` workflow's and a spec task's
(`implement-ticket`; an `Issue` row and no `Plan` row) among them. A docs-only PR on a `docs/plan-delivered-<slug>` branch (`afk-plan-to-spec` marking
stages the code already delivers) is not a spec-only PR: no draft-by-intent applies, and it merges
under `--allow-merge` like any docs-only PR.

## Unattended-run limits

These hold for every skill this run chains, whether or not its own override was read:

- **A lesson goes into the PR, never outside the worktree.** Write it in a `## Lessons` section of
  the PR body, or of the run handoff when no PR exists, where `afk-lessons` collects it. Never edit
  `~/.claude/CLAUDE.md` or any other file outside the worktree, and never end a run asking a human
  to move a lesson there: a cezar run is refused that write, and two runs failed trying.
- **A fix that needs a protected file ends with the patch, not a workaround.** Claude Code refuses
  writes to `.husky/*`, `.claude/settings.json`, `.claude/hooks/*` and `worker-configuration.d.ts`
  under `dontAsk` (ADR 0025). When the fix needs one, do the rest of the work, then put the exact
  patch for that file in the PR body and the report, together with a configuration guardian verdict
  from `.ai/skills/afk-decide/SKILL.md`, so applying it is one step for a human. Never retry the
  write through `cp`, `sed`, a heredoc or another path, and never route the whole ticket to a human
  in advance because one file is protected: #480-#482 went to a human only for
  `worker-configuration.d.ts` (run ee7c7d1a).
- **A denied command ends the run, so never try one.** `permissions.deny` in
  `.claude/settings.json` refuses it and `dontAsk` turns the refusal into a failed run: run d232173a
  (#499) died on `git reset --hard origin/<head>`. Use the allowed equivalent (AGENTS.md): move a
  worktree to a PR head with `git status`, `git fetch origin <head>`, then
  `git checkout -B <head> origin/<head>` (when another worktree holds `<head>`, a clean task
  branch takes `git merge --ff-only origin/<head>`); after a rebase, merge the base or push a new
  branch instead of force-pushing (`--force-with-lease` included); fix what a hook reports instead
  of using `--no-verify`.
- **The dev server URL is `baseUrl` in `.ai/qa/test-env.json`** (`om-prepare-test-env` writes it).
  Never derive it from `.dev.vars`, which the agent never reads.
