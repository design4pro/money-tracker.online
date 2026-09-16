# 0020. Pull requests reach `develop` through a merge queue, and the full suite runs once on the commit that ships

Status: proposed
Date: 2026-09-15
Amends: 0003, 0016

## Context

Every change to `develop` runs the whole suite twice. The pull request runs `ci.yml` on
`refs/pull/N/merge`; the merge then creates a new commit, and the push run on `develop` runs
`generated · typecheck · lint · build`, `unit tests · coverage` and all three `e2e` legs again before
`deploy · staging` (ADR 0003, amendment 2026-09-15). The second run cannot reuse the first: a merge
commit has a SHA of its own, and nothing guarantees the tree it tested is the tree that landed,
because `develop` may have moved in between. A PR checks view shows both runs side by side, and on a
self-hosted pool of four `ci` runners the duplicate is what the next pull request waits behind. The
`e2e` legs are the bulk of it, and they also run again on every push to an open pull request.

The rulesets on `develop` and `main` require `claude-review`, `generated · typecheck · lint · build`,
`unit tests · coverage`, `e2e · merged report` and `merge-gate` (since 2026-09-15; the reading in
`docs/agents/cezar.md` dated 2026-09-09 predates it).

GitHub's merge queue removes the reason the second run exists. A queued pull request is built into a
temporary `gh-readonly-queue/develop/pr-<N>-<base_sha>` commit on top of the current `develop` (or of
the entry ahead of it), the required checks run on that commit through the `merge_group` event, and
when they pass `develop` is moved to that same commit. The push run that follows has
`github.sha` equal to the SHA the queue tested, so it can look the verdict up instead of producing it
again. Facts this record relies on, checked against docs.github.com, the REST and GraphQL schemas and
the `gh` v2.101.0 source on 2026-09-15:

- The queue is available to private repositories of an organisation on GitHub Enterprise Cloud, and
  only as a rule of a **repository** ruleset on a branch name without wildcards. Nothing in this
  repository records that `design4pro` is on that plan: on 2026-09-15
  `gh api repos/design4pro/money-tracker.online` reads `"private": true`, and `gh api orgs/design4pro`
  returns `"plan": null` to the pipeline's token. An organisation owner reads the plan (Settings →
  Billing and plans) before any rollout change lands; a "no" closes this record rather than
  reverting a kit release and a `ci.yml` change that took the journeys off pull requests.
- Every required check must report on the `merge_group` commit. A workflow without a `merge_group`
  trigger never reports, and the queue removes the entry when `check_response_timeout_minutes`
  expires. A job skipped by its `if` reports success, as it already does on a pull request.
- In a `merge_group` run `github.event.pull_request`, `github.head_ref` and `github.base_ref` are
  empty; the payload carries `merge_group.head_sha`, `base_sha`, `head_ref` and `base_ref`.
- `gh pr merge <n>` on a queue-protected base enqueues (enabling auto-merge while checks are pending),
  ignores `--squash` / `--merge` / `--rebase` with a warning because the queue's own method decides,
  refuses `--delete-branch`, and merges directly only with `--admin`, which a ruleset bypass actor
  may use. `gh` cannot dequeue; the GraphQL `dequeuePullRequest` mutation does.
- The queue's merge itself fires `push` on `develop`, attributed to `github-merge-queue[bot]`, so
  `ci.yml` and `promote-develop.yml` still start from it.
- On 2026-04-23 GitHub shipped wrong squash commits for merge groups holding more than one pull
  request (GitHub availability report, 2026-04-28). Merge and rebase groups were not affected.

## Decision

**`develop` gets a merge queue; `main` does not.** The rule on the `develop` ruleset:

| Parameter                           | Value      | Why                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `merge_method`                      | `SQUASH`   | What feature pull requests into `develop` use today.                                                                                                                                                                                                                                                                                               |
| `max_entries_to_merge`              | `1`        | One pull request per group: every change normally gets its own push run and staging deploy, a red group names one culprit, and the multi-PR squash defect above cannot occur. Two queue merges landing while a push run is still busy share the one pending run `ci.yml`'s concurrency keeps; the newer deploy then carries the change in between. |
| `min_entries_to_merge`              | `1`        | Nothing waits for company.                                                                                                                                                                                                                                                                                                                         |
| `min_entries_to_merge_wait_minutes` | `0`        | Follows from the line above.                                                                                                                                                                                                                                                                                                                       |
| `max_entries_to_build`              | `1`        | A group run takes five `ci` runners' worth of jobs; building a second group in parallel would starve pull request runs on a pool of four and is rebuilt anyway when the first fails.                                                                                                                                                               |
| `grouping_strategy`                 | `ALLGREEN` | With one entry per group the two strategies coincide; `ALLGREEN` stays correct if the size is raised.                                                                                                                                                                                                                                              |
| `check_response_timeout_minutes`    | `60`       | The last ten green push runs on `develop` took 15 to 25 minutes from creation to completion, runner waits and deploy included (`gh run list --workflow ci.yml --branch develop --event push --status success -L 10`, runs 34752958943 to 35021244788, read 2026-09-15).                                                                            |

The required checks stay as they are. What changes is where each one does its work:

| Job (check)                                | `pull_request` into `develop` | `merge_group`    | `push` to `develop` / `main`             |
| ------------------------------------------ | ----------------------------- | ---------------- | ---------------------------------------- |
| `generated · typecheck · lint · build`     | runs                          | runs             | runs only when nothing verified the tree |
| `unit tests · coverage`                    | runs                          | runs             | runs only when nothing verified the tree |
| `e2e` legs                                 | skipped                       | runs             | runs only when nothing verified the tree |
| `e2e · merged report`                      | skipped (passes)              | runs             | runs when the legs run                   |
| `claude-review`                            | runs                          | skipped (passes) | -                                        |
| `merge-gate`                               | runs                          | skipped (passes) | -                                        |
| `deploy · staging` / `deploy · production` | -                             | -                | after a verdict, found or produced       |
| `queue removal`                            | -                             | on failure only  | -                                        |

1. **A pull request runs the fast checks, the review and the gate; the queue runs the whole suite on
   the commit that will ship.** The `e2e` legs are skipped on `pull_request`, so a green pull request
   means "reviewed, labelled, builds and passes unit tests", and the journeys judge the exact commit
   `develop` will point at. A promotion pull request (`develop` → `main`) keeps skipping `verify`,
   `test` and `e2e`, and leaves the verdict to the push run (#299, ADR 0016's amendment of
   2026-09-15). ADR 0016 kept the legs on every pull request because a regression found on the pull
   request that caused it is worth more than the runner minutes. The queue keeps that attribution,
   since a group holds one pull request and a red group names it; what it gives up is the moment the
   signal arrives, which the first cost below prices.
2. **`claude-review` and `merge-gate` listen for `merge_group` and skip it.** Both judge the pull
   request - its diff, its labels, its number - and none of that exists in a `merge_group` payload,
   so each job gets `if: github.event_name == 'pull_request'` and reports skipped, which the queue
   reads as passing. `merge-gate`'s concurrency group falls back to `github.run_id` when there is no
   pull request number, so queue runs never cancel each other: a cancelled required check removes the
   entry. Both workflows are kit-managed, so this lands in agent-kit first.
3. **A push run looks for an earlier verdict on the same tree before running anything.** A first job
   in `ci.yml` (`verdict`) takes the pushed commit and, for a merge commit, each parent whose tree is
   identical, and asks the Actions API for a successful `ci.yml` run on one of those SHAs from a
   `merge_group` or `push` event (never `pull_request`: a pull request run's `head_sha` is the branch
   head, not the commit it tested). A `merge_group` run still finishing for that SHA is waited for,
   bounded. When a verdict is found, `verify`, `test` and the `e2e` legs are skipped and the deploy
   runs; otherwise the suite runs and the deploy waits for it exactly as it does today. The job needs
   `actions: read` and nothing else.
   - A queue merge into `develop` is found by its own SHA.
   - A promotion merge into `main` has a new SHA, but git flow makes its tree identical to its second
     parent, the `develop` tip, which the queue (or that tip's own push run) already verified. So a
     promotion runs no suite at all and production ships the tree staging shipped.
   - A direct push, an admin bypass merge, or a promotion whose tree differs from `develop` (a hotfix
     on `main`) finds nothing and runs the full suite. The fallback is the current behaviour, not a
     degraded one.
4. **Merging means enqueuing.** `om-approve-merge-pr` keeps calling the tracker's **merge-pr**
   operation. On `develop` the command becomes `gh pr merge <n>` without a method, and the operation
   reports "queued" rather than "merged"; `--delete-branch` is never passed, which `gh` would refuse
   on a queue anyway. The promotion keeps `gh pr merge <n> --merge` on `main`, so ADR 0003's
   merge-commit rule and the test that pins it are untouched. Removing a queued pull request is
   `gh api graphql -f query='mutation { dequeuePullRequest(input: {id: "<node id>"}) { clientMutationId } }'`.
   The shared descriptor text lives in agent-kit (`templates/.ai/trackers/github.md`, tier 2).
5. **The `merge-queue` label keeps its name.** It already means "approved and green, ready for a
   human to merge" (`SDLC.md`), which is "ready to enter the merge queue". Renaming it would touch
   upstream om skills vendored unmodified; `SDLC.md` says in one sentence which of the two a sentence
   means.
6. **`main` has no queue.** Its only pull request is the automated promotion, one at a time, merged
   with a merge commit, so a queue would serialise nothing. It would also make the promotion a `MERGE`
   group, and that a merge group lands as the SHA it tested is observed only for squash groups so far.
   Decision 3 already makes the promotion free without it.
7. **A pull request the queue removes leaves `merge-queue`.** The labels are the state machine
   (`SDLC.md`). A pull request whose group failed still carries `merge-queue`, its own green checks
   and a green `merge-gate`, so every reader of labels and checks would call it mergeable and the
   next merge would enqueue the same tree again. A last job in `ci.yml` (`queue removal`) runs only
   on `merge_group`, needs every suite job and runs `if: failure()`. It reads `<N>` from
   `merge_group.head_ref` (`gh-readonly-queue/develop/pr-<N>-<sha>`), moves the pull request from
   `merge-queue` to `changes-requested`, and comments with the failed job and the run link. It needs
   `issues: write` on that job alone. An entry removed without a failed run (a required check that
   never reported before `check_response_timeout_minutes`, or a dequeue by hand) has no run to host
   the job. `SDLC.md`'s merge section says a person moves that pull request, and that
   `om-merge-buddy` cannot see a removal.

## Consequences

Per change to `develop`, the suite runs once where it ran twice, and pushes to an open pull request
cost two jobs instead of six. Counted in `ci` runner jobs for a pull request pushed once:

| Stage                    | Before                           | After                  |
| ------------------------ | -------------------------------- | ---------------------- |
| Pull request run         | 6 (verify, test, 3 legs, report) | 2 (verify, test)       |
| Queue run                | -                                | 6                      |
| Push run on `develop`    | 6 + deploy                       | 1 (`verdict`) + deploy |
| Promotion push on `main` | 6 + deploy                       | 1 (`verdict`) + deploy |

The costs:

- **Journeys report later.** An agent driving a pull request green (`om-auto-fix-pr`) no longer sees
  the `e2e` legs, and `validation.commands` does not run them either, so a journey failure surfaces
  only after a human enqueues: the queue removes the entry, and decision 7 moves the pull request to
  `changes-requested` with the failed check named, so the fix runs on that pull request like any
  other change request. The alternative, keeping the legs on the pull request and skipping them in
  the queue, keeps the early signal but verifies a base that may have moved and runs the legs on
  every push; reversing to it is one `if` per job.
- **Merges are serial.** With one build at a time, a merge waits for the group ahead of it: about
  twenty minutes each, plus runner waits. At this repository's merge rate that is minutes a day, and
  `max_entries_to_build` is the dial if it stops being.
- **A label added while a pull request is queued is not read.** `merge-gate` judged the labels when
  the pull request became green, and the queue does not re-run it. Blocking a queued pull request is
  dequeuing it, not labelling it.
- **The verdict job trusts the Actions API.** If it wrongly finds nothing, the suite runs: slower,
  never less safe. It can only wrongly find something if a successful run exists for a SHA whose
  tree is the one pushed, which is the definition of verified.
- **An admin bypass merge (`gh pr merge --admin`) skips the queue**, and its push run runs the full
  suite before the deploy, so bypassing costs time rather than a check.
- Lint in the queue runs without the ESLint cache, which is keyed to `pull_request`, and the
  agent-kit check in `verify` falls back to hashes only there; both still run in full on the pull
  request.
- The `Accessibility` workflow is not a required check and still runs on the pull request and on the
  push, as ADR 0003's amendment of 2026-09-15 left it.
- **The amendments land with acceptance.** While this record is `proposed` it amends nothing. The
  change that sets it to `accepted` appends an amendment pointing here to ADR 0003 and ADR 0016, as
  ADR 0001 requires; appending them earlier would record in two accepted ADRs a decision nobody has
  taken.
- planned.travel runs the same pipeline (its ADR 0021) and adopts this after money-tracker has run
  it; its `change scope` job, which diffs `refs/pull/N/merge`, needs a `merge_group` form first.
