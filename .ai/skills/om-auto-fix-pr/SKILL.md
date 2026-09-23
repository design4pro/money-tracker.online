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

The `develop` ruleset requires review-thread resolution. An open thread blocks the merge until it
is resolved, even when the automated Claude review is no longer running.
