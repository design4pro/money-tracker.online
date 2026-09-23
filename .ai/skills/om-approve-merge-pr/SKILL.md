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

- For a `develop` PR without `risk-high` and without `needs-qa`, do not merge it manually.
  After Cezar's current-head review receipt and `merge-queue`, the trusted controller enables
  auto-merge and required checks decide when it lands.
- For a `develop` PR with `risk-high`, verify `risk-approved` and a configured human's
  `Risk approval: <full head SHA>` comment before the manual merge. The author may provide this
  receipt unless auth or money requires a second person's current-head GitHub approval. A PR with
  `needs-qa` also needs current-head QA evidence and a manual merge.
- The `develop` to `main` promotion requires a person's release decision and a manual merge.
  Do not use the installed skill's GitHub `APPROVE` step on an author's own PR; GitHub does not
  permit it. The current-head risk receipt is the policy signal.
- Base `main` and head `develop` → `--merge`. Every other pull request keeps the descriptor's
  `--squash`.
- A promotion that will not merge cleanly is a back-merge of `main` into `develop` first, never a
  rewrite of `main`: `AGENTS.md` forbids the force-push and ADR 0003 records the back-merge as the
  repair.
