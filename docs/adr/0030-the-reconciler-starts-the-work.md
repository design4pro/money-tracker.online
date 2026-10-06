# 0030. The Reconciler starts the work

Status: accepted
Date: 2026-10-02
Amends: ADR 0029 (the schedule that starts implementation, the WIP limit, who clears a hold, and
which issues the retired `design4pro-agent` account opened are never picked), ADR 0027 (a spec PR
`afk-plan-to-spec` wrote merges without a person; no other spec-only PR does).

## Context

After ADR 0029 the pipeline had one clock per job - an implement run every two hours, a slice run on
weekdays - and one rule for everything else: a person notices. That left five places where work stopped
and nothing started it again:

- **The cap counted the wrong thing.** Three open agent PRs stopped `--next`, but most agent PRs are on
  their way to `om-pr-autopilot --allow-merge` and need nobody. A queue that the pipeline drains itself
  held back the next implementation, while the PRs that really wait for a person (`needs-qa` with no
  `qa-approved`, `risk-high`) were the same count as any other.
- **A hold had no exit.** An agent put `blocked` on an issue, or `implement-ticket` left a `STOP:`, and
  the only way out was a person reading a comment. `SDLC.md` § Unattended decisions already says a state
  with that exit is a defect; `afk-decide` handled it for questions asked mid-run but not for the ones
  already left on the tracker.
- **A merged spec could wait for nothing.** `afk-to-tickets` looked at specs added in the last
  fourteen days, so one that merged just after a quiet fortnight was never sliced.
- **A plan stage had no spec.** `docs/plans/` is the backlog source, and nothing turned a stage into a
  design: a person started `spec` by hand, one feature at a time.
- **A run that failed stayed failed.** A transient registry error in a leading `pnpm install`, an OAuth
  refresh, a provider's usage limit: the run ended `failed` and waited for a person to press Continue.

The cause is the same each time: the work is the difference between what the repository wants and what
exists, and a trigger per event cannot see a difference.

## Decision

1. **A level-triggered Reconciler starts the work.** A cron on the cezar host (design4pro/cezar,
   `host/reconciler`, its ADR 0009) runs every ten minutes. It starts something only when there is
   something to do and a free `maxParallel` slot, and it repairs a failed run by continuing it. It
   decides nothing itself: it asks `node .ai/scripts/backlog-status.mjs --plan`, which prints
   `{ wip, actions }` with at most one action per kind - implement, unblock, triage, slice, write-spec,
   in that order - each carrying the workflow and the task text to send. No Cezar engine change: the
   cron, the cockpit API, and the scripts and workflows in this repository are all there is. The
   schedules in `docs/agents/cezar-automations.json` that start implementation and slicing are left as
   they are until the Reconciler has run alone for a while.
2. **WIP counts what only a person can clear.** Open PRs by a trusted author, except the promotion (base
   `main`), that are `needs-qa` without `qa-approved`, or `risk-high`, `security`, `blocked` or
   `do-not-merge` (a person's hold on an agent PR still waits for review), or `changes-requested` with no
   update for 24 hours (an autopilot that stopped at `changes-requested` is parked on a decision no run is
   making, and `--plan` reads each PR's `updatedAt` to see it). The limit stays three. A PR the pipeline
   merges by itself is not inventory.
3. **An agent lifts what an agent set, on a specialist's verdict.** `afk-unblock` takes a `blocked`
   hold, or an unanswered not-ready or `STOP:` comment, and asks an independent specialist
   (`afk-decide`) whether it can be lifted; it lifts it with a `🤖 RESOLVED:` comment, which
   `backlog-status.mjs` reads as the answer, or hands it back with `🤖 HUMAN-ONLY:` and leaves it.
   What stays with a person is what `afk-decide` § 5 lists, any hold a person set or took over, and
   everything marked `HUMAN-ONLY:`. Whoever sets a label is not recoverable - every run acts as the
   maintainer - so the evidence of ownership is the comment: a hold whose last word is a person's is
   theirs, a hold no comment explains is handed back with `HUMAN-ONLY:` rather than lifted, and
   `do-not-merge` and `do-not-close` are never offered. `afk-triage` and `afk-decide` write
   `🤖 HUMAN-ONLY:` on every hold that is a person's, so the Reconciler does not spend a run on it.
4. **An agent writes the spec for a plan stage, and a panel reviews it.** `afk-plan-to-spec` takes the
   first stage of `docs/plans/` that no spec and no issue mentions and its plan does not mark
   `Delivered:`, verifies it against the code, settles
   every open question through a specialist, writes a `ready` spec, and has a panel (product owner,
   software architect, and the security, accessibility and UX, and configuration specialists where the
   spec touches them) approve it before the PR is opened. The `plan-to-spec` workflow's last step,
   `om-pr-autopilot --allow-merge`, merges the design-only PR once CI is green, into `develop` only
   (ADR 0027). The installed autopilot leaves a spec-only PR draft for a person, so
   `.ai/skills/om-pr-autopilot/SKILL.md` names the one exception: the PR this skill opens (branch
   `spec/<slug>`, the panel's verdicts in the body, a `Plan` row in the spec, ready for review, no
   `blocked`), and the docs-only PR that marks delivered stages. The `spec` workflow's spec PR and the one
   `implement-ticket` writes for a spec task keep their human merge. A spec so written has no issue yet, so `.ai/specs/AGENTS.md` lets a `Plan` row
   (`<stage> (docs/plans/<file>.md)`) stand in for the `Issue` a `ready` spec otherwise needs. The next
   tick slices it. A stage the code already delivers gets no spec: the skill adds a line
   `Delivered: <date> - <evidence>` under its heading, and under every other uncovered stage of that plan
   the code delivers, and lands it on a docs-only PR that merges the same way. `--plan` skips a stage so
   marked, and names no stage while a `docs/plan-delivered-*` PR is open, because the line is not in the
   plan until it merges (a person's PR that edits a plan does not hold it). Without the line the run would end with nothing covering the stage, and the Reconciler would
   pick it again after its cooldown, so the queue would never move past it.
5. **Slicing has no age window.** The oldest `ready` spec directly in `.ai/specs/` that no issue, open or
   closed, opens with `Spec: <path>` is sliced.
6. **The retired agent account is trusted.** `design4pro-agent` can file nothing new (ADR 0027,
   amendment of 2026-10-01), and every issue it filed came out of an agent run the maintainer launched.
   Its issues count as the maintainer's for readiness, triage and WIP, which reverses the sentence in
   ADR 0029's Consequences that says otherwise. This holds only while some automation gates on authors
   at all, so a repository that gates no one still trusts no one.
7. **The leading install retries.** `.ai/scripts/bootstrap.sh` runs `pnpm install --frozen-lockfile` up
   to three times, thirty and sixty seconds apart, then `pnpm generate-routes`, and is the step every
   workflow that installs dependencies calls. A check step cannot retry itself, so one registry error
   used to fail a run before any agent started.

## Consequences

- A merged spec is the product of one agent and a panel, with no person reading it before it lands. It is
  design-only and changes no behaviour, the panel's verdicts are Resolved assumptions rows in the PR and
  the spec, and overturning one is an ordinary review finding; a panel that does not approve leaves the PR
  `blocked` for a person, and a security reviewer that does not approve always does.
- A hold lifted wrongly costs one `implement-ticket` run that ends in `STOP:` or in review. `risk-high`
  and `security` work still needs the security and tenancy specialist's approving verdict before any run
  claims it, whoever lifted the hold.
- WIP no longer bounds the number of open agent PRs; `maxParallel` and the free-slot rule do. A burst
  of low-risk PRs merges as fast as CI allows.
- `.ai/specs/README.md` does not record the parent issue a spec was sliced into. The next slice step
  finds it by its first line, `Spec: <path>`, never by the spec's own `Issue` row.
- Nothing in this repository parses the `Plan` row: it has no spec registry, so the row is a convention
  in `.ai/specs/AGENTS.md`, and the Reconciler finds the stage by its id in the spec's text.
- A plan stage id is unique across `docs/plans/` today, but two plan files could share one, so a mention
  of an id that two files share covers the stage only when it also names the plan file. No plan is
  marked frozen; `afk-plan-to-spec` refuses the stages of one that is.
- A `Delivered:` line is a claim nothing re-checks, and a wrong one hides the stage from the queue. The
  evidence is on the line and on the docs-only PR, which merges without a panel; deleting the line puts
  the stage back. A partly delivered stage is never marked: it gets a spec for what is left.
- Until the schedules are removed, `implement-ticket` and `spec-to-tickets` can be started by a
  schedule and by the Reconciler. Both check what holds an issue before they claim it, and the
  Reconciler drops a candidate a live run already holds, so the worst case is a run that stops.

> **Amended 2026-10-03.** The four automations that start the same work as the Reconciler - **Implement the next ready issue**, **Spec to tickets**, **Groom and triage new issues** and **Re-triage when a hold is cleared** - are retired, because the Reconciler starts that work and each would start an issue a second time; the issue pair stays in `docs/agents/cezar-automations.json` with `"enabled": false` for the `authors` gate decision 6 depends on.

> **Amended 2026-10-04.** Decision 1's "at most one action per kind" is now "up to three candidates each for implement, unblock and triage, best first, and one each for slice and write-spec". On 2026-10-04 one `implement` candidate (#516) that every tick skipped, because a run on it had finished inside the cooldown, kept the READY issue behind it from starting for six hours; the Reconciler passes the turn to the next candidate of a kind when the first cannot start (design4pro/cezar#55).
