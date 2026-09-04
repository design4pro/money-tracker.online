# Mode `spec`

Goal: the issue body becomes a `spec/v1` the human has agreed with, line by line.

## Preconditions

- The issue is open. A body that already carries `spec/v1` or `prd/v1` means a revision: load it,
  and make the first question "what changed?" instead of starting from zero.

## Context, before the first question

1. `gh issue view <n> --json title,body,labels,comments`: the request and every comment.
2. CONTEXT.md for the vocabulary; challenge every fuzzy term in the request against it.
3. docs/SPEC.md sections the request touches (cite them as "SPEC §n"), the ADRs in docs/adr/ that
   constrain it, and the code the request names (Grep, Read).
4. Open PRDs (`gh issue list --label prd --state open --json number,title`) and the remaining
   areas in docs/plans/: an overlap in concept ownership (SPEC §8) is your first question.

## Rounds, in this order (skip what the context already settles)

1. Problem statement: who is blocked, doing what, and why now.
2. Goals, then non-goals: what "done" covers and what it explicitly leaves alone.
3. Success criteria: observable, testable statements.
4. Constraints: tenancy, quotas, locales, performance, the pinned stack (SPEC §3).
5. Boundaries: Always / Ask first / Never for the implementer.
6. Reference product: when the feature mirrors it, ask the human what they observed there
   (surfaces and rules in docs/agents/reference.md); cite as `wiki: <Page-Name>`, never copy.
   You never browse the reference yourself.
7. Test seams: which module boundaries the work will be tested at (the tenant repository
   boundary is the archetype, docs/adr/0002); fewer is better.
8. Restatement: every decision, one line each, explicit yes required.

## Artefact

Write `.agent/plan/spec.md`:

```markdown
<!-- schema: spec/v1 -->

## Problem statement
## Goals
## Non-goals
## Success criteria
## Constraints
## Boundaries
Always: … Ask first: … Never: …
## Decisions log
- <date>: <decision> (round n)
## Open questions
- … or `None.`
```

Every section non-empty, in this order, no file paths or code (they go stale), no `Closes #n`.
Then:

```bash
scripts/agent/publish-spec.sh --check
scripts/agent/publish-spec.sh
```

The script keeps the original request in `<details>`, posts `.agent/plan/grilling.md` as the
`<!-- agent-grilling -->` comment and moves the issue to `status: review`. Tell the human the next
mode is `prd`, and that open questions block it.
