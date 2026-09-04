# 0014. Labels are the state machine, commands are not states

Status: accepted
Date: 2026-09-03

## Context

ADR 0013 removed sandcastle and named Cezar as its replacement. Cezar's engine never writes to
GitHub: every label, comment and pull request comes from a script in `scripts/agent/`. That is only
worth having if the backlog carries a state machine those scripts can drive and a human can read at
a glance, and this repository does not have one.

What it has instead: 23 labels of which 5 have ever been used, two `status:` families that overlap
(`pending`, `available`, `accepted`, `on hold`, `blocked`, `in progress`, `review needed`,
`completed`, `abandoned` - nine words for a lifecycle nobody wrote down), one label whose name ends
in an invisible U+FE0F and therefore cannot be typed, seven `type:` labels for four kinds of work,
and a `priority:` family on all six open issues that no process reads. `docs/agents/triage-labels.md`
documents a promotion label called `ready-for-agent` and a register at `.out-of-scope/`; neither
exists in the repository. The documented protocol and the live repository have drifted apart, which
is the state in which a script that trusts labels does the wrong thing silently.

The protocol adopted here is the one written for the sibling repository as its ADR 0015, brought
across whole rather than reinvented: the scripts that read it are the ones being ported in the same
change, and a second dialect of the same idea would be a bug with extra steps.

## Decision

**Exactly one `status:` per open issue; `run:` labels are commands, not states; nothing else is
state.** The vocabulary is closed at 19 labels (`docs/agents/triage-labels.md`) and any label
outside it is deleted.

- `status:` names where an issue is: `triage`, `needs-info`, `backlog`, `queued` (an open native
  blocker), `ready`, `in-progress`, `review`, `needs-human`. It is written only by scripts under
  `scripts/agent/` and by the issue forms; an agent never edits a label.
- `run: triage` and `run: implement` are the two commands a human can give. The claim script removes
  the command as its first action, so a command that is still there is a command nobody has taken.
  Adding the next command is how a human accepts the previous artefact; the planning steps (spec,
  PRD, tickets) are started by hand for the same reason and each ends at `status: review`.
- `type:` is mandatory on every issue without a parent and absent on tickets, which inherit it. Four
  values: `bug`, `feature`, `enhancement`, `maintenance`.
- `prd` marks the parent: an issue with sub-issues carries it, and an issue carrying it is titled
  `PRD:`. `auto-advance`, on an open PRD only, lets the sweeper add `run: implement` to each child as
  its blockers close. That is the one place autonomy widens, and a human turns it on per PRD.
- Dependencies are native `blocked_by` relations, written by the ticket publisher after the tickets
  exist and before any is labelled `ready`. Bodies do not mirror them.
- Three PR labels: `agent-pr`, `needs-e2e`, `agent-docs`. No priority axis; "visual change expected"
  is a body section, not a label.

The sweeper (`scripts/agent/sweep.mjs`) is the only writer besides the claim, apply and handback
scripts: it closes an issue when its PR merges, moves siblings from `queued` to `ready` as blockers
close, closes a PRD when its last child closes, and turns stale or orphaned states into
`needs-human`. It reports invariant violations and repairs only mechanical ones. Every write leaves
an HTML marker so a re-run is idempotent.

**Promotion still has to be earned.** A triage run may move an issue to `status: ready` only with a
reproduction at HEAD, a redundancy check and a settled fix direction; `ready` means "specified and
unblocked", never "start now". A human's `run: implement` (or the PRD's `auto-advance`) is what
starts work.

## Consequences

The backlog can be read without an orchestrator: a query for `status: ready` is the frontier, a
query for any `run:` older than two hours is a stuck command, and one label per issue makes every
invariant a one-line check.

What is given up:

- **The `priority:` family**, which sits on all six open issues today. Unlike in the repository this
  protocol came from, these are in use, so the migration strips them rather than finding them empty.
  Three issues marked `priority: high` (#16, #17, #20) lose that mark. Ordering is expressed by the
  dependency graph and by which issue a human hands to a run, not by a label nobody queries.
- **`type: security`, `type: documentation`, `type: discussion`, `type: question`, `type: release`**,
  none of which is on an open issue. A security defect is a `type: bug`; that it is security-relevant
  belongs in the body, where it can say what it actually is.
- **The historical labels on closed issues**, which the deletion strips. A snapshot of the labels and
  of every issue is committed under `docs/agents/migration/` before the migration runs.

## Migration

`scripts/agent/labels-migrate.sh` is idempotent and dry-run by default. It snapshots first, renames
the five statuses that survive under a new name (`pending → triage`, `on hold → needs-info`,
`review needed → review`, `in progress️ → in-progress`, `blocked → queued`), creates the nine that do
not exist, recolours and re-describes the rest, computes one status per open issue from the
sub-issue graph and the native blockers, strips the `priority:` family, deletes the 18 labels outside
the vocabulary, and asserts the invariants the sweeper will enforce.

For this repository's six open issues the computed status is `status: triage` in all six cases: they
are parentless, untriaged findings from the comparison round, which is exactly what a triage run is
for.

## Amendment 2026-09-04

**Two PR labels, not three, and the vocabulary closes at 18.** ADR 0016 retired `needs-e2e`: the
browser suite runs on every pull request, so a label asking for it has nothing to ask. `agent-pr`
and `agent-docs` remain, and the rest of the protocol - the `status:` axis, the `run:` commands,
the native `blocked_by` relations, the sweeper as sole extra writer - is untouched.

`needs-e2e` is the one deletion `scripts/agent/labels-migrate.sh` has to be told about explicitly.
Step 2 of that script counts issues carrying a label before removing it, and a _pull-request_ label
reads 0 from `gh issue list` however many PRs wear it - so it is listed in `CLEARED_BY_RELABEL`,
which makes deleting it a decision somebody wrote down rather than an accident of the query.
