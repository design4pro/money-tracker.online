# Execution plan — design-system plan reconciliation (issue #201)

Source doc: .ai/specs/2026-09-08-design-system-plan-reconciliation.md
Tracking issue: #201
Spec PR: #97 (merged 2026-09-08)

## Goal

Make `docs/plans/01-design-system.md` agree with the tree, keep its ten genuine gaps open as live
stages, and add it to the drift guard's opt-in list so the next divergence fails a test. This is a
documentation-and-data change: two Markdown plan documents, one checked-in data module under
`scripts/plans/`, and one line in the guard's list.

## Scope

In scope: `docs/plans/01-design-system.md`, `docs/plans/00-foundations.md` (the requisitioned
`DSY-04` row only), `scripts/plans/drift-classes.ts`, `scripts/plans/audit.ts` (the class-map
container only — see Risks), `scripts/plans/__tests__/plan-paths.test.ts`, and the spec's own
lifecycle bookkeeping under `.ai/specs/`.

**Non-goals**, restated from the spec's _Risks & Impact Review_ so a reviewer can check the diff
against them:

- Building any of the ten unbuilt stages. This reconciles the document; the gaps stay open.
- Any diff under `src/`, `e2e/`, `package.json` or `pnpm-lock.yaml`. In particular the duration
  tokens in `src/styles/tokens.css` stay at 90/150/220/320 ms — the plan moves to them, not the
  reverse — and `@theme inline` is not extracted out of `src/styles/app.css`.
- Removing the unused `motion@^13.2.0` package. The dependency set is frozen (`docs/SPEC.md` §3.1)
  and dependency changes are **Ask First**; the finding is filed, not acted on.
- A fifth guard assertion for the eight shared paths. Filed as a follow-up against #77's
  deliverable, because it changes a shared tooling contract another spec owns.
- The remaining 26 unreconciled plans, tracked one row at a time on #108.

## Re-derived measurements

Every number here came from a command run on this branch, cut from `origin/develop` at `5eac91d`.
The spec's own Step 1.1 requires this re-derivation rather than trusting the numbers in the
document, and two of them have moved since the spec merged.

`pnpm exec tsx scripts/plans/audit.ts docs/plans/01-design-system.md` reports **3 stages / 7
reference rows / 14 owned-path entries / 14 distinct paths / 12 missing entries / 12 distinct
missing paths**, which reproduces the spec's Step 1.1 figures exactly. Assertion 2 fails on all 12
absent `— new` entries and assertion 4 on all 7 `→ done` rows.

Two corrections the run must carry, both recorded here before Phase 2 starts:

1. **The spec's `audit.mts` does not exist.** The file shipped as `scripts/plans/audit.ts`, and
   every verify step that names the audit runs the `.ts` filename. The issue body already carries
   this correction.
2. **The spec's `tokens.css` line numbers are stale.** It cites `:616` and `:682`, measured at
   `1b4d72f`. At `5eac91d` the motion tokens are `src/styles/tokens.css:703`–`:711` (block heading
   at `:691`) and the reduced-motion block is at `:779`. The class map records the re-derived
   numbers.

Two facts about the tree have changed since the spec merged, and both land in an `## Amendment`
section on the spec rather than as a silent divergence:

3. **The guard's opt-in list already holds two entries**, not one: `docs/plans/00-foundations.md`
   and `docs/plans/02-i18n.md` (the second added by #108's i18n reconciliation). Plan 01 is the
   **third**, not the second, and the docblock on that list requires whoever adds the third entry
   to re-measure the unreconciled totals it quotes.
4. **`src/components/ui/money-field.tsx` now exists**, shipped by #106 / PR #198 and already
   recorded in `docs/plans/00-foundations.md` as `FND-23 missing → done`. The spec's Step 2.4 tells
   this run to re-state `01-S3`'s amount-input claim as an open `docs/SPEC.md` §8 violation; at
   `5eac91d` that half of the claim is **resolved**, and only the amount **column helper**
   (`src/components/ui/data-table.tsx`, still absent, `FND-18 missing → partial`) is open.

## Implementation Plan

### Phase 1 — Classify

**Step 1.1 — The plan-01 class map.** Append plan 01's 12 absent entries to
`scripts/plans/drift-classes.ts`: 2 Class A (`src/styles/theme.css` → `src/styles/app.css`;
`src/styles/motion.css` → `src/styles/tokens.css`) and 10 Class C. The container gains a `plan`
dimension so the class report is scoped to the document under audit — see Risks for why that is
not optional. _Verify:_ the audit reports 14 / 14 / 12 / 12 for plan 01 and 2 Class A + 10 Class C
summing to 12, and still reports plan 00's own 29 entries unchanged when run against
`00-foundations.md`.

**Step 1.2 — Re-measure the seven rows.** Produce each `DSY-` row's measured status and, for a
`→ done` row, the backticked path that evidences it. Recorded in the PR as a table, not yet in the
plan file. _Verify:_ every cited path resolves, checked by re-running the audit rather than by
reading.

### Phase 2 — Reconcile

**Step 2.1 — Correct the two Class A entries.** `01-S1` stops declaring `src/styles/theme.css` and
its already-present `src/styles/app.css` entry becomes `— edit`, with a sentence recording that the
`@theme inline` layer is inlined there and why (`app.css:1`–`25`). `01-S2`'s `src/styles/motion.css`
is removed from `Owned paths` entirely and re-expressed as a requisition under that stage's _UI_
heading. _Verify:_ zero Class A entries outstanding for plan 01, and no `Owned paths` entry in plan
01 names any of the eight shared paths (grep against `docs/plans/README.md`'s list, since the guard
cannot yet see this).

**Step 2.2 — Requisition `DSY-04` into `00-foundations.md`.** Add the re-measured motion row to
`00-S3` against `src/styles/tokens.css`, in the shape that stage's row table already uses. Remove
`DSY-04` from plan 01's row list and leave a pointer. _Verify:_ `DSY-04` appears in exactly one plan
file; `00-foundations.md` still passes the guard; both documents stay prettier-clean.

**Step 2.3 — Resolve the three invariant contradictions.** Correct `01-S2`'s band to
`90 / 150 / 220 / 320 ms` and re-state the asserted invariant as the 400 ms ceiling plus
transform-and-opacity-only. Keep the `[data-motion-transform]` clause as an open requirement,
stated as unimplemented. Re-state `01-S1`'s gallery-evidence sentence in the future tense and drop
the claim that five foundations stages already cite its frames. _Verify:_ `every exported preset is
within 150–260 ms` is gone from `01-S2`'s _Verification_ heading, and no file under `src/styles/`
appears in the diff.

**Step 2.4 — Fix the stale cross-plan citations and re-state the rows.**
`src/styles/__tests__/contrast.test.ts` → `tokens-contrast.test.ts`; `src/lib/__tests__/money.test.ts`
→ the four split files; `formatAmount` → `formatMoney`; `01-S3`'s amount-input / amount-column-helper
claim re-stated against what is true at `5eac91d` (see re-derived measurement 4). Move all seven rows
to their Phase 1 statuses, splitting `DSY-06`. _Verify:_ audit assertion 4 passes for plan 01 —
every `→ done` row cites something that exists. `pnpm lint` and `pnpm test` green.

### Phase 3 — Join the guard

**Step 3.1 — Add plan 01 to the opt-in list.** One entry, bringing the list to **three** files, with
the docblock's unreconciled totals re-measured for the remaining 26 as that docblock requires.
_Verify:_ `pnpm test` green; then break one path in the reconciled plan 01, confirm the guard goes
red naming that stage and that path, and revert the break.

**Step 3.2 — Spec lifecycle bookkeeping.** Set the spec's `Status` and `Implementation` rows, record
the four re-derived divergences as an `## Amendment` section naming this PR, move the spec to
`.ai/specs/implemented/` once every phase has shipped on this one PR, and regenerate
`.ai/specs/README.md`. _Verify:_ `pnpm generate-spec-index` leaves a clean diff and
`scripts/specs/__tests__/spec-registry.test.ts` is green.

**Step 3.3 — The full gate.** Run every command in `.ai/agentic.config.json` → `validation.commands`,
in order. _Verify:_ all pass, with `pnpm generate-routes` and `pnpm db:generate` both leaving a clean
diff. If either does not, something outside this scope was touched.

**Step 3.4 — File the follow-ups.** One issue per finding in the spec's _Risks & Impact Review_,
citing this spec and carrying category, priority and risk labels. Follow-up 4 is filed against #77's
deliverable and says so. _Verify:_ each issue number is referenced back from the reconciled plan at
the row or `### Blockers` entry it belongs to.

## Risks

**The class map's container is plan-00-specific and must gain a plan dimension.** As shipped,
`scripts/plans/drift-classes.ts` records `00-foundations.md`'s drift, `EXPECTED_CLASS_COUNTS` is a
single global total, and `auditPlan` prints that same block whatever document it is given — visible
today, because running the audit against plan 01 reports "29 no longer declared by the plan" and 23
landing sites the document never names, all of them plan 00's. Appending plan-01 rows to a flat array
would make those figures worse, not better, and would point the guard's two landing-site cases (keyed
to `CLASS_MAP_PLAN`) at plan 01's landing sites asserted against plan 00's prose. The spec's own
_Edge Cases_ table anticipates this: _"the class data is stable, only its container is not. Re-derive,
never fork the file."_ So each entry gains a `plan` field, the expected counts are keyed by plan, and
the audit filters to the document under test. No new module, no second parser, no change to
`parsePlan`.

**A gap quietly closed.** Ten of the twelve absent entries are genuine unbuilt work and three are the
direct subject of open issues #17–#21. Marking any of them `done` is the failure this reconciliation
exists to prevent; audit assertion 4 is the machine check for it, which is why Phase 3 is worth
running even though the document is correct after Phase 2.

**Scope creep into `src/styles/`.** This run produces the exact shipped duration values, which makes
"just widen the band in `tokens.css`" a two-character edit. That edit is a shared-path change and a
visible motion change across every primitive. Any diff touching `src/`, `e2e/`, `package.json` or
`pnpm-lock.yaml` fails this PR's own review criterion.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Classify

- [x] 1.1 The plan-01 class map — b020c8a
- [x] 1.2 Re-measure the seven rows — https://github.com/design4pro/money-tracker.online/pull/205#issuecomment-5623383237

### Phase 2: Reconcile

- [x] 2.1 Correct the two Class A entries — c78fd30
- [x] 2.2 Requisition `DSY-04` into `00-foundations.md` — 6b9acfc
- [x] 2.3 Resolve the three invariant contradictions — 7ffa28c
- [x] 2.4 Fix the stale cross-plan citations and re-state the rows — 96e4fd3

### Phase 3: Join the guard

- [x] 3.1 Add plan 01 to the opt-in list — bfbe7e0
- [x] 3.2 Spec lifecycle bookkeeping — 96e6715
- [x] 3.3 The full gate — 173 files / 2640 tests passed, lint 0 errors, build clean
- [x] 3.4 File the follow-ups — #213, #214, #215, #216, #217, #218; the seventh finding is issue #108, not duplicated

> Step 3.4 ran before Phase 2 finished, because Steps 2.3 and 2.4 have to cite the issue numbers
> from the row and `### Blockers` entries they rewrite. The order in the plan above is unchanged.
