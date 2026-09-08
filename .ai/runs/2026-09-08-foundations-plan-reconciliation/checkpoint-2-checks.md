# Checkpoint 2 — Phase 2 (Reconcile) closed, and the guard is watching

**When:** 2026-09-08T15:40Z
**Steps covered:** 2.1, 2.2, 2.3, 2.4, 3.1
**Head at checkpoint:** `f5dffdc`

A checkpoint fires here because Phase 2 is a four-Step phase and it just closed. Step 3.1 is folded
in rather than left for a third checkpoint: it is the machine check for everything Phase 2 wrote,
and reporting the two apart would mean reporting the rewrite without its verification.

## Targeted validation

| Command                                                                     | Result                                                                        |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm typecheck`                                                            | ✅ clean, no output                                                           |
| `pnpm lint`                                                                 | ✅ 0 errors, 2 pre-existing warnings                                          |
| `pnpm vitest run --project tooling`                                         | ✅ 5 files, 175 tests passed — 169 before, plus the 6 in `plan-paths.test.ts` |
| `pnpm exec prettier --check` over the touched documents and `scripts/plans` | ✅ all matched files clean                                                    |

The six-command gate is Step 3.2 and is reported in `final-gate-checks.md`.

## What the audit says now, against what it said at checkpoint 1

`pnpm exec tsx scripts/plans/audit.ts docs/plans/00-foundations.md`, re-run at `f5dffdc`:

| Measure                | Checkpoint 1 | Now   |
| ---------------------- | ------------ | ----- |
| stages                 | 17           | 17    |
| reference rows         | 34           | 34    |
| owned-path entries     | 56           | 41    |
| distinct paths         | 40           | 27    |
| missing entries        | 29           | 8     |
| distinct missing paths | 27           | 7     |
| assertion 1 violations | 2            | **0** |
| assertion 2 violations | 27           | **0** |
| assertion 3 violations | 0            | **0** |
| assertion 4 violations | 30           | **0** |

All four assertions PASS. Of the 29 class-map rows, 22 are no longer declared by the plan and 7 are
still declared; every recorded landing site resolves on disk and is named somewhere in the document.

The row count is the number that matters most and it did not move: 34 rows before, 34 after, now
reading **23 `done`, 2 `partial`, 9 `missing`**. No row was deleted to make a number look better,
which was the specification's stated failure mode.

## The seven paths still missing, and why that is correct

`grid-list.test.tsx`, `money-field.test.tsx`, `offline-banner.test.tsx`, `install-prompt.tsx`,
`money-field.tsx`, `offline-banner.tsx`, `conventions.test.ts` — every one belongs to a stage that
still has an open reference row. That is assertion 2 doing its job rather than failing it: these are
Class B and C gaps, work that was planned and has not shipped, and a reconciliation that made them
disappear would have erased the backlog it exists to make readable.

## Step verifications, as the specification wrote them

**Step 2.1 — Class A paths.** 12 entries repointed or removed, each landing site named in prose.
The audit's `unresolvedLandings` and `unmentionedLandings` are both empty, which is the machine form
of "no subject was silently dropped".

**Step 2.2 — the migration restatement.** All seven `drizzle/0000_init.sql` bullets are gone and
each stage's _Data and migration_ now states that `pnpm db:generate` produces exactly one new file
whose name is the generator's. `TEMPLATE.md` gained the matching rule and sanctioned
`src/components/ui/**` by name as the one glob a stage may own. `git diff --exit-code -- drizzle/`
is clean.

**Step 2.3 — re-measurement.** All 34 rows re-measured against the tree; assertion 4 went from 30
violations to 0. The assertion shipped in Phase 1 (decision D2) precisely so this step had a machine
check and not a reading.

**Step 2.4 — register and Blockers.** The register now carries a _Which of them closed_ table: 8
closed, 9 open. Two Blockers recorded as deferred rather than fixed — the unused
`@tanstack/react-table` under `00-S8` and the two `amount-field.tsx` components under `00-S10`.
Both are dependency and component decisions this run has no mandate to take; both become follow-up
issues in Step 3.3.

**Step 3.1 — the guard.** `scripts/plans/__tests__/plan-paths.test.ts`, opt-in list, one member.
Watched failing: `docs/plans/00-foundations.md:500` was changed from `src/server/db/schema.ts` to
`src/server/db/schema-renamed.ts` and assertion 1 went red naming `00-S5`, line 500 and that path.
Reverted, diff empty, suite green. The generated-path edge case Step 2.2 deferred ships here and is
watched failing on a fixture.

## No new row id was minted

Decision D6 planned to mint `FND-35` on `00-S1` so assertion 2 had coverage there. Measurement made
it unnecessary: `FND-02` and `FND-18` both resolved to `partial`, and an open row is an open row.
Inventing an id to satisfy a guard would have been the guard writing the plan.
