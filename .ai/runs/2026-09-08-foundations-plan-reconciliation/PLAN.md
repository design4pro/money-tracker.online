# Execution plan — foundations plan reconciliation

**Run:** `2026-09-08-foundations-plan-reconciliation`
**Branch:** `feat/issue-77-foundations-plan-reconciliation`
**Base:** `develop`
**Engine:** `om-auto-create-pr-loop` (steps: 11, `--loop`: yes)
**Source doc:** `.ai/specs/2026-09-07-foundations-plan-reconciliation.md`
**Issue:** #77 · **Spec PR:** #75 (merged, design-only)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status`
> to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not
> `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable
> once the plan is committed — per-Step commits touch only `Status` and `Commit`. A Step flips its
> own `Status` inside its own commit and carries `PENDING` in `Commit`; the SHA is backfilled by
> the next commit, because a commit cannot contain its own hash. `Status` is what the resume
> contract parses, so a `PENDING` cell never costs a resume its place.

| Phase | Step | Title                                                    | Exec   | Status | Commit  |
| ----- | ---- | -------------------------------------------------------- | ------ | ------ | ------- |
| 1     | 1.1  | The plan parser                                          | inline | done   | 89034aa |
| 1     | 1.2  | The audit report                                         | inline | done   | d775692 |
| 1     | 1.3  | The class map                                            | inline | done   | bcf2bb9 |
| 1     | 1.4  | Record the specification corrections as an amendment     | inline | done   | 3bfddb2 |
| 2     | 2.1  | Correct the Class A paths                                | inline | done   | 5b32bb0 |
| 2     | 2.2  | Restate the migration requirement, and amend TEMPLATE.md | inline | done   | ccea7cc |
| 2     | 2.3  | Re-measure every reference row                           | inline | done   | da24fbb |
| 2     | 2.4  | Stage register and Blockers                              | inline | done   | c6d30ca |
| 3     | 3.1  | The guard test                                           | inline | done   | f5dffdc |
| 3     | 3.2  | The full gate                                            | inline | done   | dff0055 |
| 3     | 3.3  | File the four follow-ups                                 | inline | done   | 3be63cb |

## Goal

Reconcile `docs/plans/00-foundations.md` with the repository at HEAD — 29 of its 56 `Owned paths`
entries name a file that is not on disk — and add a parser-backed guard so the next divergence fails
`pnpm test` instead of quietly misleading the next agent that reads the plan.

## Scope

- `scripts/plans/` — new: the parser, its unit test, the audit tool, the class map, the guard test
  and its opt-in list.
- `docs/plans/00-foundations.md` — rewritten paths, restated migration requirement, re-measured
  reference rows, updated stage register, one new `Blockers` entry.
- `docs/plans/TEMPLATE.md` — two sentences so the template and the guard agree.
- `.ai/specs/2026-09-07-foundations-plan-reconciliation.md` — an append-only `Amendments` section
  recording how the five review corrections carried on issue #77 were resolved.
- `.ai/runs/2026-09-08-foundations-plan-reconciliation/` — this run folder.

## Non-goals

- **Any diff under `src/`.** The specification makes this an explicit review criterion. The code
  wins on location and naming; nothing moves to satisfy a document.
- `package.json` / `pnpm-lock.yaml`. The `@tanstack/react-table` finding is reported and deferred,
  never acted on — `docs/SPEC.md` §3.1 and `AGENTS.md` put it under **Ask First**.
- `vitest.config.ts`. The `tooling` project already includes `scripts/**/__tests__/*.test.{ts,mjs}`
  at `vitest.config.ts:133`, so the guard is collected with no edit to that shared file.
- The other 28 plan files. They are unmeasured; the guard's opt-in list names plan 00 alone.
- Consolidating the two `amount-field.tsx` components. That is a money-path change on its own PR.

## Measurement, as of `f0ce37a` (`origin/develop`)

Reproduced before planning, by command, and matching the specification exactly:

| Measure                                                | Value |
| ------------------------------------------------------ | ----- |
| `Owned paths` entries                                  | 56    |
| Distinct paths behind them                             | 40    |
| Entries whose path does not exist (resolved-glob rule) | 29    |
| Distinct paths that do not exist                       | 27    |
| Entries missing under the naive `test -e` rule         | 30    |
| Reference rows                                         | 34    |

The one-entry gap between 29 and 30 is `src/components/ui/**`, resolved to its base directory.

## The grammar this run writes down

The specification review (issue #77, correction 2) records that the guard's assertions 2 and 4 both
parse a grammar the specification never states. It is decided here, once, and lives in the parser's
docblock:

- **Status token.** A reference row opens with a backticked span shaped
  `` `FND-NN <from> → <to>` ``. `<from>` and `<to>` are drawn from
  `missing | proposed | partial | done | deferred`. A row is **open** when `<to>` is anything other
  than `done`.
- **Row body.** Everything after the status token, including its continuation lines, up to the next
  row or the end of the section.
- **Citation.** A backticked token in the row body is a _citation candidate_. It is **path-shaped**
  when it contains a `/` or ends in one of `.ts .tsx .mts .mjs .sql .css .json .jsonc .md`.
  Table names (`accounts`), identifiers (`enumCheck`) and package names
  (`@tanstack/react-table` — excluded explicitly, a scoped package is not a path) are not.
- **Assertion 4** then reads: every row whose `<to>` is `done` carries at least one path-shaped
  citation that resolves on disk. A `→ done` row citing nothing that resolves fails.
- **Coverage (assertion 2).** An absent `— new` entry is covered when the stage that owns it still
  has at least one open reference row. Coverage is per stage, never across the file.
- **Assertion 1, stated precisely.** Every `— edit` entry names a path that exists, **unless** the
  same plan file declares that same path `— new` under another stage whose reference rows are not
  all `done`. A forward reference to a file a not-yet-closed stage will create is a sequencing fact,
  not a contradiction; only an edit to a file nobody is going to create is one.

## Decisions taken in this run

| #   | Question                                                      | Resolution                                                                                                                         | Why                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `audit.mts` or `audit.ts`?                                    | **`scripts/plans/audit.ts`**                                                                                                       | `tsconfig.json`'s `"include": ["**/*.ts", …]` does not match `.mts`, so the audit as specified would sit outside `pnpm typecheck`. `pnpm exec tsx` runs a `.ts` file just as happily and the specification's real argument — a `.mjs` audit cannot import the `.ts` parser — is untouched. Issue #77, correction 1. |
| D2  | What can Step 2.3 actually verify?                            | **Assertion 4 ships in the Phase 1 audit**, not only in the Phase 3 guard                                                          | The specification's Step 2.3 verify is circular: it names an assertion that does not exist until Phase 3. The audit already holds the parsed rows, so giving it the assertion is the cheap half of the choice the correction offers. Issue #77, correction 3.                                                       |
| D3  | What happens to `drift-classes.ts` after Phase 2?             | **Permanent.** A dated historical record of the pre-reconciliation state, consumed by the audit's class column and never rewritten | Step 2.1's verify reads it, so it must outlive Phase 2; and the alternative — deleting it in Phase 3 — throws away the only machine-readable record of what the drift was. Its docblock carries the as-of SHA so nobody mistakes it for a live measurement. Issue #77, correction 5.                                |
| D4  | Which Phase 1 file survives a year?                           | **`parse-plan.ts` and `plan-paths.test.ts`.** `audit.ts` is a re-derivation tool run on demand; `drift-classes.ts` is frozen data  | Stated so a later reader knows which files are expected to change and which are not. Issue #77, second nit.                                                                                                                                                                                                         |
| D5  | Where do the four corrections that are prose, not code, land? | An append-only **`## 📝 Amendments`** section on the specification document                                                        | `docs/adr/` convention is amend rather than rewrite, and the specification is checked in. The alternative — leaving the issue's checklist unresolved in the tracker — loses the record on merge.                                                                                                                    |
| D6  | The `conventions.test.ts` gap has no reference row            | **Mint `FND-35`** on `00-S1`, `missing → missing`                                                                                  | Assertion 2 needs an open row on the owning stage, and Q3 of the specification rules that a genuinely unmet invariant stays open and keeps or _gains_ a stage. `README.md` → _Row ids_ mints `FND-` ids in this plan.                                                                                               |

## Implementation Plan

### Phase 1 — Audit

**Step 1.1 — The plan parser.** Add `scripts/plans/parse-plan.ts` exporting
`parsePlan(markdown: string): PlanFile` — each stage's id, its `###` headings in document order, its
`Owned paths` entries as `{ path, kind: 'new' | 'edit' }`, and its reference rows with status token
and body. Pure function over a string, no filesystem access. The grammar above is its docblock.
_Verify:_ `scripts/plans/__tests__/parse-plan.test.ts` parses an inline fixture and asserts stage
count, heading order, that `` `path` — new `` and `` `path` — edit `` are distinguished, and that a
status line is captured. `pnpm test` green.

**Step 1.2 — The audit report.** Add `scripts/plans/audit.ts`, run as
`pnpm exec tsx scripts/plans/audit.ts docs/plans/00-foundations.md`. Reads through the parser,
resolves globs to their base directory, deduplicates, stats each path, evaluates the four assertions
(assertion 4 included, per D2) and prints the drift table to stdout — never to a file in the tree.
_Verify:_ reproduces **56 entries / 40 distinct / 29 missing entries / 27 distinct missing**, and
reports **30** under the naive rule so the glob's effect is visible rather than hidden.

**Step 1.3 — The class map.** Add `scripts/plans/drift-classes.ts`: checked-in data mapping each of
the 29 absent entries to its class and, for Class A, to the path or host module it moved to.
_Verify:_ the audit prints **12 / 7 / 4 / 2 / 4** across classes A–E, summing to 29.

**Step 1.4 — Record the specification corrections as an amendment.** Append an `## 📝 Amendments`
section to `.ai/specs/2026-09-07-foundations-plan-reconciliation.md` resolving the five corrections
and two nits carried on issue #77, including the `BACKWARD_COMPATIBILITY.md` narrowing
(`BACKWARD_COMPATIBILITY.md:25` does protect `scripts/seed/seed.mjs` and `scripts/seed/verify.mjs`;
the verdict survives because this work touches `scripts/plans/`).
_Verify:_ every checklist item on issue #77 has a resolution in the section; `pnpm check` clean on
the file.

### Phase 2 — Reconcile

**Step 2.1 — Correct the Class A paths.** For each of the 12 entries, replace the declared path with
the one `drift-classes.ts` records. Where the subject was inlined rather than moved (`enumCheck`, the
queue dispatch, the cron switch) the entry names the host module and a sentence says it is inlined.
_Verify:_ the audit reports that every path named in the Class A column of `drift-classes.ts` now
appears in the plan and exists on disk.

**Step 2.2 — Restate the migration requirement, and amend `TEMPLATE.md`.** Replace the seven semantic
filenames with the requirement the generator cannot invalidate, naming each migration by the tables it
creates. In the same commit, add to `TEMPLATE.md` the two sentences that keep the template and the
guard in agreement.
_Verify:_ no `drizzle/*.sql` filename appears under any `Owned paths` heading;
`pnpm db:generate < /dev/null && git diff --exit-code -- drizzle/` stays clean.

**Step 2.3 — Re-measure every reference row.** Move each of the 34 rows to its measured status and
mint `FND-35` per D6. A row that shipped reads `→ done` and carries a path-shaped citation that
resolves; a Class C/D row reads `missing → missing` and keeps its stage. `FND-30` starts from
`proposed`.
_Verify:_ the Phase 1 audit's assertion 4 passes — every `→ done` row cites something on disk.

**Step 2.4 — Stage register and Blockers.** Update the register to reflect which stages closed. Add
the `@tanstack/react-table` **defer** entry under `00-S8`'s `### Blockers`.
_Verify:_ `pnpm test` and `pnpm lint` green; `pnpm check` leaves both documents prettier-clean.

### Phase 3 — Guard

**Step 3.1 — The guard test.** Add `scripts/plans/__tests__/plan-paths.test.ts` and the opt-in list
naming `docs/plans/00-foundations.md`, asserting the four properties.
_Verify:_ `pnpm test` green; then break one path in the reconciled plan and confirm the test goes red
naming that stage and that path. Revert the break.

**Step 3.2 — The full gate.** Run all six `validation.commands` in order.
_Verify:_ all six pass, with `pnpm generate-routes` and `pnpm db:generate` both leaving a clean diff.

**Step 3.3 — File the four follow-ups.** One issue each for the findings in the specification's
_Risks & Impact Review_, citing this spec and carrying category, priority and risk labels.
_Verify:_ four issue numbers, referenced back from the reconciled plan at the row or Blockers entry
they belong to.

## Risks

- **The real risk is a careless rewrite**, not a break: a Class C or D gap quietly reclassified as
  shipped, erasing the record that the enforcement was never built. Guard assertion 4 and the audit's
  class column exist for exactly this, and D2 pulls the assertion forward so Step 2.3 has a machine
  check rather than a prose one.
- **Blast radius: documentation and one tooling test.** No runtime code path changes, so there is no
  behaviour to regress, no migration to roll back and no deploy risk. Rollback is `git revert`.
- **Protected surfaces:** none in scope. `BACKWARD_COMPATIBILITY.md:25` does protect two `scripts/`
  modules (`scripts/seed/seed.mjs`, `scripts/seed/verify.mjs`), and this work never touches
  `scripts/seed/` — the narrowed form of the specification's claim, per issue #77 correction 4.
- **Dependency freeze:** nothing is added. `tsx@^4.23.12` is already in `devDependencies`.

## External References

None. No `--skill-url` was passed.
