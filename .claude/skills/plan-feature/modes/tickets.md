# Mode `tickets`

Goal: the PRD gets its vertical-slice sub-issues with native dependencies, created as
`status: queued`, the first wave opened as `status: ready` only after every link is verified.

## Preconditions

- The body carries `prd/v1`. Otherwise tell the human to run `prd` first and hand back.
- `scripts/agent/gh-ro.sh issues/<n>/sub_issues --jq length` is `0`. Existing sub-issues mean
  a previous run published: list them and ask whether to add, before writing any plan.

## Slicing rules

- Each slice cuts a narrow but complete path through every layer it needs (schema → repo →
  server function → UI → tests): vertical, never one layer.
- A finished slice is demoable or verifiable on its own and fits one fresh context window.
- Prefactoring is its own first ticket. A ticket never needs sub-tickets.
- Wide, mechanical refactors go expand → migrate in batches (one ticket each) → contract.
- Size `XS`–`L`. `XL` only with `wave: solo`: one concept owns the whole round (SPEC §8), and the
  graph must order every other ticket before or after it.
- Owned paths: the directories and files the ticket may touch, repo-relative, never under the
  agent's own configuration (`.github/`, `.claude/`, `.husky/`, `.ai/cezar/`, `scripts/agent/`).
  Two tickets the graph does not order must not share a path; ordered tickets may.
- Definition of Done: one to three acceptance criteria. Tenant isolation test: the case a new
  tenant-scoped data path must add, or `None: <why>`. Money invariant: which rule in docs/MONEY.md
  the slice has to hold and the test that shows it - never `None` when the slice reads, writes,
  sums or renders an amount. Verification: the commands that prove it (`pnpm typecheck && pnpm lint
  && pnpm test`; UI slices add "visual gate runs in CI").
- Dependencies live only in the graph; a body never mirrors them and never says `Closes #n`.

## Rounds

Propose the whole split first (ids, titles, sizes, blockers, owned paths), then quiz one concern
per round: order, anything that looks horizontal, a ticket too big for one context, a path two
parallel tickets both want. Restatement with explicit yes before writing the plan.

## Artefact

Write `.agent/plan/tickets.json`:

```json
{
  "prd": 123,
  "tickets": [
    {
      "id": "t1",
      "title": "Share link: repository and server function",
      "blockedBy": [],
      "ownedPaths": ["src/server/repos/share.ts", "src/server/functions/share.ts"],
      "estimatedScope": "S",
      "body": {
        "summary": "…",
        "currentBehaviour": "…",
        "desiredBehaviour": "…",
        "fixDirection": "…",
        "keyInterfaces": "optional",
        "definitionOfDone": ["…", "…"],
        "tenantIsolationTest": "…",
        "moneyInvariant": "…",
        "verification": "pnpm typecheck && pnpm lint && pnpm test",
        "visualChangeExpected": "optional",
        "outOfScope": "…"
      }
    }
  ]
}
```

`wave: "solo"` sits next to `estimatedScope` when needed. Then:

```bash
scripts/agent/publish-tickets.sh --check
scripts/agent/publish-tickets.sh --dry-run
scripts/agent/publish-tickets.sh
```

Publishing is resumable: an interrupted run continues from the `<!-- agent-tickets -->` comment on
the PRD instead of creating duplicates, so on any error fix the cause and run it again. The script
prints the ready tickets and leaves the PRD at `status: in-progress`; the human starts work with
`run: implement` on a ready ticket, or `auto-advance` on the PRD.
