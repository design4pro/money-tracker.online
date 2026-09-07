---
name: om-auto-fix-issue
description: Repo-local extension of om-auto-fix-issue - how an issue reference is recognised in a Cezar task prompt, this repository's route and UI decisions, and the branch and closing conventions.
---

# om-auto-fix-issue (money-tracker.online)

This file extends the shared `om-auto-fix-issue` skill installed at
`.claude/skills/om-auto-fix-issue/SKILL.md`. Follow its full workflow with the rules below layered
on top.

## An issue reference, not a brief

The Cezar cockpit prefills a run's task with free text such as
`Fix GitHub issue #16: <title> https://github.com/design4pro/money-tracker.online/issues/16`.
A task text that names **exactly one** issue of this repository, whether as a bare number, `#<n>`,
`issue #<n>` or an issue URL under `design4pro/money-tracker.online`, is an **issue reference**,
whatever else the text says: resolve `{issueId}` from it and continue with **get-issue**. Brief mode
(filing a new issue through `om-prepare-issue`) applies only to text that names no issue of this
repository. A text that names two or more is ambiguous: stop and ask.

## Route and UI decision

- The category label decides the route: `bug` takes the bug route, `feature` the feature route
  (Definition of Ready in `SDLC.md`). An unlabelled issue is classified from its body,
  conservatively, and the chosen category label is applied.
- A fix is UI-touching (step 10) when the PR diff reaches `src/routes/**`, `src/components/**`,
  `src/styles/**` or `src/lib/i18n/messages/*`.

## Rules

- `autofix` is the human "start" label a Cezar automation reacts to. Remove it from the issue as
  the **first** tracker mutation of the run (via `remove_issue_label`), before triage, so a
  still-present `autofix` always means "nobody picked this up". Never add `autofix`, `spec` or
  `groom` to any issue.
- Branch `fix/issue-<n>-<slug>` or `feat/issue-<n>-<slug>`, cut from `origin/develop`.
- The PR body carries `Closes #<n>`. Merging into `develop` does not close the issue natively;
  `om-close-fixed-issues` does, after the merge.
- Check `docs/agents/out-of-scope.md` before the feature route: a request listed there is closed
  with the row's ADR as the reason, never implemented.
