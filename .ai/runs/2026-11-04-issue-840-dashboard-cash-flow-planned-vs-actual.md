# Issue #840 — dashboard cash-flow planned vs actual

Engine: om-auto-create-pr (steps: 11, --loop: no)

Source doc: `.ai/specs/2026-11-03-dashboard-cash-flow-planned-vs-actual.md`
Spec PR: #841
Issue: #840

## Goal

The dashboard cash-flow chart shows the whole month’s plan (one-off planned rows plus recurring periods due in the month, regardless of paid status) beside actual money in and money out. Actual figures stay byte-identical. Expected amounts never join `incomeMinor` / `expenseMinor`.

## Scope

- Additive `transactions.was_planned`
- `sumPlannedPeriodsByMonth` and `sumPlannedTransactionsByMonth`
- Read-time conversion via `resolveRate` on `due_on` + `convert`
- Cash-flow widget four series, table, footnotes
- EN + PL copy
- Tenant-isolation and money-invariant cases

## Non-goals

- Unifying the two planning models
- Spending donut planned-per-category
- DASH-04 upcoming widget
- Bank connectors
- Changing actual header totals or `FLOW_POLICIES`

## Implementation Plan

### Phase 1 — Reads, column, invariants

1. Failing tenant-isolation cases for the new period aggregate and the new one-off plan aggregate.
2. Failing money-invariant cases for actual vs plan, paid/skipped/transfers, conversion gaps, `was_planned`.
3. Additive `was_planned` migration and writers.
4. Implement `sumPlannedPeriodsByMonth`.
5. Implement `sumPlannedTransactionsByMonth`.
6. Read-time conversion helper (no persist).

### Phase 2 — Chart

1. Extend `CashFlowBucket` and compose plan reads in `cashFlowBuckets()`.
2. Widget four series, table, footnotes, empty-state predicate.
3. EN + PL catalogue keys.
4. Spec metadata `in-progress`; regenerate spec index.
5. Widget and dashboard composition tests.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Reads, column, invariants

- [ ] 1.1 Failing tenant-isolation cases
- [ ] 1.2 Failing money-invariant cases
- [ ] 1.3 Additive was_planned column and writers
- [ ] 1.4 sumPlannedPeriodsByMonth
- [ ] 1.5 sumPlannedTransactionsByMonth
- [ ] 1.6 convertExpectedAmount helper

### Phase 2: Chart

- [ ] 2.1 CashFlowBucket and cashFlowBuckets composition
- [ ] 2.2 cash-flow-widget four series and empty state
- [ ] 2.3 EN + PL copy
- [ ] 2.4 Spec status in-progress and spec index
- [ ] 2.5 Widget and dashboard tests
