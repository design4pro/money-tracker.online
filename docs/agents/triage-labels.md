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

Labels the automation itself reads and writes:

- **`agent-blocked`** — the orchestration loop swaps it in for `ready-for-agent` when an issue
  exhausts its fix budget (`markBlocked()` in `.sandcastle/main.ts`). A human re-queues it.
- **`visual-change-expected`** — declares an intended pixel change so the loop re-records baselines
  instead of failing the diff. Equivalent to a `## Visual change expected` section in the body.
- **`needs-e2e`** — a pull-request label: runs the CI e2e job on that PR. The escape hatch in
  `ci.yml`.

Body markers: `<!-- sandcastle-triage -->` (an issue has been pre-triaged, once) and
`<!-- sentry-issue: SHORT-ID[#n] -->` (a Sentry-sourced ticket, used for dedupe).

## Two rules govern where `ready-for-agent` may sit

- **It is a per-slice gate, never a PRD label.** A PRD is an issue with open sub-issues and is never
  workable on its own. On a parent the label is not merely inert: it puts the PRD into
  `readyForAgentIds()`, so a bare `pnpm sandcastle` claims and plans the PRD itself.
  `/to-tickets-project` applies it to every ticket it publishes and verifies the wave afterwards.
- **It is orthogonal to `status: blocked`.** `ready-for-agent` says a human specified and cleared the
  slice; `status: blocked` is a human's note that some other issue must land first. Execution order
  comes from the dependency graph the planner builds, not from either label, and the loop never
  reads `status: blocked`. A cleared slice with an open blocker keeps both.

## Automated pre-triage

An open issue carrying `type: bug` or `type: maintenance` and **not** `ready-for-agent` is
pre-triaged by Claude following `.sandcastle/triage-prompt.md` — once per issue, marked by
`<!-- sandcastle-triage -->` in the comment, and in the body when promoted.

- `.github/workflows/triage.yml` runs it when such an issue is opened or the label is added.
  `workflow_dispatch` takes one issue number.
- `pnpm sandcastle:triage [n ...]` sweeps the backlog locally in the Docker sandbox.

**The claim is reproduced at HEAD.** A confirmed, non-redundant finding whose fix direction is
settled by SPEC or an ADR is **promoted automatically**: an `## Agent Brief` is appended to the body
(Category, Summary, Current, Desired, Fix direction, Key interfaces, Definition of Done, Owned
paths, Tenant isolation test, **Money invariant**, Verification, Out of scope), `ready-for-agent`
replaces `status: pending`, and the triage notes say so. Remove the label to hold it.

Refuted, insufficient, redundant or judgement-heavy findings get triage notes with the recommended
state **named, never applied**. Promotion is earned by a reproduction.

The redundancy search is **by domain concept, not by wording** — two issues describing the same
`ref_amount` recomputation in different words are one issue — and `.out-of-scope/*.md` is checked
before anything is promoted, so a previously-rejected idea is not re-litigated by a new ticket.

## Sentry-sourced tickets

`pnpm sandcastle:sentry` (and `.github/workflows/sentry-triage.yml`, weekly) reads Sentry for
recurring, high-impact production and staging errors and files the ones clearing its thresholds as
`type: bug` + `status: pending` — **never `ready-for-agent`**, because it has reproduced nothing.

Dedup is keyed on the `<!-- sentry-issue: SHORT-ID -->` marker across **open and closed** issues: a
closed ticket means the bug was fixed, and a re-file would be the routine's worst failure. A
recurrence more than a day after the fix shipped is filed as a **separate regression ticket** rather
than reopening the original, so the record of the first attempt survives.

Report-only by default locally; `--file-issues` writes. Thresholds live in
`.sandcastle/sentry-triage/policy.ts` — one diffable file, which is the first lever if it gets noisy.

## QA findings

QA findings from staging are filed as new issues with `qa-failed` (bugs) or `type: enhancement`
(taste). A `qa-failed` issue that touches an amount is filed with the money invariant it appears to
violate stated in the body, because that is the fastest thing for a triager to reproduce.
