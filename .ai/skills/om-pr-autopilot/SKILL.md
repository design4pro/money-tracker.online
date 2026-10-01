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
carries `promotion`, ends at merge-ready under `--allow-merge` too: the `develop` -> `main`
promotion deploys production and is the owner's to merge.

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
- **The dev server URL is `baseUrl` in `.ai/qa/test-env.json`** (`om-prepare-test-env` writes it).
  Never derive it from `.dev.vars`, which the agent never reads.
