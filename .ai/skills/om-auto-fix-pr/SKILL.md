---
name: om-auto-fix-pr
description: Repo-local extension of om-auto-fix-pr - the open-thread exit criterion the stabilization loop gets.
---

# om-auto-fix-pr (money-tracker.online)

This file extends the shared `om-auto-fix-pr` skill installed at
`.claude/skills/om-auto-fix-pr/SKILL.md`. Follow its full workflow with the addition below.

## An open thread ends the loop, it does not pass it

One addition to the stabilization loop's exit criteria:

- Before declaring the review approvable, run **list-review-threads** and require zero threads that
  are unresolved and not outdated. An open thread that the `om-auto-review-pr --autofix` stage fixed
  but did not resolve is closed here with **reply-review-comment** and **resolve-review-thread**
  (the repo override of `om-auto-review-pr` says how). An open thread the stage declined stays open
  and ends the loop with `changes-requested`, never `merge-queue`; the final report names the thread
  and its reason so a human can settle it.

The live `develop` and `main` rulesets both set `required_review_thread_resolution: true`, so an
open thread blocks the merge. The criterion above also keeps the skill from reporting an
approvable PR while a finding still needs an answer.

## Re-read the PR state before every push

The claim step stops on a merged or closed PR only at the start. Immediately before each
`git push` to the PR head (base merge, CI fixes), run **get-pr** and read `state`, in the same
command as the push. Anything other than `OPEN` stops the run: do not push, release the claim,
post one comment saying why the run stopped, and report the commits that were not pushed. A push
to a merged PR's head recreates the branch GitHub deleted on merge (#447, 2026-09-24).
