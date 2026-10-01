---
name: om-auto-manage-issues
description: money-tracker.online extension of the installed om-auto-manage-issues skill. Human-hold labels, category mapping and trigger-label hygiene.
---

Extends the installed skill: read `.claude/skills/om-auto-manage-issues/SKILL.md` and follow it. On top:

- Human-hold labels (skip the issue entirely): `blocked`, `do-not-close`, `do-not-merge`.
- `groom` is the human "re-groom" trigger label: remove it from an issue as the first mutation when present. Never add `groom`, `autofix` or `spec`; a human decides when an issue starts implementation.
- Category comes from the issue form (`.github/ISSUE_TEMPLATE`): a bug report is `bug`, an enhancement is `feature`, a maintenance item is `refactor`; Dependabot is `dependencies`.
- The Definition of Ready is in `SDLC.md`; the not-ready comment names the missing ticket-level items and points at the issue form section that holds each.
- **Run the readiness verifier before recording `not-ready`.** When step 6 of the installed
  skill (`references/enrich-existing-issue.md`) finds a ticket-level item missing, follow
  `.ai/skills/om-auto-fix-issue/SKILL.md` § Readiness verifier: `READINESS: VERIFIED` records
  `READY_STATUS=ready` and posts the `readiness verified` comment instead of the not-ready one;
  `NEEDS_HUMAN` records `not-ready` and the not-ready comment lists only the `NEEDS_HUMAN` rows.
  A verified issue is ready for every rule below, including the hand-on to `needs-triage`.
- **Hand the issue on when it is ready.** When the run ends with `READY_STATUS=ready` and the issue
  carries no intake label yet (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`),
  add `needs-triage` as the last mutation of the run, with a one-line rationale comment. That is
  the edge that makes the intake ladder move without a human: `afk-triage` answers `needs-triage`,
  and only it may promote an issue to `ready-for-agent` - grooming never does, because grooming
  does not check that the issue is real, still unfixed on the base branch, or already covered by an
  open PR, and those three checks are what keep `risk-high` and `security` work out of the
  unattended lane. An issue that already carries an intake label is left alone: re-grooming a
  decided issue must not drag it back to the start. On `READY_STATUS=not-ready`, add nothing - the
  not-ready comment is the whole output, and the reporter's answer is what moves it.
  This is an _intake_ label, not a trigger label; the rule above about `groom`, `autofix` and `spec`
  is untouched, and those stay a human's lever.
- Implementation notes must name the owner module for each concept (`docs/SPEC.md` §8) and warn when the change would touch a protected surface in `BACKWARD_COMPATIBILITY.md`. An issue whose ask is listed in `docs/agents/out-of-scope.md` is reported as out of scope with the row's ADR, never groomed into a ticket.
