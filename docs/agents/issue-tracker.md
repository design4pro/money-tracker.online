# Issue tracker contract

The backlog lives in **GitHub Issues** on `design4pro/money-tracker.online`. PRDs are parent issues;
tickets are sub-issues. Sub-issue list order is execution order. Issues are closed when their work
merges — a closed issue is the only record we keep, so there is no doc to rot.

Set once per session if needed: `GH_REPO=design4pro/money-tracker.online`.

## Reading

```bash
gh issue list --state open --json number,title,labels,body
gh issue view <n> --comments
gh api "repos/$GH_REPO/issues/<n>/sub_issues" --jq '.[].number'   # children, in execution order
```

## Writing

```bash
gh issue create --title "PRD: <title>" --label "type: feature" --body-file <file>   # parent: never `ready-for-agent`
gh issue create --title "<ticket>" --label "ready-for-agent" --body-file <file>     # sub-issue: the label IS the gate
gh issue comment <n> --body "<text>"
gh issue edit <n> --add-label "<label>" --remove-label "<label>"
gh issue close <n>
```

## Sub-issues (PRD → tickets)

```bash
ISSUE_ID=$(gh api "repos/$GH_REPO/issues/<child>" --jq '.id')
gh api -X POST "repos/$GH_REPO/issues/<parent>/sub_issues" -f sub_issue_id="$ISSUE_ID"
```

Check `gh api "repos/$GH_REPO/issues/<parent>/sub_issues" --jq 'length'` before adding, to stay
idempotent.

## Dependencies

Blocking relationships use native GitHub issue dependencies (GraphQL `blockedBy` / `blocking`). A
ticket is workable only when it has zero open blockers and is not itself a PRD with sub-issues.

Because a PRD is never workable, **`ready-for-agent` lives on sub-issues only**: an orchestrator
handed a PRD expands it to its open children and filters those by the label, so a label on the
parent would only ever offer the PRD itself as work.

**Ticket bodies must NOT contain `Closes #n` directives** — closing is the merger's job, and a
`Closes` in a body closes the ticket the moment any branch mentioning it merges, including a branch
that only did half of it.

## What a ticket body must contain

A ticket is a vertical slice, and a slice an agent can act on states all of:

- **Category** and a one-paragraph **Summary**.
- **Current** behaviour and **Desired** behaviour.
- **Fix direction** — the approach, not the diff.
- **Key interfaces** — the types, function signatures and config shapes to look for. _Never file
  paths or line numbers: they go stale while the issue waits._
- **Definition of Done**, which inherits `docs/SPEC.md` §7 unchanged and adds anything specific.
- **Owned paths** — the whole permitted diff, as `` `path` — new|edit `` bullets.
- **Tenant isolation test** — the case that must be added.
- **Money invariant** — the arithmetic property this slice must not break, and the test that holds
  it. Mandatory on every slice that touches an amount, a rate, a currency or a date bucket.
- **Verification** — what to run and what evidence to leave.
- **Out of scope** — what a reader might reasonably assume is included and is not.

A slice that maps onto a plan stage in `docs/plans/` copies these from the stage rather than
re-deriving them; the stage's twelve headings are shaped to fill exactly this list.

## Relationship to `docs/plans/`

The plan set is the **backlog source**; GitHub Issues is the **execution surface**. A plan stage
becomes one PRD (the plan area) plus one sub-issue per stage, published by `/to-tickets-project`.
The plan file remains the authority for scope and acceptance criteria; the issue is where state
lives. When the two disagree, the issue that has already been worked wins and the plan is amended to
say so.
