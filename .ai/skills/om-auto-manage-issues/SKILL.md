---
name: om-auto-manage-issues
description: money-tracker.online extension of the installed om-auto-manage-issues skill. Human-hold labels, category mapping and trigger-label hygiene.
---

Extends the installed skill: read `.claude/skills/om-auto-manage-issues/SKILL.md` and follow it. On top:

- Human-hold labels (skip the issue entirely): `blocked`, `do-not-close`, `do-not-merge`.
- `groom` is the human "re-groom" trigger label: remove it from an issue as the first mutation when present. Never add `groom`, `autofix` or `spec`; a human decides when an issue starts implementation.
- Category comes from the issue form (`.github/ISSUE_TEMPLATE`): a bug report is `bug`, an enhancement is `feature`, a maintenance item is `refactor`; Dependabot is `dependencies`.
- The Definition of Ready is in `SDLC.md`; the not-ready comment names the missing ticket-level items and points at the issue form section that holds each.
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
- **A spec parent is exempt from `needs-triage`.** An issue whose body starts with `Spec: .ai/specs/`
  is a parent: `afk-to-tickets` slices it into tickets and promotes their frontier, so triage has
  nothing to brief. Groom it for labels and readiness as usual, but never add `needs-triage` to it,
  and never leave that decision to a human in the report or a comment.
- **Settle, do not ask.** Grooming runs unattended, so the installed skill's "the not-ready comment
  names what a human must add" is narrowed here to what only the reporter knows (a repro, a
  version, what they expected). Everything else is settled in this run through
  `.ai/skills/afk-decide/SKILL.md` and never makes the issue `not-ready`:
  - A missing **Out of scope** section is written by this run: ask the product owner specialist for
    it, append it to the issue body with **update-issue** under an `## Out of scope` heading marked
    as agent-written, and record the verdict as a Resolved assumptions row in the groom comment.
  - An open question (product, design, scope, naming) is put to the fitting specialist and
    recorded as a non-blocking Resolved assumptions row (`# | Question | Applied default | Why`) in
    the groom comment. It is never addressed to the issue author and never makes the issue
    `not-ready`.
  - "A human's call", "decided by a maintainer" or similar wording copied into a ticket from a spec
    or an earlier comment is an open question like any other, never a blocker: settle it the same
    way.
- Implementation notes must name the owner module for each concept (`docs/SPEC.md` §8) and warn when the change would touch a protected surface in `BACKWARD_COMPATIBILITY.md`. An issue whose ask is listed in `docs/agents/out-of-scope.md` is reported as out of scope with the row's ADR, never groomed into a ticket.
