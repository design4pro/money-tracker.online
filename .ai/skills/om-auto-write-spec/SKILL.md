---
name: om-auto-write-spec
description: money-tracker.online extension of the installed om-auto-write-spec skill. Repo-specific spec sections and label rules; the installed workflow applies unchanged.
---

Extends the installed skill: read `.claude/skills/om-auto-write-spec/SKILL.md` and follow it. On top:

- `spec` is the human trigger label. Remove it from the issue as the first tracker mutation of an issue-driven run. Never add `spec`, `autofix` or `groom`.
- Every spec under `.ai/specs/` carries two extra sections: **Visual change expected** (routes and states that change on screen, light and dark, desktop and mobile; "none" for backend-only work) and **Copy** (every new user-facing string, as an `en` key name plus text; the implementation lands the key in EN and PL in the same change, per the `i18n-messages` skill).
- Read `CONTEXT.md` for domain vocabulary and `docs/SPEC.md` for the architecture the spec must respect (tenant scoping in `src/server/repos`, Zod on every server-function input, `components/ui` never fetching data, additive D1 migrations). An amount is integer minor units at every layer (`docs/MONEY.md`); cite section numbers rather than restating the arithmetic. Name the owner module of each new concept (`docs/SPEC.md` §8).
- The spec PR is design-only: `Refs #{issueId}`, labels `review`, `documentation`, `skip-qa`, one priority, one risk. Branch `spec/<slug>`.
