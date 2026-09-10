# Plan guard: assert the eight shared paths under `Owned paths`

| Field              | Value |
| ------------------ | ----- |
| **Status**         | ready |
| **Issue**          | #216  |
| **Spec PR**        | #222  |
| **Implementation** | none  |

## 📝 TLDR

`docs/plans/README.md` states the load-bearing half of the wave concurrency contract plainly: the
eight shared paths belong to `00-foundations.md` and to nothing else, in any wave, and a stage whose
`Owned paths` list contains one of them "is malformed and is rejected before it is scheduled"
(`docs/plans/README.md:43`, `:239`). Nothing asserts it. The four assertions in
`scripts/plans/audit.ts` check that declared paths exist, that headings are present and ordered, and
that closed reference rows cite something on disk — none of them checks _who is allowed to own a
path_. The rejection is a human reading a document.

This spec adds the fifth assertion to `auditPlan`, in the same `Violation` shape as the other four,
so a failure names the stage, the line and the path; single-sources the eight-path list against the
README table that defines it; and runs the assertion over **every** plan document rather than only
the three on the guard's opt-in list. That last part is safe today because it was measured: of the 638
`Owned paths` entries in the 31 plan documents, 29 name a shared path and all 29 are in
`00-foundations.md`, which is the one document allowed to declare them.

Tooling only. No runtime surface, no schema, no repository, no amount, no user-facing copy.

## 📝 Problem Statement

`docs/plans/README.md` makes the plan set the backlog source: a stage becomes a spec, then an issue,
then an autonomous run. The wave contract is what lets two of those runs execute concurrently, and it
rests on three properties (`docs/plans/README.md:42`–`:52`). The second is that the eight shared
paths — `src/server/db/schema.ts`, `src/server/worker.ts`, `wrangler.jsonc`, `src/styles/tokens.css`,
`src/components/ui/**`, `src/routeTree.gen.ts`, `src/lib/plans.ts`, `src/lib/money.ts` — are owned by
`00-foundations.md` alone. The README explains per path what breaks otherwise: two stages adding
columns to `schema.ts` in parallel corrupt each other silently; a second writer on `tokens.css` is
silent visual drift; a duplicate design-system primitive is a defect rather than a merge conflict.

### The gap is not theoretical

It was found by the design-system plan reconciliation (#201,
`.ai/specs/2026-09-08-design-system-plan-reconciliation.md`). Stage `01-S2` declares
`src/lib/motion.ts` and `src/styles/motion.css`; the subject of the second actually shipped inside
`src/styles/tokens.css`, one of the eight. The obvious correction — repointing the entry at the file
where its subject is — would have produced a **malformed** stage, and **the guard would have passed
it**: assertion 2 checks that a `— new` path exists and says nothing about who may own it. The
reconciliation resolved the collision by requisition instead, and checked the shared-path rule by
grepping, because the guard cannot see it. That grep is what this spec replaces with an assertion.

### What the guard checks today

`scripts/plans/audit.ts` exports `auditPlan`, which `scripts/plans/__tests__/plan-paths.test.ts`
imports so the CLI report and the suite can never disagree about what an assertion means. Four
assertions ship there (`audit.ts:27`–`:41`):

| #   | Assertion                                                                | What it cannot see   |
| --- | ------------------------------------------------------------------------ | -------------------- |
| 1   | every `— edit` entry names a path that exists, unless a stage creates it | who may own the path |
| 2   | every `— new` entry exists, or its stage still has an open reference row | who may own the path |
| 3   | every stage carries the twelve required headings, in order               | anything about paths |
| 4   | every `→ done` row cites a path that resolves on disk                    | `Owned paths` at all |

The suite adds one rule of its own, outside `auditPlan`: `GENERATED_PATHS` in the test file rejects
`src/routeTree.gen.ts` and `drizzle/*.sql` under `Owned paths`, because `AGENTS.md` forbids editing a
generated file by hand. That rule is adjacent to this one and deliberately stays: see
[The overlap with `GENERATED_PATHS`](#the-overlap-with-generated_paths).

### The measurement

Every number below came from a script run against this branch after it was merged up to
`origin/develop` at `37789ca` (`git rev-list --count origin/develop..HEAD` → `0` for the base side). The script parsed each
document with the repository's own `parsePlan` — not a second regex — and matched `Owned paths`
entries against the eight paths using the prefix rule this spec specifies below.

| Measure                                                  | Value                       |
| -------------------------------------------------------- | --------------------------- |
| Plan documents matching `docs/plans/NN-*.md`             | 31 (`00`–`28`, `98`, `99`)  |
| Stages across them                                       | 104                         |
| `Owned paths` entries across them                        | 638                         |
| Entries naming one of the eight shared paths             | **29**                      |
| Documents carrying at least one such entry               | **1** (`00-foundations.md`) |
| Entries in every document other than `00-foundations.md` | **0**                       |
| Documents on `GUARDED_PLANS` today                       | 3                           |

The 29 break down as: 15 exact-path entries naming 6 of the eight paths (`schema.ts` ×7 across
`00-S1`, `00-S5`, `00-S7`, `00-S9`, `00-S11`, `00-S14`, `00-S17`; `worker.ts` ×2; `wrangler.jsonc`
×2; `plans.ts` ×2; `tokens.css`; `money.ts`) and 14 entries on the `src/components/ui/**` side, of
which one is the glob itself (`00-S6`, line 608) and thirteen are individual files beneath it
(`index.ts` ×4, `data-table.tsx`, `grid-list.tsx`, `money-field.tsx`, `install-prompt.tsx`,
`offline-banner.tsx` and four of their tests). Seven of the eight paths are represented; the one
that never appears is `src/routeTree.gen.ts`, which `GENERATED_PATHS` already rejects under
`Owned paths` on the three `GUARDED_PLANS` documents — the overlap Q6 keeps deliberately, and the
reason it is an overlap rather than a duplicate is that this assertion also covers the other 28.

Two consequences follow, and both shape the design:

1. **The exemption is not a courtesy, it is 29 entries.** An assertion without it turns the one
   document allowed to declare shared paths into 29 failures.
2. **The assertion can run over the whole set today and stay green.** Unlike the four drift
   assertions — opt-in because 26 unreconciled documents carry drift nobody has read
   (`plan-paths.test.ts:11`–`:28`) — this rule has zero violations outside the exempt document. So
   the acceptance criterion on #216, _"a stage in **any plan** but `00-foundations.md`"_, is
   achievable now rather than one document at a time.

## 📝 Proposed Solution

A fifth assertion inside `auditPlan`, plus one list and one whole-set test case.

1. **`SHARED_PATHS` in `scripts/plans/audit.ts`**, exported, beside `REQUIRED_HEADINGS` — the eight
   paths exactly as `docs/plans/README.md` writes them, glob included.
2. **`sharedPathViolations`**, exported from the same module: a pure function over the parsed plan
   and the document's path, returning `Array<Violation>`. `auditPlan` calls it to build assertion 5;
   the whole-set test case calls it directly, so the two can never disagree — the same reuse rule
   that already makes `audit.ts` the single home of the other four.
3. **`auditPlan` gains assertion 5** in the existing `assertions` array. `Assertion['id']` widens
   from `1 | 2 | 3 | 4` to `1 | 2 | 3 | 4 | 5`, and the module docblock's _"The four assertions"_
   section becomes five. `describe.each(GUARDED_PLANS)` picks it up with no wiring, because its cases
   are generated from `audit.assertions`.
4. **A whole-set case** in `plan-paths.test.ts` runs `sharedPathViolations` over every
   `docs/plans/NN-*.md`, so the rule holds for the 29 documents that are not yet reconciled.
5. **A parity case** asserts `SHARED_PATHS` against the first column of the README's _The eight
   shared paths_ table, so the encoded list cannot silently drift from the document that defines it.

### Alternatives considered

**Put the list in `plan-paths.test.ts` beside `GENERATED_PATHS`.** The issue offers this as one of
two homes. It loses: the assertion lives in `auditPlan`, so `audit.ts` would have to import from its
own test to build the report — and the CLI would print an assertion whose definition it could not
reach. `GENERATED_PATHS` sits in the test precisely because it is _not_ an `auditPlan` assertion; the
shared-path rule is.

**Parse `docs/plans/README.md` at run time as the sole source of the eight.** Attractive — one list,
by construction. It loses on failure mode: `auditPlan` would read a second file and couple the guard
to the README's markdown table formatting, so a prettier reflow or a column rename would break the
guard for a reason that is about neither the plan nor the tree. The parity case buys the same
protection with the failure landing where it belongs — one red test naming the two lists — while the
guard itself keeps working off a constant.

**Widen `GENERATED_PATHS` to cover all eight.** It loses because the two rules have different
exemptions and different messages. `GENERATED_PATHS` applies to every document including
`00-foundations.md`; the shared-path rule exempts it. Merging them would either exempt
`routeTree.gen.ts` inside plan 00 (a hole — see below) or fail plan 00 on its 29 legitimate entries.

## 📝 Architecture

Owner module: `scripts/plans/audit.ts` (`docs/SPEC.md` §8 — one concept, one owner). It already owns
"what an assertion means"; the shared-path rule is an assertion, so it lands there rather than
growing a fifth module.

```
docs/plans/README.md            the rule, in prose + the table that lists the eight
        │  (parity case asserts the table's first column ≡ SHARED_PATHS)
        ▼
scripts/plans/audit.ts          SHARED_PATHS + sharedPathViolations + auditPlan (assertion 5)
        │                                   │
        │ CLI report                        │ imported by
        ▼                                   ▼
`pnpm exec tsx scripts/plans/audit.ts`   scripts/plans/__tests__/plan-paths.test.ts
  prints 5 assertions, exit 0             ├─ describe.each(GUARDED_PLANS) → assertion 5, automatic
                                          ├─ describe.each(ALL_PLANS)     → sharedPathViolations
                                          └─ parity case                  → README table
```

Nothing else changes. `parse-plan.ts` is untouched: the grammar already yields
`{ path, kind, line }` per entry, which is everything the rule needs. `drift-classes.ts` is
untouched. No dependency is added (`docs/SPEC.md` §3 freeze).

### The matching rule

`docs/plans/README.md` writes seven of the eight as concrete files and one as a glob. They therefore
match differently, and the difference is the whole reason the rule needs code rather than a `grep`:

- **Seven exact.** An entry violates when its path string equals the shared path. `src/lib/money.ts`
  is shared; `src/lib/money-format.ts` is not, and a substring test would confuse the two — the
  mistake `mentionsPath` already exists to avoid elsewhere in this module (`audit.ts:169`–`:187`).
- **`src/components/ui/**` by prefix.** An entry violates when it is the glob itself, the bare
  directory `src/components/ui`, or anything beneath it (`src/components/ui/index.ts`,
  `src/components/ui/__tests__/data-table.test.tsx`). Twelve of plan 00's 29 entries are of the last
  kind, so a rule matching only the literal glob would miss the case the README cares most about: a
  feature stage claiming one primitive file.
- **Comparison is on the path as written**, before `resolveOwnedPath` strips a trailing `/**`. A
  feature stage writing `src/styles/tokens.css/**` is malformed for a different reason and is already
  caught by assertions 1–2; the shared-path rule reports what the document says.

Both `— new` and `— edit` entries are in scope. `Owned paths` is an ownership declaration, and the
README's rule is about the list, not the kind — a feature stage declaring
`src/server/db/schema.ts — edit` is exactly the parallel-column-write collision the wave contract
forbids. Plan 00 itself declares shared paths both ways (7 `edit`, and `new` at `00-S1`).

### The exemption

`00-foundations.md` is exempt, keyed on the **basename** of the document under audit rather than on a
full path string. `auditPlan` is invoked with a repo-relative path by both `pnpm exec tsx` and the
suite, but the exemption should not depend on that: an absolute path handed to the CLI must behave
identically, and a rule that silently stopped exempting the document when the caller changed shape
would fail plan 00 on 29 entries for a reason that is about argument formatting.

### The overlap with `GENERATED_PATHS`

`src/routeTree.gen.ts` appears in both lists, and that is correct rather than redundant. The README
says of it: _"Generated. Travels inside a stage's diff but is **never listed** under Owned paths"_ —
never, by anyone, including `00-foundations.md`. The shared-path rule exempts plan 00; the generated
rule does not. Keeping both is what preserves the README's stricter statement: a stage in plan 00
that listed `src/routeTree.gen.ts` would pass assertion 5 (exempt) and still fail the generated-path
case. A stage in any other document that listed it fails both, with two messages that say different
true things — _this file is generated_ and _this file is not yours to own_.

### Scope boundary

The rule reads `Owned paths` and nothing else. A shared path appearing in a stage's **Reference
rows**, prose, or `Data and migration` requisition text is not a violation — the README's requisition
route is _"a feature stage that needs a change to a shared path writes the requirement under its own
Data and migration, UI or Quota heading and stops"_ (`docs/plans/README.md:237`). Asserting against
prose would make the documented escape hatch unusable.

## 📝 Data Model

None. No table, no column, no migration, no D1 change. `docs/SPEC.md` §6.1 is untouched: this spec
adds no SQL, so no repository and no `TenantScope` are involved, and no tenant-isolation case is
required. No amount is read or written, so `docs/MONEY.md` does not apply and no money-invariant case
is required.

## 📝 API Contracts

No server function, no API route, no Zod schema — nothing crosses a network boundary. The contracts
that change are two module exports and one type, all inside `scripts/plans/`:

```ts
/** The eight paths `docs/plans/README.md` reserves for `00-foundations.md`. */
export const SHARED_PATHS = [
  'src/server/db/schema.ts',
  'src/server/worker.ts',
  'wrangler.jsonc',
  'src/styles/tokens.css',
  'src/components/ui/**',
  'src/routeTree.gen.ts',
  'src/lib/plans.ts',
  'src/lib/money.ts',
] as const

/** The document allowed to declare all eight. Matched by basename. */
export const SHARED_PATH_OWNER = '00-foundations.md'

/**
 * `Owned paths` entries that name a shared path in a document that is not
 * {@link SHARED_PATH_OWNER}. Empty for the owner itself.
 */
export const sharedPathViolations: (
  plan: PlanFile,
  planPath: string,
) => Array<Violation>

// widened, so the report and the suite can address the new assertion
export type Assertion = { readonly id: 1 | 2 | 3 | 4 | 5 /* … */ }
```

`Violation` is unchanged (`{ stage, line, detail }`), which is what makes the failure read like the
other four. The `detail` names the entry and the path it collides with:

```
04-S2 (line 118): `src/server/db/schema.ts` — a shared path; `docs/plans/00-foundations.md` owns it
                  and no other stage may declare it (docs/plans/README.md, "The eight shared paths")
06-S1 (line 74):  `src/components/ui/badge.tsx` — under the shared path `src/components/ui/**`;
                  `docs/plans/00-foundations.md` owns it and no other stage may declare it
```

Both forms name the stage, the line, the written path, and — for a glob hit — which of the eight it
falls under, because "which shared path did I collide with" is the first question a reader has and
`src/components/ui/badge.tsx` does not answer it on its own.

**Backward compatibility.** `scripts/plans/` is not a surface listed in `BACKWARD_COMPATIBILITY.md`;
it is repository tooling with two in-repo callers, both changed in the same commit. Widening
`Assertion['id']` is additive for every reader that switches on it, and there is none — the CLI
report and the suite both iterate the array.

## 📝 UI/UX

None. This spec adds no route, no component, no screen and no state. `docs/SPEC.md` §9 (localisation)
and §10 (accessibility) are not engaged, and nothing here widens the claim in
`docs/ACCESSIBILITY.md`.

The one human-facing surface is the CLI report, which grows a fifth line in its existing `Assertions`
block and, on failure, indented violation lines in the format the other four already use. That
formatting is inherited from `report()` and needs no change beyond the assertion existing.

## 📝 Visual change expected

**None.** No route renders differently in light or dark, at 360 or at 1280, in any interaction state.
The change is confined to `scripts/plans/` and `docs/plans/README.md` cross-references; the
application bundle is not touched. ADR 0016's capture protocol therefore does not apply, and the PR
that implements this carries `skip-qa` for the same reason this one does.

## 📝 Copy

**None.** No message key is added, in EN or in PL. Every string this spec introduces is a developer-
facing violation message inside `scripts/plans/audit.ts` — printed by a CLI and asserted by a test,
never rendered to a user — so the `i18n-messages` skill does not apply and the catalogue parity test
is unaffected. `AGENTS.md`'s "no hardcoded user-facing copy" rule is satisfied because these are not
user-facing copy; the same is already true of the four existing assertion titles and of every
`detail` string in `audit.ts`.

## 📝 Edge Cases & Failure Scenarios

| Case                                                                       | Behaviour                                                                                                                              |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `00-foundations.md` declares all eight (today: 29 entries)                 | No violations. The exemption is checked before the paths are.                                                                          |
| A feature stage declares `src/components/ui/button.tsx`                    | Violation, naming the stage, the line, the written path and the `src/components/ui/**` entry it falls under.                           |
| A feature stage declares `src/lib/money-format.ts`                         | No violation. Exact match, not substring — the neighbouring-filename trap `mentionsPath` documents.                                    |
| A feature stage declares `src/routeTree.gen.ts`                            | Two violations: assertion 5 and the existing generated-path case. Different messages, both true.                                       |
| `00-foundations.md` declares `src/routeTree.gen.ts`                        | Assertion 5 passes (exempt); the generated-path case still fails. The README's "never listed by anyone" survives.                      |
| A stage requisitions a shared path in prose under **Data and migration**   | No violation. The documented escape hatch stays usable.                                                                                |
| A stage cites a shared path in a **Reference row**                         | No violation. Assertion 4 owns reference rows; this rule reads `Owned paths` only.                                                     |
| `docs/plans/README.md`'s table gains a ninth path, `SHARED_PATHS` does not | The parity case fails, naming both lists. Without it the guard would keep enforcing eight and report nothing about the ninth.          |
| `SHARED_PATHS` gains a path the README does not list                       | The parity case fails the same way, in the other direction.                                                                            |
| A new plan document is added under `docs/plans/`                           | Covered automatically: the whole-set case globs `NN-*.md` rather than listing documents, so a new plan is guarded on the day it lands. |
| `auditPlan` is given an absolute path to `00-foundations.md`               | Exempt, because the match is on basename. A full-string comparison would report 29 violations here.                                    |
| A document has no stages (`98-`, `99-` if they ever lose theirs)           | No violations; the function folds over an empty list. Measured today: both parse to zero shared-path entries.                          |

**Failure mode this spec deliberately does not cover.** Whether a shared path _should_ have been
requisitioned — that is, whether the stage's subject genuinely belongs in `00-foundations.md` — is a
review judgement, exactly as `audit.ts`'s docblock already says of "does the shipped file do what the
stage said". A guard that pretended to answer it would be trusted for something it cannot deliver.

## 📝 Risks & Impact Review

**Blast radius: two files, both tooling.** `scripts/plans/audit.ts` and
`scripts/plans/__tests__/plan-paths.test.ts`. Nothing under `src/` is read or written. The change
cannot affect a deployed Worker, a migration, a binding or a rendered pixel.

| Risk                                                                  | Likelihood | Mitigation                                                                                                                                        |
| --------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| The whole-set case turns 26 unreconciled documents red                | Measured 0 | 638 entries scanned, 29 shared-path hits, all in the exempt document. Step 1.3 re-measures before the case is added, and fails the step if not 0. |
| The rule blocks a legitimate correction, as it nearly did for `01-S2` | Real       | That is the intent: the correction was illegitimate. The requisition route stays open and untouched, and this spec asserts nothing about prose.   |
| A prefix rule over-matches (`src/components/ui-kit/x.tsx`)            | Low        | Prefix is `src/components/ui` **plus a path separator**, never a bare string prefix. Fixture case in Step 2.2 pins it.                            |
| `SHARED_PATHS` drifts from the README                                 | Low        | The parity case. Without it the guard silently enforces a stale list — the same failure class the issue reports one level down.                   |
| Widening `Assertion['id']` breaks a consumer                          | None       | Two consumers, both in-repo, both iterate `assertions` rather than switch on `id`; both change in the same commit.                                |

**Rollback.** Revert the commit. There is no state, no migration and no generated artefact, so the
guard returns to four assertions and the suite to its previous shape. No data is written by anything
in this spec, so there is nothing to undo beyond the code.

**Compatibility.** `BACKWARD_COMPATIBILITY.md` lists no surface under `scripts/`. The CLI's contract
— stdout only, exit `0` even with failing assertions (`audit.ts:19`–`:24`) — is preserved: assertion
5 is reported, never thrown, and failing the suite remains `plan-paths.test.ts`'s job.

**What it depends on.** `.ai/specs/2026-09-07-foundations-plan-reconciliation.md` (#77) is the spec
that built the parser, the audit and the guard; this extends its deliverable rather than amending it,
which is why #216 was filed as its own ticket rather than folded into #201. No ADR is needed: the
decision this asserts is already recorded in `docs/plans/README.md`, and asserting an existing rule
proposes no new product decision.

## 📝 Research

The comparison is against open-source tools that enforce path ownership in CI, per the clean-room
rule in `docs/agents/reference.md` — the reference product is a benchmark of rendered pixels and
contributes nothing here.

- **GitHub `CODEOWNERS`** encodes ownership as data beside the code and resolves globs by
  last-match-wins. What it gets right and this spec adopts: ownership is a list in one file, and the
  glob is matched by path prefix rather than by string containment. What it carries that this spec
  skips: a precedence model. Eight paths and one owner need no precedence.
- **Nx `enforce-module-boundaries`** derives allowed dependencies from a project graph rather than a
  hand-written list, which is the strongest available answer to "the list drifted". This repository
  has no project graph and eight paths, so the parity case against the README is the proportionate
  version of the same idea: still one source of truth, asserted rather than derived.
- **`eslint-plugin-boundaries`** reports violations with the element type and the rule that fired,
  not just "not allowed". That is why this spec's `detail` names _which_ of the eight a glob hit fell
  under rather than only that it collided.
- **Danger JS** is the common way to put a document's rule into CI, and is the option this spec
  declines: it would add a dependency (`docs/SPEC.md` §3 freeze) and a second place where plan rules
  live, when `auditPlan` already exists and already holds the parsed entries.

## 📋 Phasing

**One phase.** The change is two files, one migration-free, one product area, comfortably inside a
single `om-auto-create-pr` run — the Phase sizing rule in `.ai/skills/om-spec-writing/SKILL.md`.
Splitting the assertion from its tests would leave a Step that does not leave the guard working.

## 📋 Implementation Plan

Test-first throughout (skill `tdd`): every Step below writes or extends an assertion, watches it fail
for the stated reason, then makes it pass. Watched-failing evidence goes to
`.ai/runs/2026-09-10-plan-guard-shared-path/watched-failing.md`, the convention
`plan-paths.test.ts:99` already cites for the landing-site cases. No Step touches a repository, so no
tenant-isolation case is named; no Step touches an amount, so no money-invariant case is named.

### Phase 1 — the assertion

**Step 1.1 — `SHARED_PATHS`, `SHARED_PATH_OWNER` and the parity case.**
Add both constants to `scripts/plans/audit.ts` beside `REQUIRED_HEADINGS`, with a docblock citing
`docs/plans/README.md`'s _The eight shared paths_ table. Add the parity case to
`plan-paths.test.ts`: read the README, take the first column of that table, compare with
`SHARED_PATHS` as a set.
_Verification:_ `pnpm exec vitest run --project=tooling scripts/plans` is green. Watched failing by
deleting one entry from `SHARED_PATHS` and by adding a ninth — both directions, both naming the two
lists.

**Step 1.2 — `sharedPathViolations` and assertion 5.**
Add the exported function (exact match for seven, `src/components/ui` + separator prefix for the
eighth, basename exemption for `00-foundations.md`, both `new` and `edit` in scope). Wire it into
`auditPlan`'s `assertions` array as id `5`, title _"no stage outside `00-foundations.md` declares one
of the eight shared paths"_. Widen `Assertion['id']`. Rewrite the module docblock's _"The four
assertions"_ section to five, stating what assertion 5 does **not** claim, in the register the
existing four use.
_Verification:_ `pnpm exec vitest run --project=tooling scripts/plans` green;
`pnpm exec tsx scripts/plans/audit.ts docs/plans/00-foundations.md` prints five assertions, all PASS,
and exits `0`. Watched failing by adding `- \`src/lib/money.ts\` — edit`to a stage in`docs/plans/02-i18n.md` and reverting.

**Step 1.3 — the whole-set case.**
Re-measure first: run `sharedPathViolations` over every `docs/plans/NN-*.md` and confirm the count is
still 0 outside `00-foundations.md`. If it is not, stop and report — the number in this spec is stale
and the scope question reopens. Then add `describe.each` over the globbed document list, asserting
`sharedPathViolations` is empty for each, with a docblock stating why this rule is whole-set while
the four drift assertions are opt-in (they are red on 26 unreconciled documents; this one is green on
all 31).
_Verification:_ the suite lists 31 cases and all pass. Watched failing on a hand-broken copy of a
document that is **not** on `GUARDED_PLANS` — that is the specific hole this Step closes, and a break
inside a guarded document would not demonstrate it.

**Step 1.4 — fixture cases for the matching rule.**
Three inline-fixture cases, in the style of the existing `the generated-path rule` block: a neighbour
filename that must not match (`src/lib/money-format.ts`), a sibling directory that must not match
(`src/components/ui-kit/x.tsx`), and a file beneath the glob that must
(`src/components/ui/__tests__/data-table.test.tsx`). Fixtures rather than real documents, for the
reason `plan-paths.test.ts:128`–`:131` already gives: the real documents contain no pair where the
rules disagree, so only a fixture can show the difference.
_Verification:_ the three cases pass; each watched failing against a naive `includes` implementation.

**Step 1.5 — cross-references.**
Add an `@see` from `docs/plans/README.md`'s _The eight shared paths_ section to
`scripts/plans/audit.ts`, so a reader of the rule learns it is asserted — the missing half of the
loop this issue is about. Update `audit.ts`'s `@see` block to name this spec.
_Verification:_ full gate — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, plus the three
generated-artefact diffs and `pnpm generate-spec-index`.

### Definition of done

- Assertion 5 exists in `auditPlan`, in the `Violation` shape, and the CLI prints it.
- A stage in **any** plan document other than `00-foundations.md` that lists one of the eight fails
  the suite, naming the stage, the line and the path.
- `00-foundations.md`'s 29 legitimate entries produce no violation.
- `SHARED_PATHS` is asserted against `docs/plans/README.md`'s table.
- Every assertion above was watched failing before it was trusted, with the evidence recorded in
  `.ai/runs/2026-09-10-plan-guard-shared-path/watched-failing.md`.
- The full validation gate is green.

## 📝 Resolved assumptions (autonomous defaults)

This spec was written by an autonomous run, so the Open Questions below were answered rather than
asked. Each is reversible in review; none carries `⚠ NEEDS HUMAN CONFIRMATION`.

| #   | Question                                                           | Applied default                                                        | Why                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | Where does the eight-path list live — `audit.ts` or the test file? | `audit.ts`, exported, beside `REQUIRED_HEADINGS`                       | The assertion lives in `auditPlan`; a list in the test would force the module to import from its own test and would leave the CLI unable to print what it asserts.                                           |
| Q2  | Is the list kept in sync with `docs/plans/README.md` by hand?      | No — a parity case asserts it against the README table                 | A hand-copied list re-creates the reported failure one level down: a documented rule that only a human checks. Test-only, ~15 lines, fully reversible.                                                       |
| Q3  | Which documents does the assertion run over?                       | Every `docs/plans/NN-*.md`, not only `GUARDED_PLANS`                   | #216's acceptance says "any plan", and it is achievable: measured 0 violations outside `00-foundations.md` across all 31 documents and 638 entries.                                                          |
| Q4  | Do `— edit` entries count, or only `— new`?                        | Both                                                                   | `Owned paths` is an ownership declaration and the README's rule is about the list, not the kind; a parallel `schema.ts — edit` is the collision the contract forbids.                                        |
| Q5  | How is `src/components/ui/**` matched?                             | The directory itself and anything beneath it, by path-separator prefix | 13 of plan 00's 29 entries are individual files under the glob; a literal-glob-only rule would miss a feature stage claiming one primitive, the likeliest case.                                              |
| Q6  | What about `src/routeTree.gen.ts`, already in `GENERATED_PATHS`?   | Both rules stay; the overlap is intentional                            | They have different exemptions. Only keeping both preserves the README's stricter "never listed under Owned paths, by anyone" for plan 00 itself.                                                            |
| Q7  | Is the exemption keyed on the full path or the basename?           | Basename `00-foundations.md`                                           | The CLI accepts any path shape; a full-string comparison would report 29 violations the moment a caller passed an absolute path.                                                                             |
| Q8  | Does the rule read anything besides `Owned paths`?                 | No — reference rows and prose are out of scope                         | The README's requisition route is prose under **Data and migration**; asserting against prose would make the documented escape hatch unusable.                                                               |
| Q9  | One phase or several?                                              | One                                                                    | Two files, no migration, one area — inside a single `om-auto-create-pr` run, and splitting would leave a Step with a non-working guard.                                                                      |
| Q10 | Does this document land as `draft` or `ready`?                     | `ready`                                                                | `.ai/specs/AGENTS.md` reads `ready` as "merged, waiting for a build", which is this file's state the instant the spec PR lands; committing `draft` would leave a follow-up edit nobody is scheduled to make. |
