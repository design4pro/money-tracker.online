---
name: backlog
description: Report the backlog - where every open issue sits in the SDLC.md pipeline and the one next step that moves each. Read-only - it runs .ai/scripts/backlog-status.mjs and reads the result, and never applies a trigger label. Use when asked what is ready to start, what the queue is holding, or where one issue stands.
user-invocable: true
argument-hint: "[ready|blocked|<issue-number>] - optional filter"
allowed-tools:
  - Bash(node .ai/scripts/backlog-status.mjs:*)
  - Bash(test -f .ai/cezar/runs.json)
  - Bash(gh issue view:*)
  - Bash(gh pr view:*)
---

Report the backlog: where every open issue sits in the `SDLC.md` flow and what moves it next.

Run `node .ai/scripts/backlog-status.mjs` and report its output. The script is the source of the
facts; you add only the reading. Filter to the request when it names a state or an issue number;
no request is the whole backlog.

## States the script reports

| State         | Means                                                             | Next step                                           |
| ------------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| `BLOCKED`     | `blocked` / `do-not-merge`, or a trigger a stand-down label voids | A human clears the label                            |
| `RUNNING`     | An agent holds the claim (`in-progress`)                          | Wait                                                |
| `QUEUED`      | A trigger label is set and the cockpit has the run                | Wait                                                |
| `STUCK`       | A claim gone stale, or a trigger no run picked up                 | Check the cockpit, then re-apply or clear the label |
| `IN_REVIEW`   | An open pull request addresses it                                 | `/om-pr-autopilot <pr>`                             |
| `NOT_READY`   | An unanswered `om-auto-manage-issues` not-ready comment           | Answer on the issue, then `groom`                   |
| `NEEDS_SPEC`  | A `feature` with no spec under `.ai/specs/`                       | `spec`                                              |
| `NEEDS_GROOM` | Never groomed, so the Definition of Ready is unverified           | `groom`                                             |
| `READY`       | Groomed, ready, unclaimed                                         | `autofix`                                           |

## Flow health

`node .ai/scripts/backlog-status.mjs --flow` answers the other question: not where each issue sits,
but whether the ladder is moving. Four numbers, all from files and commands whose output it reads:

| Number                | From                                                           | What a bad value means                                           |
| --------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| Launches per workflow | Runs in `.ai/cezar/runs.json` that carry an `automation` block | A zero row is an automation the cockpit has never actually fired |
| Intake latency        | Issue opened → the first `needs-triage`                        | A rising median is the groom→triage bridge falling behind        |
| Time to first PR      | The first `ready-for-agent` → the pull request opening         | A long tail is the implement automation not picking work up      |
| Gate retries          | `steps[id=gate].iterations` across retained runs               | A rising share is the gate catching what the agent ships         |

Reading it:

- **Launch counts are "since the oldest retained run", never "ever".** `runs.json` is a window the
  service rewrites; a count can go *down* between two invocations as old runs age out.
- **"never labelled" is not "the bridge failed" for an old issue.** The groom→`needs-triage` edge
  is event-driven with no backlog catch-up, so every issue filed before it was wired shows there by
  design. Read the count as a backlog of un-triaged work for a human, and read the *recent* numbers
  as the bridge's health.
- **Poll counts are absent on purpose.** The cockpit holds them in memory and commits them nowhere,
  so the report names the gap instead of printing a zero it did not measure. If someone needs
  polls, that is the live cockpit, not this script.
- `--flow` and `--stale-hours` are mutually exclusive and the script says so rather than ignoring
  the one it cannot use.

## Rules for the report

- `groom`, `autofix` and `spec` are the only labels that start a run, and only a human applies one
  (`SDLC.md`). Never apply one yourself: list the commands and let the developer choose.
- The queue comes from `.ai/cezar/runs.json`, which is gitignored and therefore exists only in the
  main checkout. Run `test -f .ai/cezar/runs.json` before reading anything into a `STUCK`: when the
  file is absent - a run started with a worktree, or a host that is not the cockpit - the script
  sees no runs at all, so every issue carrying a trigger label reports `STUCK` where `QUEUED` may
  be the truth. Say so in the header and recommend re-applying no label on that evidence.
- `.ai/cezar/config.json` caps the cockpit at `maxParallel` runs, shared with the sibling project on
  the host. Recommend at most that many `autofix` labels at once, highest priority first, and say
  the rest waits.
- An issue whose work would touch the same files as a `RUNNING` or `QUEUED` one waits: name the
  collision rather than queueing a conflict.
- A `⚠️` line under an `IN_REVIEW` issue is a **question for the developer**, never a change to
  make on their behalf: a branch that names an issue is not proof that the pull request closes it,
  and a partial fix correctly carries no closing keyword.
- Report the counts per state, then the `READY` set in priority order with a ready-to-paste
  `gh issue edit` line for each. Do not restate every `NEEDS_GROOM` issue - give the count and the
  one command that grooms the highest-priority few.
