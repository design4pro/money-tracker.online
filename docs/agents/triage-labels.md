# Triage labels

Canonical triage roles mapped onto this repository's label set. **Do not create new labels for these
roles.**

| Canonical role  | Label in this repo      |
| --------------- | ----------------------- |
| needs-triage    | `status: pending`       |
| needs-info      | `status: on hold`       |
| ready-for-agent | `ready-for-agent`       |
| ready-for-human | `status: review needed` |
| wontfix         | `status: abandoned`     |

Supporting vocabulary in use: `priority: critical/high/medium/low`,
`type: bug/feature/enhancement/maintenance/security/documentation`, `qa`, `qa-failed`,
`status: blocked`.

Labels an orchestrator reads and writes. Sandcastle is gone and Cezar is not yet ported
(`docs/adr/0013-cezar-replaces-sandcastle.md`), so nothing acts on the first two today; they are
kept because the vocabulary outlives the tool that read it.

- **`agent-blocked`** — an issue that exhausted an agent run's fix budget. A human re-queues it.
- **`visual-change-expected`** — declares an intended pixel change so a loop re-records baselines
  instead of failing the diff. Equivalent to a `## Visual change expected` section in the body.
- **`needs-e2e`** — a pull-request label: runs the CI e2e job on that PR. The escape hatch in
  `ci.yml`, and the only one of the three that is live.

Body marker: `<!-- sentry-issue: SHORT-ID[#n] -->` (a Sentry-sourced ticket, used for dedupe).

## Two rules govern where `ready-for-agent` may sit

- **It is a per-slice gate, never a PRD label.** A PRD is an issue with open sub-issues and is never
  workable on its own, so on a parent the label offers an orchestrator the PRD itself as work.
  `/to-tickets-project` applies it to every ticket it publishes and verifies the wave afterwards.
- **It is orthogonal to `status: blocked`.** `ready-for-agent` says a human specified and cleared the
  slice; `status: blocked` is a human's note that some other issue must land first. Execution order
  comes from the dependency graph, not from either label. A cleared slice with an open blocker
  keeps both.

## Pre-triage

Pre-triage was automated by the orchestrator and is currently done by hand. The contract it followed
is worth keeping, because it is what makes a promotion trustworthy rather than a label someone
applied while reading quickly:

**The claim is reproduced at HEAD.** A confirmed, non-redundant finding whose fix direction is
settled by SPEC or an ADR is promoted: an `## Agent Brief` is appended to the body (Category,
Summary, Current, Desired, Fix direction, Key interfaces, Definition of Done, Owned paths, Tenant
isolation test, **Money invariant**, Verification, Out of scope), and `ready-for-agent` replaces
`status: pending`.

Refuted, insufficient, redundant or judgement-heavy findings get triage notes with the recommended
state **named, never applied**. Promotion is earned by a reproduction, never by plausibility.

The redundancy search is **by domain concept, not by wording** — two issues describing the same
`ref_amount` recomputation in different words are one issue — and `.out-of-scope/*.md` is checked
before anything is promoted, so a previously-rejected idea is not re-litigated by a new ticket.

## Sentry-sourced tickets

Sentry sweeps ran from the orchestrator and do not run today. When they return, the rules that made
them safe are these:

Findings are filed as `type: bug` + `status: pending` — **never `ready-for-agent`**, because a sweep
has reproduced nothing.

Dedup is keyed on the `<!-- sentry-issue: SHORT-ID -->` marker across **open and closed** issues: a
closed ticket means the bug was fixed, and a re-file would be the routine's worst failure. A
recurrence more than a day after the fix shipped is filed as a **separate regression ticket** rather
than reopening the original, so the record of the first attempt survives.

## QA findings

QA findings from staging are filed as new issues with `qa-failed` (bugs) or `type: enhancement`
(taste). A `qa-failed` issue that touches an amount is filed with the money invariant it appears to
violate stated in the body, because that is the fastest thing for a triager to reproduce.
