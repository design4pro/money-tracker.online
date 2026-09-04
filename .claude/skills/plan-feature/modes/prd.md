# Mode `prd`

Goal: the same issue becomes a `prd/v1`, titled `PRD: …`, concrete enough that a ticket agent
implements against it without re-deriving decisions.

## Preconditions

- The body carries `spec/v1` (or `prd/v1` for a revision). Otherwise tell the human to run `spec`
  first and hand back.
- "Open questions" is empty. Each open question becomes a grilling round first; one the human
  cannot resolve stops the mode (hand back with the reason; the spec stays at review).
- Concept ownership: no open PRD and no remaining docs/plans/ area owns a concept this PRD needs
  (SPEC §8). Name the overlap and ask before writing anything.

## Rounds

1. Solution shape: the one approach, with the alternative you rejected and why.
2. User stories: propose the numbered list (`As an <actor>, I want <feature>, so that <benefit>`,
   long rather than short), ask what is missing or wrong.
3. Implementation decisions: the decisions an implementer must not re-open (data ownership,
   server-function contracts, quota and tenancy rules, locale handling). One round per decision
   that the human could reasonably choose differently.
4. Module table: concept → owning module (one concept, one owner). Ask about every new concept.
5. Testing decisions: confirm the seams from the spec, add the tenant isolation case for any new
   tenant-scoped data path.
6. Out of scope, then restatement with explicit yes.

## Domain changes

A new or changed term goes into CONTEXT.md (glossary only); a decision worth remembering becomes
`docs/adr/NNNN-<slug>.md` (Context, Decision, Alternatives, Consequences). Commit each by path:

```bash
git add CONTEXT.md
git commit -m "docs(domain): <term> (refs #<n>)"
scripts/agent/cez-docs-pr.sh
```

The script opens a draft PR labelled `agent-docs` from a branch cut off `origin/develop`; it is
reviewed with the PRD. Nothing else is committed in this mode.

## Artefact

Write `.agent/plan/prd.md`: the spec sections carried over (edited only where a decision changed
them), then the PRD sections, in this exact order:

```markdown
<!-- schema: prd/v1 -->

## Problem statement
## Goals
## Non-goals
## Success criteria
## Constraints
## Boundaries
## Solution
## User stories
## Implementation decisions
## Testing decisions
## Module table
| concept | owner |
## Out of scope
## Decisions log
## Open questions
None.
## Further notes
```

No file paths or code snippets, with one exception: a prototype-derived shape (state machine,
reducer, schema, type). Cite the SPEC sections touched. Then:

```bash
scripts/agent/publish-prd.sh --check
scripts/agent/publish-prd.sh
```

The script retitles the issue `PRD: …`, adds `prd`, keeps `<details>` and moves the issue to
`status: review`. Tell the human the next mode is `tickets`.
