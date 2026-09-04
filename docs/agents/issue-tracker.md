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

**Under an agent run nothing here is available.** `.claude/hooks/git-guardrails.sh` blocks every
`gh issue|pr` mutation and every non-GET `gh api` when `CEZ_TASK_ID` or `GITHUB_ACTIONS` is set: a
run writes through `scripts/agent/` (`triage-apply.sh`, `publish-*.sh`, `cez-handback.sh`) and reads
through `scripts/agent/gh-ro.sh`. The commands below are a human's, at their own keyboard.

```bash
gh issue create --title "PRD: <title>" --label "type: feature,prd" --body-file <file>   # parent
gh issue create --title "<ticket>" --label "status: queued" --body-file <file>          # sub-issue
gh issue comment <n> --body "<text>"
gh issue edit <n> --add-label "run: implement"                                          # a command
gh issue close <n>
```

A sub-issue is created `status: queued` and reaches `status: ready` only once its `sub_issues` and
`blocked_by` links are verified - which is what `scripts/agent/publish-tickets.sh` does, and the
reason to prefer it over the two lines above (`docs/adr/0014-label-protocol.md`).

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

Because a PRD is never workable, it never carries `run: implement`: a PRD is marked `prd` and stays
`status: in-progress` while any child is open. `auto-advance` on a PRD is how a human delegates the
per-child command to the sweeper.

**Ticket bodies must NOT contain `Closes #n` directives** — closing is the merger's job, and a
`Closes` in a body closes the ticket the moment any branch mentioning it merges, including a branch
that only did half of it.

## What a ticket body must contain

A ticket is a vertical slice, and a slice an agent can act on states all of:

A ticket body is the `ticket/v2` schema, validated by `scripts/agent/plan.mjs` (`check-body`), and
its sections appear in this order:

- One-paragraph **Summary**.
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

**Owned paths** are additionally checked: repo-relative, never under the agent's own configuration
(`.github/`, `.claude/`, `.husky/`, `.ai/cezar/`, `scripts/agent/`), and disjoint between two tickets
the dependency graph does not order. **Definition of Done** carries one to three acceptance criteria
and no more; a longer list is a decomposition problem (`docs/SPEC.md` §8).

A slice that maps onto a plan stage in `docs/plans/` copies these from the stage rather than
re-deriving them; the stage's twelve headings are shaped to fill exactly this list.

## Relationship to `docs/plans/`

The plan set is the **backlog source**; GitHub Issues is the **execution surface**. A plan stage
becomes one PRD (the plan area) plus one sub-issue per stage, published by
`scripts/agent/publish-tickets.sh` at the end of a `/plan-feature … tickets` run.
The plan file remains the authority for scope and acceptance criteria; the issue is where state
lives. When the two disagree, the issue that has already been worked wins and the plan is amended to
say so.
