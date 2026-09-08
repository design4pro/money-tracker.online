# Checkpoint 1 — Phase 1 (Audit) closed

**When:** 2026-09-08T15:23Z
**Steps covered:** 1.1, 1.2, 1.3, 1.4
**Head at checkpoint:** `3bfddb2`

A checkpoint fires here because Phase 1 is a four-Step phase and it just closed, not because five
Steps have elapsed.

## Targeted validation

| Command                                                                  | Result                                                                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                                         | ✅ clean, no output                                                                                                                                                 |
| `pnpm lint`                                                              | ✅ 0 errors, 2 warnings — both `no-shadow` on `worker-configuration.d.ts`, a generated file this run never touches, and both present on `develop` before the branch |
| `pnpm vitest run --project tooling`                                      | ✅ 4 files, 169 tests passed (16 of them the new `parse-plan.test.ts`)                                                                                              |
| `pnpm exec prettier --check scripts/plans docs/plans .ai/specs .ai/runs` | ✅ all matched files prettier-clean                                                                                                                                 |

The full six-command gate is Step 3.2's job and is deliberately not run here: `pnpm build` and the
two codegen diff checks tell us nothing yet, because Phase 1 added no route, no schema and nothing
that enters a bundle.

## Step verifications, as the specification wrote them

**Step 1.1 — the parser.** `scripts/plans/__tests__/parse-plan.test.ts` asserts stage count,
heading order, that `` `path` — new `` and `` `path` — edit `` are distinguished, that a status line
is captured, that a wrapped row body is joined and that the paragraph after a row list is not
absorbed into the last row. 16 tests, green.

**Step 1.2 — the audit.** Against `docs/plans/00-foundations.md`:

```
  stages                          17
  reference rows                  34
  owned-path entries              56
  distinct paths                  40
  missing entries                 29
  missing entries (naive test -e)  30
  distinct missing paths          27
```

Every figure matches the specification, including the naive 30 printed beside the resolved 29 so
the directory glob's one-entry effect is visible rather than hidden. The specification's condition
— "a different result means this spec's numbers are wrong and is resolved before Phase 2 starts" —
is satisfied, so Phase 2 may start.

**Step 1.3 — the class map.** The audit prints 12 / 7 / 4 / 2 / 4 across classes A–E, summing to
29, and reports that every recorded landing site resolves on disk.

**Step 1.4 — the amendment.** All five checklist items and both nits from issue #77 have a
resolution in the specification's new `## 📝 Amendments` section.

## Assertion state before Phase 2 — the baseline the rewrite is measured against

| Assertion                                                                   | Violations |
| --------------------------------------------------------------------------- | ---------- |
| 1. every `— edit` entry names a path that exists                            | 2          |
| 2. every `— new` entry exists, or its stage still has an open reference row | 27         |
| 3. every stage carries the twelve required headings, in order               | 0          |
| 4. every `→ done` row cites a path that resolves on disk                    | 30         |

Assertion 3 already passes, which is worth stating: the document's _shape_ was never the problem,
only its content. Assertion 4's 30 of 34 rows is the size of Step 2.3.

## Findings recorded rather than fixed

Two Class E landing sites the specification assumed do not exist — there is no `chart-frame.test.tsx`
anywhere, and `GridListMoveButton` has no test file at all. Both are recorded in
`scripts/plans/drift-classes.ts` and in the specification's amendments; the second keeps its plan
entry open in Phase 2. This is the "gap quietly reclassified as shipped" failure the specification
calls the real risk, caught at classification time.

## UI verification

Skipped, correctly. The specification's _Visual change expected_ is **None** — no route, component,
token or style file is touched — and the run was invoked with `--no-ui`. There is no rendered
surface to screenshot.
