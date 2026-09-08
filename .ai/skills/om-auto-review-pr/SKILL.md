---
name: om-auto-review-pr
description: Repo-local extension of om-auto-review-pr - QA routing for user-facing changes and the human-only visual judgement this repository keeps (ADR 0016).
---

# om-auto-review-pr (money-tracker.online)

This file extends the shared `om-auto-review-pr` skill installed at
`.claude/skills/om-auto-review-pr/SKILL.md`. Follow its full workflow (claim, worktree, review
engine, verdict, labels, bounded CI follow-up) with the rules below layered on top.

## QA routing

- A PR whose diff reaches `src/routes/**`, `src/components/**`, `src/styles/**` or
  `src/lib/i18n/messages/*` is user-facing: make sure it carries `needs-qa` and not `skip-qa`.
- A PR that only touches docs, CI, tests, `scripts/**`, `.ai/**` or dependencies gets `skip-qa`.

## The visual judgement is a human's

Nothing in CI compares a pixel (ADR 0016). For every `needs-qa` PR, the review body ends with a
section `## 👀 Visual check for the QA reviewer` that names each screen the diff touches and gives
the capture command for it:

```
node scripts/visual/capture.mjs --url http://127.0.0.1:3010/<route> --out <scratchpad>/pr-<n>/<screen> --viewports 360x800,1280x900
```

Frames belong outside the repository. Evidence from `om-auto-qa-pr` complements the pair; it never
replaces it, and only a person applies `qa-approved`.

## Review threads are answered, then resolved

The threads other reviewers leave (a human, an earlier agent pass) are resolved by nobody unless
this skill does it, and a thread nobody answers is feedback that disappears at the squash. Three
additions to step 2 and step 11:

- Step 2, collecting `INHERITED` findings: take the open set from **list-review-threads**
  (unresolved and not outdated), not from **list-review-comments** alone; keep each thread's `id`
  and its first comment's `id` with the finding.
- Step 11, accounting: a finding **fixed** in this run ends with **reply-review-comment** (what
  changed, in which commit) followed by **resolve-review-thread**. A finding **filed as a
  follow-up** ends with a reply naming the follow-up issue, then resolve. A finding **declined**
  ends with a reply giving the reason and the thread stays open, the verdict stays
  `changes-requested`, and the report names it: a human, not the pipeline, closes a disagreement.
  Never resolve a thread without replying in it first, and never resolve one this run did not act
  on.
- Step 11, the fourth outcome: **agreed but out of the run's reach.** Declining is for a
  disagreement, and only a disagreement. A finding you agree with but cannot act on - a hook
  refuses the file, the change belongs upstream, the fix needs a credential a run does not hold -
  ends with a reply that carries **the exact edit as a diff block**, the verdict
  `changes-requested` on the PR, and the thread **resolved**. Resolving is what makes the state
  terminal: an open thread blocks the merge and nothing but a human clicking will ever clear it,
  so a run that agrees and walks away has converted a one-line correction into a permanent stall.
  `changes-requested` is what says a human still owes something; the resolved thread carries what
  they owe. Before you use this outcome on a guarded path, try the edit: `guard-generated.sh` lets
  a run amend a guarded file **this branch already changes**, which is most review findings on a
  pipeline PR. The outcome is for what is still refused after that.
- On a pass without autofix (another author's PR, no `--autofix`) the threads are left as found;
  the report lists them by path so the autopilot's next chain can pick them up.

## Rules

- Never apply `qa-approved` or `qa-self-verified`.
- Never add `review-threads`. It is the human trigger for the `pr-review-threads` automation, and a
  skill that applies it after leaving threads open would start a run on its own work. Name the open
  threads in the report instead and let a person decide.
- Pending CI is not a reason to wait: the browser suite runs on every PR and finishes in minutes.
  Report it as pending and let the bounded follow-up correct the label.
- The `develop → main` promotion PR is reviewed like any other; when its diff is only merge
  commits already reviewed on `develop`, say so and approve.
