# ISSUES

Here are the open issues in the repo:

<issues-json>

!`gh issue list --state open --label ready-for-agent --json number,title,body,labels --limit 100 --jq '[.[] | {id: (.number|tostring), title, labels: [.labels[].name], body}]'`

</issues-json>

# SCOPE

{{SCOPE}}

# TASK

Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules (check each ticket's "Owned paths" section), making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

A PRD (an issue that has sub-issues linking to it) is never workable — only its sub-issues are. Exclude PRDs from the plan. Do NOT then go and plan its sub-issues either, unless the SCOPE list above already names them: a sub-issue that is missing from that list is missing on purpose.

For each unblocked issue, assign a branch name using the exact format `sandcastle/issue-{id}-{{RUN_ID}}` (no slug or other suffix). This must be deterministic so that re-planning the same issue **within this run** always produces the same branch name and accumulated progress is preserved. The run suffix is what lets two runs work the backlog side by side: git refuses to check one branch out in two worktrees, and each run is cut from its own `origin/develop` snapshot, so an unsuffixed name would either collide outright or drag another run's differently-based history into this run's merge.

Prioritize: critical bug fixes, then development infrastructure, then tracer-bullet feature slices, then polish and refactors.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42-{{RUN_ID}}"}]}
</plan>

Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).

Always emit the `<plan>` tags, even when there is nothing to do. If there are no issues to work on at all, output `<plan>{"issues": []}</plan>` so the run can exit cleanly.
