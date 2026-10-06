# 0031. Agents take every PR to develop

Status: accepted
Date: 2026-10-06
Amends: ADR 0027 (`risk-high` QA no longer stays with the owner), ADR 0029 (the owner's
`qa-approved` on `risk-high` is no longer a brake), ADR 0030 (the WIP limit counts `blocked`,
`do-not-merge` and a parked `changes-requested` only)

## Context

A PR into `develop` could wait for a person in seven places: the QA gate (`needs-qa` without
`qa-approved`), the QA skill withholding its sign-off on `risk-high`, `om-pr-autopilot` stopping at
an unmet QA gate, `om-approve-merge-pr` asking about a stale `QA head:`, a `needs-qa` + `skip-qa`
pair or `changes-requested`, a declined review finding left for a human, `afk-decide` listing
`risk-high` QA as a person's, and the Reconciler and `backlog-status.mjs` treating `needs-qa`,
`risk-high` and `security` as a person's queue. In planned.travel, where the same rules held, PRs
#798 and #880 sat green and behind `develop` because of it.

The owner's decision (2026-10-06), for every project the Reconciler manages: development is
autonomous until the merge into `develop`. Where a person judged, specialist sub-agents judge, from
different sides, and send the work back for fixes. planned.travel records the same decision as its
ADR 0035.

## Decision

- **QA is a panel, on every PR.** `om-auto-qa-pr --self-qa-signoff` signs off `risk-high` and
  `security` PRs too. `manual-tester` always judges the evidence, `accessibility-specialist` joins
  for layout or copy, and `security-tenancy-reviewer` joins for `risk-high` or `security` and
  judges the diff as well. Every member must approve.
- **`risk-high` and `security` merge on a security verdict.** Before merging one, UI or not,
  `om-pr-autopilot` asks `security-tenancy-reviewer` to judge the diff at the current head.
- **A rejection goes back to the agents.** A failed check, `changes-requested`, the panel's
  `qa-failed` and a refused security verdict route to `om-auto-fix-pr`, then review, QA and the
  verdict again. A declined review finding is settled by an independent specialist, not left open
  for a person.
- **Three rounds, then a person.** Each round is a 🤖 `Autopilot round <n>/3` comment on the PR.
  After the third failed round the PR gets `blocked` and a `🤖 HUMAN-ONLY:` comment: the one way the
  loop hands a PR into `develop` to a person.
- **Only a hold (and a parked `changes-requested`) waits for a person.** `backlog-status.mjs`
  counts `blocked`, `do-not-merge` and a parked `changes-requested` against the WIP limit, and the
  Reconciler (cezar `host/reconciler`) updates and merges every other open PR whatever its QA or
  risk labels.

## Consequences

- No person reads a money, ledger, auth, tenancy, billing or migration diff before it reaches
  `develop`. The `develop` -> `main` promotion, which a person merges (`do-not-merge`, ADR 0029), is
  now the one place a person sees those changes before production. (Amended 2026-10-06: the decision extends the specialist-settles-it mechanism (`afk-decide`) to the merge, which is how `AGENTS.md` § Ask First items are settled for the pipeline.)
- More runs and CI per PR: the panel is up to three sub-agents, and a rejected PR runs the chain up
  to three times.
- What still stops: `do-not-merge`, `blocked`, an active `qa` label or a `qa-failed` a person set,
  spec-only PRs other than `afk-plan-to-spec`'s (ADR 0030), and the rest of the `afk-decide` § 5
  list.
