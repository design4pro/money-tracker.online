# Issue tracker contract

The backlog lives in **GitHub Issues** on `design4pro/money-tracker.online`. `docs/plans/` is the
backlog _source_ (the staged plans); an issue is the execution surface for one stage, one defect or
one idea. Issues are closed when their work merges; a closed issue is the only record we keep, so
there is no doc to rot.

The process around an issue is `SDLC.md` (stages, labels, the QA gate, the claim protocol). This
file is what an issue must contain and how it is written. The `status:`/`run:` vocabulary of ADR
0014 is retired by `docs/adr/0017-om-skills-replace-the-bespoke-agent-layer.md`.

## Reading

```bash
gh issue list --state open --json number,title,labels,body
gh issue view <n> --json title,body,labels,comments
```

## Writing

An agent writes to the tracker through the operations in `.ai/trackers/github.md`, never through
ad-hoc `gh` calls, so every label lands through a guard and every comment carries an idempotent
`🤖` marker. A person uses the same skills or the `gh` commands below.

- **A new issue** comes from `om-prepare-issue <brief>`: it dedupes against open issues and PRs,
  links or authors the covering spec, writes the body below and applies the category, priority and
  risk labels. `.ai/skills/om-prepare-issue/SKILL.md` adds the sections this repository requires.
- **An existing issue** is brought up to standard by `om-auto-manage-issues <n>` (labels, the
  Definition of Ready, a read-only implementation analysis). The issue forms under
  `.github/ISSUE_TEMPLATE/` file with the category label only; the rest is added on triage.
- **Closing** is `om-close-fixed-issues`, run once a merge into `develop` has landed — with the
  merge queue that is minutes after a human merges, not at the click (ADR 0020): a merge into a
  non-default branch does not close an issue natively, so the PR body's `Closes #n` is a promise the
  skill keeps. `do-not-close` on an issue makes housekeeping leave it alone.

```bash
gh issue comment <n> --body-file <file>
gh api -X POST repos/<owner>/<repo>/issues/<n>/labels -f "labels[]=bug" -f "labels[]=priority-high" -f "labels[]=risk-medium"
gh issue close <n> --comment "<why>"
```

## What an issue body must contain

`om-prepare-issue` writes these sections, in this order. A person filing by hand writes the same
ones; `om-auto-manage-issues` reports which are missing.

- **Summary**: the problem or need and who has it. When the issue implements a stage of a plan,
  `Plan stage: NN-Sk` on its own line.
- **Spec**: a link to the covering spec under `.ai/specs/` (features), or `none` with the reason.
- **Analysis**: current behaviour, desired behaviour, and where in the code the seam is, named by
  type, function signature, message key or config shape. _Never file paths or line numbers: they go
  stale while the issue waits._
- **How to implement**: the approach, not the diff.
- **Tenant isolation test**: the case to add to
  `src/server/repos/__tests__/tenant-isolation.test.ts` for every new repository read or write
  path.
- **Money invariant**: the arithmetic property the change must not break and the case in
  `src/server/repos/__tests__/money-invariants.test.ts` that holds it. Mandatory whenever an
  amount, a rate, a currency or a date bucket is touched.
- **Visual change expected**: `none`, or the screens and states whose rendered output changes on
  purpose. Nothing in CI compares a pixel (ADR 0016), so this is the reviewer's only notice.
- **Compatibility notes**: the surfaces in `BACKWARD_COMPATIBILITY.md` the change touches and the
  path it takes.
- **How to pick this up**: the first command to run and the first file to read.
- **Out of scope**: what a reader might reasonably assume is included and is not. Check
  `docs/agents/out-of-scope.md` before filing; a rejected request is not re-filed in new words.
- **Open questions**: each marked blocking or non-blocking. A blocking one unanswered means the
  issue is not ready.

## Definition of Ready

`SDLC.md` → Definition of Ready. In short: a human supplied the problem, the expected outcome and
how it will be checked, the out-of-scope list, and answered every blocking question; a spec (or the
Analysis section for a bug) supplies the rest. `om-auto-fix-issue` stops on an issue that fails
the human tier, and that the `readiness-verifier` sub-agent could not resolve, instead of speccing
around the gap.

## Dependencies

Ordering lives in the plan (`docs/plans/NN-area.md`, stage order) and in the issue body as prose
(`Depends on #n`). There are no native sub-issues or blocking relations to maintain: a stage that
depends on another is filed when the other merges, or names it and waits. Two issues that would
write the same file are one issue (`docs/SPEC.md` §8).

## Migration snapshots

`docs/agents/migration/` holds the `gh label list` and `gh issue list` snapshots taken before each
label migration (`labels-<date>.json`, `issues-<date>.json`), so a relabelled issue can always be
traced back to what it was.

## Ticket format

Applies to tickets the super-board robot files (`/super-collect`, `/super-qa`). Issues written by
hand or by `om-prepare-issue` keep the sections under "What an issue body must contain" above.
`/super-board lint` additionally requires an `## Acceptance Criteria` section before a card runs.

```markdown
## Problem

<1–3 sentences: what is wrong or missing, from the user's side. No implementation plan.>

## Context

- **Where:** <page>, `<route>`
  - a. <step>
  - b. <step>
- **Who:** <who sees it>

![<page> · desktop](https://github.com/<owner>/<repo>/raw/<sha>/<path>.png)

## Fix

<the intended change in 1–3 lines>

## Acceptance Criteria

- [ ] <checkable outcome a test can assert>
- [ ] <checkable outcome>

## Risk

🟢 **Low** · <one line>

## Blocked by

- #<N> — <why> ← or exactly: - None.
```

| Rule                | Value                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title               | `<emoji> [<kind>] <scope>: <what>` · ≤ 70 chars · no ticket number · e.g. `🐛 [bug] receipts: spinner never stops over 10 MB`                               |
| Context             | lettered steps under Where, ONE per line · NEVER arrows · screenshot embedded for UI, NEVER linked                                                          |
| Bugs                | add `## Evidence`: the folded 12-row table (writing-standard.md § 3) · a missing row says `n/a — why`                                                       |
| Acceptance Criteria | 2–5 `- [ ]` lines · each checkable · NEVER "works well", "is fast"                                                                                          |
| Risk                | 🟢 Low · 🟡 Medium · 🔴 High + one line                                                                                                                     |
| Blocked by          | `- #N — why` bullets, or a bare `- None.` · NEVER "None — but #N first"                                                                                     |
| Labels              | `money`, `auth`, `schema` route the merge to a human (merge_policy) · `schema` = destructive only (DROP/TRUNCATE/RENAME); additive migrations need no label |
| Human-only step     | a `needs-you: <command>` line in the PR body → 🙋 Blocked until done                                                                                        |
| Size                | one card = one PR under 400 changed lines (`merge_policy.auto_max_lines`) · bigger → split with `/to-tickets`                                               |
