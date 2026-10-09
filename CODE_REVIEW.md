# Code review

How a change to money-tracker.online is reviewed, by a person or by `om-code-review` (the engine
`om-auto-review-pr` runs on every PR). `.ai/review-checklist.md` is the per-PR tick list; this file
is the reasoning behind it and the severity each failure carries. `BACKWARD_COMPATIBILITY.md` lists
the protected surfaces, and `AGENTS.md` the rules every change is written under.

## Priorities, in order

1. **Money and tenancy are correct.** Both fail silently and weeks late. Read `docs/MONEY.md` when
   an amount, a rate, a currency or a date bucket is touched, and `docs/SPEC.md` §5.2 when a query
   is. A reviewer who has not read them cannot approve such a diff.
2. **Contracts hold.** Schema, stored money, queue messages, bindings, public routes, message keys
   (`BACKWARD_COMPATIBILITY.md`). A breaking change without its required path is a blocker.
3. **Security.** Validation is shape, never permission: a well-formed id from a client is not an
   authorised id, and `beforeLoad` is UX, not a data boundary. Secrets never enter a log, a
   screenshot, a test file or a PR body.
4. **The quality bar** of `docs/SPEC.md` §2 and §7, per surface: keyboard, focus, labels, both
   locales, both themes, both viewports, zero console output.

## Repo-specific checks

- **Data access.** Every query goes through the tenant-scoped base repository in
  `src/server/repos`, takes a `TenantScope` as its first parameter, and the tenant predicate cannot
  be removed by a caller. `docs/SPEC.md` §5.2 documents exactly two exceptions: `src/server/catalog`,
  guarded by `requirePermission` plus a platform audit-log write, and `billing_events`, whose two
  delivery writes take a bare `Database` because a webhook arrives before its workspace is known.
- **Money.** No float arithmetic on an amount anywhere, including a tooltip or a chart label. The
  scale is `currencies.digits`, never a hard-coded 2. `ref_amount_minor` is written once at the
  booked date's rate and never recomputed. Balances are rebuilt wholesale through the `LEDGER`
  Durable Object, never accumulated or written directly.
- **Server functions.** Input validated with Zod at the boundary and parsed a second time in the
  repository. Named exports only. Anything slow is enqueued on `TASKS`.
- **Queue and Durable Object.** Handlers are idempotent and safe on redelivery; a message shape
  change keeps the old `kind` handled for one release.
- **UI.** React Aria primitives from `components/ui`, which never fetch and never import from
  `server/`. Loading, empty and error states present. A drag surface has a keyboard path; a chart
  has a text table; colour is never the only channel.
- **Localisation.** A new key lands in `en.ts` and `pl.ts` in the same change; counts go through
  the plural machinery; stored rows carry keys, never sentences.
- **Accessibility.** WCAG 2.2 AA is a hard gate and five named AAA criteria are claimed
  (`docs/ACCESSIBILITY.md`). No copy, comment or commit may claim more.
- **Generated files.** `src/routeTree.gen.ts` and `drizzle/` are regenerated, never edited; the two
  drift commands in the validation gate leave no diff.
- **Dependencies.** The set is frozen (`docs/SPEC.md` §3). A new package is a blocker, not a
  judgement call.
- **Tests.** A new repository function has its tenant-isolation case; a money-touching write path
  has its money-invariant case; a behaviour change has a test that fails without it. No added
  suppression, skip or focus; no deleted test file.
- **A test that cannot fail proves nothing.** A pinning or guard test is seen red once: revert what
  it pins and read the failure. A count with no control, or a measurement that cannot reach the
  fault, passes on a broken tree (#541, #604, #623, #625); a pin never seen red is the major
  "without a failing-first test" of the table below.
- **Layout lives in the browser.** A behaviour carried only by classes (a stacked row, a popover
  width, `flex-shrink` under overflow) is asserted by a Playwright case that reads computed layout,
  with enough rows or width to reach the fault. jsdom computes no CSS, so a unit test stays green
  with the class deleted (#561, #577, #609); same severity.
- **Clean room.** Nothing is copied from the reference product (`docs/agents/reference.md`): not a
  string, a name, a number or a layout.
- **Numbers.** Every count in the PR body and the review came from a command whose output was read
  (`docs/SPEC.md` §7.7). The same holds for a figure written into a spec, a plan, an ADR or a code
  comment: it is re-derived on the head under review, and a headline total agrees with the table it
  summarises (#170, #191, #222, #250, #252, #253).
- **Governance documents.** `DESIGN.md`, `BACKWARD_COMPATIBILITY.md`, `docs/ACCESSIBILITY.md`,
  `docs/MONEY.md` and `docs/adr/` record decisions a person owns. A PR touching one is
  `risk-high`. Reviewing it means reading the decision, not only the
  diff's shape: what changed, what it supersedes, and whether the change belongs there.
- **Documents name what exists.** A spec, ADR, `SDLC.md`, skill or comment that names a file, job,
  test, label, automation or mechanism names one that exists on the branch and does what the text
  says; the reviewer opens each one (#159, #191, #304, #308, #310, #319). A backticked path in an
  agent-facing document is checked by `.ai/scripts/__tests__/doc-paths.test.mjs`; jobs, labels,
  automations and what a named thing does stay the reviewer's to open (#386, #421, #441).
- **A restated rule moves everywhere it is stated.** A PR that changes a rule, a gate, what a label
  means or who may do what searches the old wording across `*.md`, `*.yml`, `*.json`, the skill
  overrides and the workflow comments, and updates or removes every hit. Two documents that now
  disagree send an unattended run the wrong way (#386, #441, #493, #495).

## Review personas

The checks above are one lens: the code, judged against the rules. Four subagents in
`.claude/agents/` read the same diff from somewhere else, and each cites this repository's own
documents rather than general advice. They are dispatched by the reviewer - a person, or
`om-auto-review-pr` - on the diff they match:

| Persona                     | Dispatch it when the diff reaches                                                         | What it answers                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `manual-tester`             | `src/routes/**`, `src/components/**`, `src/styles/**`, `src/lib/i18n/messages/*`          | What a person hits off the happy path: the states, the keyboard path, both locales, both themes, the console  |
| `accessibility-specialist`  | the same user-facing set                                                                  | WCAG 2.2 AA by criterion number, and the five named AAA criteria - never a wider claim                        |
| `security-tenancy-reviewer` | `src/server/repos/**`, `src/server/auth/**`, `src/server/ledger/**`, billing, a migration | Whether a query can see another tenant's rows, and whether a permission is checked where a client can skip it |
| `product-owner`             | a plan area in `docs/plans/`, or acceptance criteria on the issue                         | Whether the change does what was asked, what it did beyond that, and what it decided quietly                  |

A persona **reports**. None of them edits source, applies a label - `qa-approved` least of all - or
merges; the reviewer weighs what comes back and owns the verdict. A finding a persona raises enters
the report at the severity this file's table gives it, not at the severity the persona felt.

They are not `om-synthetic-users`, which builds a panel from research material and outputs
`[SYNTHETIC]` hypotheses about people. These four read a diff and the rules in this repository, and
what they produce is a review finding.

Dispatching needs the `Task` tool. Every step in `.ai/cezar/workflows/` that reaches
`om-auto-review-pr` grants it. Where the tool is absent the review runs without personas and names them as not run.

## Severity

| Severity | What lands here                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| blocker  | Any money or tenancy rule above; a missing Zod parse; a client-side-only permission check; a missing tenant-isolation or money-invariant case; a key in one locale only; a hand-edited generated file; a non-additive migration; an added suppression, skip or deleted test; a clean-room violation; a bank connector (ADR 0008); a new dependency; a broken protected surface without its required path |
| major    | An AA accessibility regression; a blanket AAA claim; slow work run inline; a second implementation of an owned concept (SPEC §8); a missing loading, empty or error state; a behaviour change without a failing-first test; a written figure that no command reproduces; a document naming something that does not exist or does not do what it says, or a restated rule left out of step                |
| minor    | `TODO`, `console.log`, commented-out code, placeholder copy; a scope or naming convention missed; a docblock whose wording has drifted from the code while everything it names still exists and does what it says (a false claim is major)                                                                                                                                                               |
| nit      | Style the linter does not enforce                                                                                                                                                                                                                                                                                                                                                                        |

## Verdict

Any blocker, or any major without a documented waiver on the PR, is **request changes**. Minors
and nits alone are **approve**, listed so the author can pick them up. A review that did not run the
validation gate is not a review.
