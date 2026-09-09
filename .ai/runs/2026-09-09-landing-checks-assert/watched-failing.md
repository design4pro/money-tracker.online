# Watched failing — the two landing checks in `audit.ts` (#117)

Every guard added on this branch, watched failing before it was watched passing. Command in each
case: `pnpm vitest run scripts/plans/__tests__/plan-paths.test.ts`.

`docs/plans/00-foundations.md` and `scripts/plans/drift-classes.ts` were each restored immediately
after their break; `git diff --quiet` on the file is the confirmation quoted below.

## 1. `classes.unmentionedLandings` — the fixture, against the old substring rule

`mentionsPath` first shipped as the `markdown.includes(path)` it replaced, so the fixture below
measures the exact behaviour the review objected to rather than a reconstruction of it. Two of the
three cases were red:

```
 FAIL  scripts/plans/__tests__/plan-paths.test.ts > the landing-site mention rule > does not count a path a longer filename merely contains
AssertionError: expected true to be false // Object.is equality
     96|   it('does not count a path a longer filename merely contains', () => {
     97|     expect(mentionsPath(document, 'src/lib/money.ts')).toBe(false)
       |                                                        ^

 FAIL  scripts/plans/__tests__/plan-paths.test.ts > the landing-site mention rule > does not count a path a longer prefix turns into another file
AssertionError: expected true to be false // Object.is equality
    103|       mentionsPath('`packages/app/src/lib/money.tsx`', 'src/lib/money.…
    104|     ).toBe(false)
       |       ^

 Test Files  1 failed (1)
      Tests  2 failed | 9 passed (11)
```

Anchoring the match turned both green: `Tests 11 passed (11)`.

## 2. `classes.unresolvedLandings` — a landing site repointed at an absent file

Break: in `scripts/plans/drift-classes.ts`, the `00-S10` chart-frame entry's
`landedAt: ['src/components/charts/chart-frame.tsx']` became
`landedAt: ['src/components/ui/money-field.tsx']` — a path the plan document names but nothing on
disk provides, so the break isolates this check from the mention one.

```
 FAIL  scripts/plans/__tests__/plan-paths.test.ts > docs/plans/00-foundations.md > resolves every recorded landing site on disk
AssertionError: expected [ 'src/components/ui/money-field.tsx' ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "src/components/ui/money-field.tsx",
+ ]

 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
```

Reverted: `drift-classes reverted`.

## 3. `classes.unmentionedLandings` — a landing site dropped from the prose

Break: the one place `docs/plans/00-foundations.md` names the directory (line 224, `per-\`kind\`
handlers under \`src/server/queue/handlers/\``) was reworded to `under their own directory`. This is
the regression the check exists to catch — a correction that silently drops a moved subject.

```
 FAIL  scripts/plans/__tests__/plan-paths.test.ts > docs/plans/00-foundations.md > names every recorded landing site somewhere in the document
AssertionError: expected [ 'src/server/queue/handlers' ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "src/server/queue/handlers",
+ ]

 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
```

Reverted: `plan reverted`.

## What the tightened match surfaced

Nothing. The issue warned that anchoring could surface entries the substring test hid; it did not.
All 23 distinct landing sites in `drift-classes.ts` are named at a path boundary in the document,
and `pnpm exec tsx scripts/plans/audit.ts docs/plans/00-foundations.md` still reports
`every recorded landing site is named in the plan`. The one entry where the two rules could have
disagreed is `src/server/queue/handlers`, named as `src/server/queue/handlers/` — which is why the
right-hand anchor admits a following `/` and the left-hand one does not.
