# Foundations plan reconciliation

## 📝 TLDR

`docs/plans/00-foundations.md` describes a repository that no longer exists. Of its 56 `Owned paths`
entries, **29 name a file that is not on disk** — most shipped somewhere else, a few never shipped at
all, and one dependency the plan justified is imported by nothing. This spec reconciles the document
with HEAD under the precedence rule the plan set already carries, and adds a parser-backed guard so
the next divergence fails a test instead of quietly misleading the next agent that reads the plan.

The drift is not only bookkeeping. `00-S10` placed one `money-field.tsx` in `src/components/ui` so
that the product would have a single amount input; it never landed, and the product now carries
**two** amount-input components whose docblocks argue opposite premises. That is a `docs/SPEC.md` §8
violation of the _"one primitive per interaction pattern in `components/ui`"_ corollary. It is **not**
a breach of the money path: both components delegate parsing to `src/lib/money/`, so
`docs/MONEY.md` §7's one-parser rule is held. Whether the two agree numerically is **unmeasured**,
and this spec files that measurement rather than asserting its outcome.

## 📝 Problem Statement

`docs/plans/README.md` makes the plan set the **backlog source**: a stage becomes a spec, then an
issue, then a run. An agent scheduling work from `00-foundations.md` today is reading stale
instructions, and the failure is silent in both directions — it re-does work that shipped, and it
writes to paths that no other file uses.

### The measurement

Every number below came from a command run against this branch at `1a1715a`.

| Measure                                        | Value                    |
| ---------------------------------------------- | ------------------------ |
| Stages in `00-foundations.md`                  | 17 (`00-S1` … `00-S17`)  |
| Reference rows cited                           | 34 (`FND-01` … `FND-34`) |
| `Owned paths` entries                          | 56                       |
| Distinct paths behind those entries            | 40                       |
| **Entries whose path does not exist**          | **29**                   |
| Distinct paths that do not exist               | 27                       |
| Migrations the plan names / migrations on disk | 7 / 5                    |
| Primitives in `src/components/ui/*.tsx`        | 38                       |

**The counting rule, stated before the number rather than after it.** A path ending `/**` — there is
exactly one, `src/components/ui/**` — is resolved to its base directory and counted as present when
that directory exists. A naive `test -e` over the raw strings reports **30** missing instead of 29;
the one-entry difference is that glob. The audit tool of Step 1.2 implements the resolved rule, and
any re-derivation that reports 30 has skipped it rather than found a discrepancy.

56 entries but 40 distinct paths, because a path may be owned by several stages across waves:
`schema.ts` appears 7 times, `src/components/ui/index.ts` 5 times, `conventions.test.ts` and
`consumer.ts` twice each. The guard must deduplicate before reporting, or one absent path produces
seven identical failures.

**33 of the 34 reference rows read `missing → done`.** The exception is `FND-30`, which reads
`proposed → done`. Not one row carries a status that was re-measured after the work landed, so the
document cannot distinguish a row that shipped from a row that never started.

### The five drift classes

The 29 absent entries are not one problem. Each class takes a different correction, and the five
classes account for all 29 (12 + 7 + 4 + 2 + 4).

**Class A — moved (12 entries, 11 distinct paths).** The subject shipped, at another path.

| Plan says                               | Reality at HEAD                                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/db/enum-check.ts`           | `enumCheck()` is a module-private, unexported function at `src/server/db/schema.ts:309`                                                |
| `src/server/queue/consumer.ts` (×2)     | dispatch inlined in `src/server/worker.ts`; handlers in `src/server/queue/handlers/`, envelope parse in `src/server/queue/messages.ts` |
| `src/server/cron/scheduled.ts`          | `scheduled` inlined in `src/server/worker.ts`; sweeps in `src/server/cron/{budget-periods,budget-thresholds,recurring}.ts`             |
| `src/styles/__tests__/contrast.test.ts` | `src/styles/__tests__/tokens-contrast.test.ts`                                                                                         |
| `src/lib/__tests__/money.test.ts`       | split four ways: `money-{core,convert,allocate,format}.test.ts`                                                                        |
| `src/components/ui/chart-frame.tsx`     | `src/components/charts/chart-frame.tsx`                                                                                                |
| `src/components/ui/data-table.tsx`      | split: `src/components/charts/data-table.tsx` (chart text equivalent) and `src/components/app/transactions/transaction-list.tsx`       |
| `src/components/ui/filter-bar.tsx`      | `src/components/app/transactions/filter-bar.tsx`                                                                                       |
| `src/components/ui/reorder-menu.tsx`    | `GridListMoveButton` inside `src/components/ui/grid-list.tsx`                                                                          |
| `src/components/ui/widget-frame.tsx`    | `src/components/app/dashboard/widget-frame.tsx`                                                                                        |
| `src/components/ui/grid-cell.tsx`       | `src/components/app/dashboard/widget-grid.tsx`                                                                                         |

Three of these — `enumCheck`, the queue dispatch, the cron switch — were **inlined** rather than
relocated, which is a different correction: there is no file to point at, only a host module.

**Class B — generator-owned name (7 entries).** The plan names seven migrations semantically
(`0000_init.sql` … `0006_loans.sql`). Drizzle chooses its own names and five exist:
`0000_real_spitfire.sql`, `0001_nosy_magneto.sql`, `0002_seed_currency_catalogue.sql`,
`0003_tough_vindicator.sql`, `0004_saas_billing_events.sql`. The plan is asserting control over a
filename the generator owns, so the requirement is unenforceable as written. Two of the seven
(`0005_billing_and_console.sql`, `0006_loans.sql`) also have no counterpart at all — the loan tables
are absent from `schema.ts` — but that is a fact about the row's status, settled in Step 2.3, not
about the filename.

**Class C — absent (4 entries, 3 distinct paths).** Never shipped anywhere:
`src/server/db/__tests__/conventions.test.ts` (owned twice, by `00-S1` and `00-S5`),
`src/components/ui/install-prompt.tsx`, `src/components/ui/offline-banner.tsx`. These are real open
gaps and the reconciliation must **not** erase them.

`src/server/__tests__/wrangler-config.test.ts` is also absent and is also a real gap, but it is named
only under `00-S2`'s _Verification_ heading and never under `Owned paths` — so it is outside the 29
and outside the guard's reach. Step 2.3 re-measures it as part of `FND-04`/`FND-05`.

**Class D — forked (2 entries).** `src/components/ui/money-field.tsx` and its test. The single owner
was never built, and its responsibility landed in two feature components instead:
`src/components/app/transactions/amount-field.tsx` (161 lines, built on React Aria `NumberField`) and
`src/components/app/accounts/amount-field.tsx` (146 lines, built on `TextField`). Each docblock treats
the other's approach as the defect — the transactions file argues that serialising through a canonical
decimal string makes the `NumberField` route exact; the accounts file argues that `NumberField` "hands
back a decimal `number` — which is a major-unit float, the one representation this product does not
allow an amount to take".

What this is: a violation of `docs/SPEC.md` §8, _"one primitive per interaction pattern in
`components/ui`"_. What it is **not**: a second parser. Neither file defines a parse function or a
regex; both delegate to `src/lib/money/` (`parseMoney` at `format.ts:406`, `scaleDecimalString` at
`rounding.ts:76`), so `docs/MONEY.md` §7 is held. Whether those two functions agree on a half-way tie
is unmeasured, and measuring it is follow-up issue 2 — not this spec's work, because it is a money
change and this is a docs change.

**Class E — test follows subject (4 entries).** `__tests__` entries whose subject is in Class A or C
and which therefore inherit that class's correction:
`__tests__/{chart-frame,reorder-menu,grid-cell}.test.tsx` follow their moved subjects;
`__tests__/offline-banner.test.tsx` follows an absent one.

### Class F is not a path

`@tanstack/react-table` is declared in `package.json` and imported by **zero** files under `src/`.
Stage `00-S8` is the only justification for it in the repository, and `00-S8`'s `data-table.tsx` never
landed — the virtualised list that did land uses `@tanstack/react-virtual` alone. This is drift, but
it is not an `Owned paths` entry, so it sits outside the 29 and outside the guard.

## 📝 Proposed Solution

Three moves, each shippable on its own.

**1. Audit and classify.** Re-measure every reference row and owned-path entry against HEAD and assign
each to a class. The output is evidence, not prose: a table a reviewer re-derives by re-running a
command.

**2. Rewrite `00-foundations.md`.** Correct paths to where things are, restate the migration
requirement in terms the generator does not own, re-measure every row's status, and keep the Class C
and D gaps open as live stages rather than deleting them.

**3. Add the drift guard.** A test that parses the plan's `Owned paths` bullets and fails when an
entry names a path that is not on disk without a matching open row.

### Why not the alternatives

**Move the code to match the plan.** Rejected. Eight of the eleven Class A paths are file moves and
three are inlined implementations that would have to be extracted — a large, runtime-affecting change
to satisfy a document, and one that contradicts the plan set's own precedence rule (below).

**Delete the plan.** Rejected. `docs/plans/README.md` → _Coverage_ claims every capability is planned,
bounded, or protocol; deleting `00-foundations.md` breaks that claim and leaves the eight shared paths
with no single writer.

**Regenerate the plan from the code.** Rejected. It would erase the Class C and D gaps, which are the
plan's most valuable content: they are the only record that the enforcement the plan designed was
never built.

## 📝 Architecture

### The precedence rule is already written down

The load-bearing decision — when plan and code disagree, which wins? — is not this spec's to invent.
`docs/plans/README.md` already rules:

> When a plan and an already-worked issue disagree, the issue wins and the plan is amended to say so.

Applied here: **the code wins on location and naming; the plan wins on invariants.** A path is
corrected to where the thing actually is. An invariant the plan asserts and the code does not hold
stays an open row and keeps its stage.

### One concept, one owner (`docs/SPEC.md` §8)

The new concept is **plan-path drift**: the divergence between a plan's declared `Owned paths` and the
files on disk. Its owner module is a single parser:

- `scripts/plans/parse-plan.ts` — **the** reader of a plan document's stage structure. Parses the
  `## Stage NN-Sk` blocks, the `### Owned paths` bullets and their `— new|edit` suffix, returns a
  typed structure. Everything else calls it.
- `scripts/plans/__tests__/plan-paths.test.ts` — the guard, a consumer.
- `scripts/plans/audit.mts` — the audit report, a consumer.

`docs/plans/TEMPLATE.md:25` already states that the `Owned paths` bullet shape is what "the collision
checker parses". This parser is that reader, made real and given one home.

### Placement and runner

`scripts/plans/` rather than `src/`, because it is repository tooling and ships in no bundle. The
`tooling` vitest project already includes `scripts/**/__tests__/*.test.{ts,mjs}` at
`vitest.config.ts:133`, so the guard is picked up by `pnpm test` with **no change to
`vitest.config.ts`** — which matters, because that file is shared and every avoided edit to it is an
avoided collision.

There are currently **zero** `.ts` files under `scripts/`; the sole precedent is
`scripts/seed/__tests__/categories-palette.test.mjs`. So the runner must be named rather than assumed:
`parse-plan.ts` is TypeScript (the vitest project compiles it), and the audit is `audit.mts` invoked as
`pnpm exec tsx scripts/plans/audit.mts` — `tsx@^4.23.12` is already in `devDependencies`, so this adds
no package. A plain `.mjs` audit could not import the `.ts` parser, and two parsers is the failure this
whole spec is about.

### What the guard asserts, and what it deliberately does not

For each plan file on its opt-in list, after deduplicating paths:

1. Every entry marked `— edit` names a path that exists. An edit to a file that is not there is a
   contradiction on its face.
2. Every entry marked `— new` names a path that either exists, or is covered by a reference row in the
   same file whose status is still open.
3. Every stage carries the twelve `###` headings `TEMPLATE.md` requires, in order.
4. Every reference-row status line contains a backticked path or test name that resolves on disk.
   This is the assertion that makes Step 2.3 checkable: _Risks_ names "a Class C gap quietly
   reclassified as shipped" as the real risk of this change, and without this assertion that risk
   lives in the one step with no machine check.

Does **not** assert: that a shipped file does what the stage said it would. That is a code review, not
a path check, and a guard that pretended to do it would be trusted for something it cannot deliver.

### The opt-in list

The guard covers `00-foundations.md` only at first, named in a checked-in list beside the parser.
**28** other plan files carry `Owned paths` headings (`01-` … `28-`; `98-` and `99-` carry none, and
`TEMPLATE.md` carries the template block itself). They almost certainly hold the same drift, but this
run measured plan 00 and will not assert a number it did not produce. Each further plan joins the list
as it is reconciled, one issue each. A guard turned on over 28 unmeasured files is a red suite on day
one, which is how a guard gets deleted rather than fixed.

### Two conflicts with `TEMPLATE.md`, named rather than left to be discovered

The guard would make two of `TEMPLATE.md`'s own instructions unfollowable. Both are resolved by
amending `TEMPLATE.md` in the same change, not by quietly diverging from it:

- **`TEMPLATE.md:76`** says _"Name the migration `pnpm db:generate` will produce"_. Step 2.2 removes
  migration filenames from `Owned paths`. Resolution: the instruction is scoped to _Data and
  migration_ prose — where naming the expected migration is useful — and `TEMPLATE.md` gains an
  explicit sentence that a `drizzle/*.sql` filename never appears under `Owned paths`, for the same
  reason `src/routeTree.gen.ts` never does (`README.md:211`).
- **`TEMPLATE.md:57`** forbids globs _"except a `__tests__` directory the stage owns wholly"_, yet
  `00-S6` owns `src/components/ui/**`. That glob is sanctioned separately as a shared path
  (`README.md:210`), and `TEMPLATE.md` gains the sentence saying so.

## 📝 Data Model, API contracts and UI

No schema change, no migration, no table, no column; no server function, API route, queue envelope or
cron trigger; no route, component or rendered surface. The one new contract is internal tooling:
`parsePlan(markdown: string): PlanFile` in `scripts/plans/parse-plan.ts`, not reachable from the Worker
and not bundled. `docs/SPEC.md` §2's ten clauses do not apply — no surface — and for the same reason
there is no axe run and no browser evidence.

## 📝 Visual change expected

**None.** One edited Markdown document under `docs/plans/`, one amended `TEMPLATE.md`, one new module
and two new test/tool files under `scripts/plans/`. No route, component, token or style file is
touched, so no pixel moves in either theme at any width.

## 📝 Copy

**No user-facing copy.** This change adds, edits and removes **zero** message keys, so there is nothing
to land in the `en` and `pl` catalogues and the i18n parity test is unaffected. Assertion messages in
`plan-paths.test.ts` are developer-facing test output, not product copy.

## 📝 Edge Cases & Failure Scenarios

| Case                                                                              | Behaviour                                                                                                                                                       |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An owned path is a directory glob (`src/components/ui/**`)                        | The parser resolves the base directory and asserts it exists; it never expands the glob, because expanding it would fail whenever a file is legitimately added. |
| A path exists but is a directory where a file was declared                        | Fails, naming both the declared kind and what was found. A silent pass here is how `enum-check.ts` became a function inside `schema.ts` unnoticed.              |
| The same path is owned by several stages                                          | Deduplicated before reporting: `schema.ts` is owned 7 times and must not produce 7 identical failures.                                                          |
| A generated file (`src/routeTree.gen.ts`, `drizzle/*.sql`) is under `Owned paths` | Fails. Makes the existing prose rules mechanical — and is why `TEMPLATE.md` is amended in the same change.                                                      |
| A stage loses a required heading                                                  | Fails on assertion 3, naming the stage id and the missing heading.                                                                                              |
| A reference row claims `→ done` but cites nothing that resolves                   | Fails on assertion 4. This is the guard against the risk _Risks_ calls the real one.                                                                            |
| A plan file joins the opt-in list while still drifted                             | Fails loudly on the PR that adds it, which is the intended moment — never on an unrelated PR.                                                                   |
| `00-foundations.md` is renamed or deleted                                         | Fails with "listed plan file not found" rather than passing over an empty set. A guard that passes when its input vanishes is worse than none.                  |

## 📝 Risks & Impact Review

**Blast radius: documentation and one tooling test.** No runtime code path changes, so there is no
behaviour to regress, no migration to roll back and no deploy risk. Rollback is `git revert` of a
docs-and-tooling commit.

**The real risk is the opposite of the usual one.** Not that this change breaks something, but that the
rewrite is done carelessly and the reconciled document is wrong in a new way — a Class C or D gap
quietly reclassified as shipped, erasing the record that the enforcement was never built. Guard
assertion 4 exists for exactly this and is the reason it is in the guard rather than in a review
checklist.

**A review criterion for this PR:** any diff touching `src/` is out of scope. This change lives in
`docs/plans/` and `scripts/plans/` and nowhere else.

**Protected surfaces:** none. `BACKWARD_COMPATIBILITY.md` lists no plan document and no `scripts/`
module.

**Dependency freeze:** this spec adds no package — `tsx` is already in `devDependencies`. It _reports_
one, `@tanstack/react-table`, declared and imported nowhere, and routes the decision to a human,
because `docs/SPEC.md` §3.1 makes the freeze absolute and `AGENTS.md` puts removing a dependency under
**Ask First**. Nothing here edits `package.json` or `pnpm-lock.yaml`.

**Findings surfaced but not fixed**, each filed as its own issue:

1. `@tanstack/react-table` declared and unused. A human decides: remove it, or schedule `00-S8`'s
   `data-table.tsx`.
2. Two `amount-field.tsx` components — a `docs/SPEC.md` §8 `components/ui` violation. The issue carries
   a committed differential test over `parseMoney` and `scaleDecimalString` (`1.015`, `0.125`,
   `1 234,56` in `pl`, JPY, KWD) to establish whether they agree; consolidating the component is a
   money-path change and belongs on its own PR.
3. `docs/plans/OPEN-FINDINGS.md` is named in `README.md` as the per-plan findings register and does not
   exist.
4. The 28 other plan files are unmeasured and probably carry the same drift.

## 📝 Resolved assumptions (autonomous defaults)

This spec ran unattended. Each question was resolved to the most reversible option; all are overridable
before merge.

| #   | Question                                                                                 | Resolution                                                                                                             | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Reconciliation and the tooling are independently deployable — split into two specs?      | **No, but the seam is acknowledged.** One spec, three phases.                                                          | An adversarial review of this spec was right that Phase 2 ships without the parser and the parser ships without Phase 2 — they _are_ separable, and the earlier "the guard proves the rewrite" argument was sequencing dressed as cohesion. They ship together because a parser with no reconciled file to run over is speculative tooling. A reviewer who prefers the split should take it; the seam is between Phase 2 and Phases 1+3. |
| Q2  | When plan and code disagree, does the plan move to the code or the code to the plan?     | **Code wins on location and naming; plan wins on invariants.**                                                         | Not an invention: `docs/plans/README.md` already rules that the already-worked issue wins and the plan is amended. Relocating eight modules and extracting three inlined ones to satisfy a document would be a large runtime change on a docs ticket.                                                                                                                                                                                    |
| Q3  | What happens to a row whose invariant is genuinely unmet (Class C/D)?                    | **Stays open.** Re-measured to `missing`, keeps or gains a stage.                                                      | Deleting it erases the only record that the designed enforcement was never built — the least reversible mistake available here, so it gets the most conservative answer.                                                                                                                                                                                                                                                                 |
| Q4  | Does the guard cover all plan files or only plan 00?                                     | **Plan 00 only**, via a checked-in opt-in list.                                                                        | This run measured plan 00 and nothing else. Asserting over 28 unmeasured files produces a red suite on day one, and a guard red on arrival gets deleted. Widening the list later is a one-line change.                                                                                                                                                                                                                                   |
| Q5  | The unused `@tanstack/react-table` — remove it, or schedule the stage that justifies it? | **Neither here.** A `### Blockers` entry on the reconciled `00-S8` with disposition **defer**, plus a follow-up issue. | `docs/SPEC.md` §3.1 makes the freeze absolute and `AGENTS.md` puts dependency changes under **Ask First**. A design-only spec is not where that decision is spent.                                                                                                                                                                                                                                                                       |
| Q6  | Does the amount-field measurement belong in this spec?                                   | **No.** Moved out to follow-up issue 2, as a committed test rather than a throwaway measurement.                       | It is a money-path investigation, and this is a docs reconciliation. Keeping it would have made the spec's own scope argument inconsistent — and a "throwaway measurement recorded in an issue comment" fails `AGENTS.md`'s rule that every number came from a command whose output was read.                                                                                                                                            |

No assumption carries `⚠ NEEDS HUMAN CONFIRMATION`: every one is a documentation choice reversible by
editing Markdown, and none weakens security, tenant scoping, the money path or a
`BACKWARD_COMPATIBILITY.md` surface.

## 📋 Phasing

**Phase 1 — Audit.** Ship the parser and the audit report; produce the reproducible drift table.
Nothing in `docs/` changes yet, and the parser earns its place even if the reconciliation is abandoned.

**Phase 2 — Reconcile.** Rewrite `00-foundations.md` from the Phase 1 table and amend `TEMPLATE.md`.
The document is correct afterwards whether or not the guard ever lands.

**Phase 3 — Guard.** Turn the test on over `00-foundations.md` and file the four follow-up issues.
Green only because Phase 2 landed.

## 📋 Implementation Plan

### Phase 1 — Audit

**Step 1.1 — The plan parser.** Add `scripts/plans/parse-plan.ts` exporting `parsePlan(markdown)`,
returning each stage's id, its `###` headings in document order, its `Owned paths` entries as
`{ path, kind: 'new' | 'edit' }`, and its reference rows with their status lines. Pure function over a
string, no filesystem access.
_Verify:_ `scripts/plans/__tests__/parse-plan.test.ts` parses an inline fixture and asserts stage count,
heading order, that `` `path` — new `` and `` `path` — edit `` are distinguished, and that a status line
is captured. `pnpm test` green.

**Step 1.2 — The audit report.** Add `scripts/plans/audit.mts`, run as
`pnpm exec tsx scripts/plans/audit.mts docs/plans/00-foundations.md`. It reads through the parser,
resolves globs to their base directory, deduplicates paths, stats each, and prints the drift table
grouped by class. To stdout, never to a file in the repository — `AGENTS.md` forbids leaving a report
in the tree.
_Verify:_ against `00-foundations.md` it reproduces **56 entries / 40 distinct / 29 missing entries /
27 distinct missing**, and reports 30 under the naive rule so the glob's effect is visible rather than
hidden. A different result means this spec's numbers are wrong and is resolved before Phase 2 starts.

**Step 1.3 — The class map.** Add `scripts/plans/drift-classes.ts`: checked-in data mapping each of the
29 absent entries to its class and, for Class A, to the path or host module it moved to. Data, not
logic, so the audit can report classes instead of only absences.
_Verify:_ the audit prints 12 / 7 / 4 / 2 / 4 across classes A–E, summing to 29. A map that does not
sum to the measured total fails.

### Phase 2 — Reconcile

**Step 2.1 — Correct the Class A paths.** For each of the 12 entries, replace the declared path with
the one `drift-classes.ts` records. Where the subject was inlined rather than moved (`enumCheck`, the
queue dispatch, the cron switch), the entry names the host module and a sentence says it is inlined and
why that is acceptable — or, where it is not, the row stays open with a stage to extract it.
_Verify:_ the audit reports that **every path named in the Class A column of `drift-classes.ts` now
appears in the plan and exists on disk** — an executable check, unlike "zero Class A entries", which no
tool can evaluate and which would pass if a path were corrected to the wrong existing file.

**Step 2.2 — Restate the migration requirement, and amend `TEMPLATE.md`.** Replace the seven semantic
filenames with the requirement the generator cannot invalidate: _"`pnpm db:generate` produces exactly
one new file under `drizzle/`; its name is the generator's and is not asserted here."_ Name each
migration by the tables it creates. In the same commit, add to `TEMPLATE.md` the two sentences from
_Architecture_ → _Two conflicts_, so the template and the guard agree.
_Verify:_ no `drizzle/*.sql` filename appears under any `Owned paths` heading;
`pnpm db:generate < /dev/null && git diff --exit-code -- drizzle/` stays clean.

**Step 2.3 — Re-measure every reference row.** Move each of the 34 rows from its unmeasured status to
the measured one. A row that shipped reads `missing → done` and cites a backticked path or test that
resolves; a Class C/D row reads `missing → missing` and keeps its stage. `FND-30` starts from
`proposed`, not `missing`.
_Verify:_ guard assertion 4, run early — every `→ done` row cites something that exists on disk. This is
a machine check, not a prose check.

**Step 2.4 — Stage register and Blockers.** Update the register table to reflect which stages closed.
Add the `@tanstack/react-table` **defer** entry under `00-S8`'s `### Blockers`, per `docs/SPEC.md`
§3.1's four dispositions.
_Verify:_ `pnpm test` and `pnpm lint` green; `pnpm check` leaves both documents prettier-clean.

### Phase 3 — Guard

**Step 3.1 — The guard test.** Add `scripts/plans/__tests__/plan-paths.test.ts` and the opt-in list
naming `docs/plans/00-foundations.md`, asserting the four properties from _Architecture_.
_Verify:_ `pnpm test` green. Then break one path in the reconciled plan and confirm the test goes red
naming that stage and that path — a guard nobody has watched fail is not yet a guard. Revert the break.

**Step 3.2 — The full gate.** Run all six commands from `.ai/agentic.config.json` →
`validation.commands`, in order.
_Verify:_ all six pass, with `pnpm generate-routes` and `pnpm db:generate` both leaving a clean diff. If
either does not, something outside this scope was touched.

**Step 3.3 — File the four follow-ups.** One issue each for the findings in _Risks & Impact Review_,
citing this spec and carrying category, priority and risk labels.
_Verify:_ four issue numbers, referenced back from the reconciled plan at the row or Blockers entry they
belong to.
