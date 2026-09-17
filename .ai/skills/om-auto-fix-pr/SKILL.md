---
name: om-auto-fix-pr
description: Repo-local extension of om-auto-fix-pr - the `review-threads` trigger label the run consumes, and the open-thread exit criterion the stabilization loop gets.
---

# om-auto-fix-pr (money-tracker.online)

This file extends the shared `om-auto-fix-pr` skill installed at
`.claude/skills/om-auto-fix-pr/SKILL.md`. Follow its full workflow with the two additions below.

## `review-threads` is a trigger label, and the run consumes it

When the PR carries `review-threads`, remove it as the run's **first** tracker mutation, before the
claim - the same contract `autofix` has on an issue, so a label still present is a run nobody took.
The `claude-review` job applies it when it leaves live threads
(`scripts/ci/review-threads-label.mjs`), and the **Resolve blocking review threads** automation turns it into this
run; leaving it on would let the next poll start a second run beside this one. Removing it is also
what re-arms the trigger: the job re-applies it on the next head that still has open threads. Never add `review-threads` to any PR.

## An open thread ends the loop, it does not pass it

One addition to the stabilization loop's exit criteria:

- Before declaring the review approvable, run **list-review-threads** and require zero threads that
  are unresolved and not outdated. An open thread that the `om-auto-review-pr --autofix` stage fixed
  but did not resolve is closed here with **reply-review-comment** and **resolve-review-thread**
  (the repo override of `om-auto-review-pr` says how). An open thread the stage declined stays open
  and ends the loop with `changes-requested`, never `merge-queue`; the final report names the thread
  and its reason so a human can settle it.

Unlike `planned.travel`, this repository's `develop` ruleset does not carry
`required_review_thread_resolution`, so an open thread does not physically block the merge here.
The criterion above is the skill's own, and it is the reason the automation is worth having: a
thread nobody answers is feedback that quietly disappears at the squash.
