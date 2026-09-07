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

## Rules

- Never apply `qa-approved` or `qa-self-verified`.
- Pending CI is not a reason to wait: the browser suite runs on every PR and finishes in minutes.
  Report it as pending and let the bounded follow-up correct the label.
- The `develop → main` promotion PR is reviewed like any other; when its diff is only merge
  commits already reviewed on `develop`, say so and approve.
