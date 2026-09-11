# Watched failing — the parser fix and the guard's second document (#108)

Two things on this branch had to be watched failing: the parser defect that made
`docs/plans/02-i18n.md`'s reference rows invisible, and the guard now that the document is on
`GUARDED_PLANS`. Command in each case:
`pnpm exec vitest run --project tooling scripts/plans/__tests__/<file>`.

`docs/plans/02-i18n.md` was restored from a copy immediately after each break, and re-run green
before the next one.

## 1. The parser dropped every row whose id prefix carries a digit

The defect, not a break: `REFERENCE_ROW` matched `[A-Z]+-\d+`, so `I18N-01` … `I18N-07` never
parsed. The audit reported `reference rows 0` for `02-i18n.md` and assertion 4 passed it having
read none of its seven rows. The case in `parse-plan.test.ts` was written first and watched red
against the shipped pattern:

```
 FAIL  |tooling| scripts/plans/__tests__/parse-plan.test.ts > a reference row whose id prefix carries a digit > is parsed rather than silently dropped
AssertionError: expected [] to deeply equal [ 'I18N-01' ]

- Expected
+ Received

- [
-   "I18N-01",
- ]
+ []

 Test Files  1 failed | 168 passed (169)
      Tests  1 failed | 2569 passed (2570)
```

Widening the prefix to `[A-Z0-9]+` turned it green, and the audit went from `reference rows 0` to
`reference rows 7` on that document — with all seven immediately failing assertion 4, which is the
measurement the reconciliation then acted on.

`I18N` is the only prefix in the set that carries a digit; every other one is letters alone, which
is why one document absorbed the whole defect.

## 2. Assertion 2 on the new document — an owned path repointed at an absent file

Break: in `docs/plans/02-i18n.md`, `02-S2`'s ``- `src/lib/i18n/messages/pl.ts` — new`` became
``- `src/lib/i18n/messages/pl/index.ts` — new`` — the namespace-directory shape the document
carried before it was reconciled, so the break is the exact drift this run removed.

```
 FAIL  |tooling| scripts/plans/__tests__/plan-paths.test.ts > docs/plans/02-i18n.md > assertion 2: 'every `— new` entry exists, or its st…'
AssertionError: expected [ Array(1) ] to deeply equal []

      Tests  1 failed | 15 passed (16)
```

Reverted: `plan restored`, `Tests 16 passed (16)`.

## 3. Assertion 4 on the new document — a row left with no citation that resolves

Break: `I18N-06`'s two citations, `` `src/lib/i18n/__tests__/parity.test.ts` `` and
`` `src/lib/i18n/__tests__/shipped-plurals.test.ts` ``, were renamed to
`parity-gate.test.ts` and `shipped-plural-copy.test.ts`. Both had to move, because the assertion
asks for **at least one** citation that resolves — breaking only one leaves the row green, which is
worth knowing before trusting a single-path break.

```
 FAIL  |tooling| scripts/plans/__tests__/plan-paths.test.ts > docs/plans/02-i18n.md > assertion 4: 'every `→ done` row cites a path that …'
AssertionError: expected [ Array(1) ] to deeply equal []

+   "02-S2 (line 155): I18N-06 reads `missing → done` and cites no path that resolves on disk",

      Tests  1 failed | 15 passed (16)
```

Reverted: `plan restored`, `Tests 16 passed (16)`.

## What moving the landing-site cases did not change

The two `classes.*` cases were lifted out of the `describe.each` and keyed to
`docs/plans/00-foundations.md`, the one document `scripts/plans/drift-classes.ts` describes. They
assert the same two arrays over the same document as before; the change is only which documents
they run against, and it is what stops `02-i18n.md` from being measured against plan 00's landing
sites. The suite went from 11 cases to 16: five are `02-i18n.md`'s four assertions plus its
generated-path case.
