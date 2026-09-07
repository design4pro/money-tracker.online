---
name: om-auto-manage-issues
description: money-tracker.online extension of the installed om-auto-manage-issues skill. Human-hold labels, category mapping and trigger-label hygiene.
---

Extends the installed skill: read `.claude/skills/om-auto-manage-issues/SKILL.md` and follow it. On top:

- Human-hold labels (skip the issue entirely): `blocked`, `do-not-close`, `do-not-merge`.
- `groom` is the human "re-groom" trigger label: remove it from an issue as the first mutation when present. Never add `groom`, `autofix` or `spec`; a human decides when an issue starts implementation.
- Category comes from the issue form (`.github/ISSUE_TEMPLATE`): a bug report is `bug`, an enhancement is `feature`, a maintenance item is `refactor`; Dependabot is `dependencies`.
- The Definition of Ready is in `SDLC.md`; the not-ready comment names the missing ticket-level items and points at the issue form section that holds each.
- Implementation notes must name the owner module for each concept (`docs/SPEC.md` §8) and warn when the change would touch a protected surface in `BACKWARD_COMPATIBILITY.md`. An issue whose ask is listed in `docs/agents/out-of-scope.md` is reported as out of scope with the row's ADR, never groomed into a ticket.
