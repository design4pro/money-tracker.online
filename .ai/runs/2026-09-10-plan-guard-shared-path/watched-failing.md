# Watched failing — assertion 5, the shared-path rule (#321)

Every case added for `.ai/specs/2026-09-10-plan-guard-shared-path-assertion.md`, watched failing
before it was watched passing. Command in each case:
`pnpm exec vitest run --project=tooling scripts/plans/__tests__/plan-paths.test.ts`, with
`TMPDIR=/tmp` for `tsx` (#221). Every break was restored immediately afterwards (`git checkout` on
a plan document or the README, a saved copy for `audit.ts`), and the final run on the restored tree
read `Tests  66 passed (66)`.

## 0. Before the implementation

The cases were written first, against an `audit.ts` that exported neither `SHARED_PATHS` nor
`sharedPathViolations`: `Failed Tests 38`, every whole-set case and every fixture case red.

## 1. Re-measure before the whole-set case (Step 1.3)

`sharedPathViolations` over every `docs/plans/NN-*.md`, once with each document's own path and once
as if no document were exempt:

```
00-foundations.md violations 0 if not exempt 29
documents 31 stages 104 entries 641
```

Zero outside `00-foundations.md`, 29 inside it: the spec's figures, unchanged.

## 2. The parity case, both directions and the missing heading

Dropping `src/lib/money.ts` from `SHARED_PATHS`:

```
 FAIL  … > the shared-path list > matches the first column of "The eight shared paths" in docs/plans/README.md
AssertionError: expected [ 'src/components/ui/**', …(6) ] to deeply equal [ 'src/components/ui/**', …(7) ]
      Tests  2 failed | 64 passed (66)
```

(The second failure is the exact-match fixture case, which names `src/lib/money.ts`.)

Adding a ninth, `src/lib/format.ts`:

```
 FAIL  … > the shared-path list > matches the first column of "The eight shared paths" in docs/plans/README.md
AssertionError: expected [ 'src/components/ui/**', …(8) ] to deeply equal [ 'src/components/ui/**', …(7) ]
      Tests  1 failed | 65 passed (66)
```

Renaming the README heading to `## The shared paths`:

```
 FAIL  … > the shared-path list > matches the first column of "The eight shared paths" in docs/plans/README.md
AssertionError: heading "## The eight shared paths": expected -1 to be greater than -1
      Tests  1 failed | 65 passed (66)
```

## 3. Assertion 5 on a guarded document (Step 1.2)

`- \`src/lib/money.ts\` — edit`added as the first`Owned paths`entry of`02-S1`in`docs/plans/02-i18n.md`:

```
 FAIL  … > docs/plans/02-i18n.md > assertion 5: 'no stage outside `00-foundations.md` …'
+   "02-S1 (line 41): `src/lib/money.ts` — a shared path; `docs/plans/00-foundations.md` owns it and no other stage may declare it (docs/plans/README.md, \"The eight shared paths\")",
 FAIL  … > docs/plans/02-i18n.md shared paths > declares none of the eight shared paths unless it is the foundations plan
      Tests  2 failed | 64 passed (66)
```

The CLI on the same break:

```
  5. no stage outside `00-foundations.md` declares one of the eight shared paths — FAIL (1)
       02-S1 (line 41): `src/lib/money.ts` — a shared path; `docs/plans/00-foundations.md` owns it and no other stage may declare it (docs/plans/README.md, "The eight shared paths")
```

## 4. The whole-set case on a document that is not guarded (Step 1.3)

`- \`src/components/ui/badge.tsx\` — new`added to`06-S1`in`docs/plans/06-accounts.md`, which is
not on `GUARDED_PLANS`:

```
 FAIL  … > docs/plans/06-accounts.md shared paths > declares none of the eight shared paths unless it is the foundations plan
+   "06-S1 (line 39): `src/components/ui/badge.tsx` — under the shared path `src/components/ui/**`; `docs/plans/00-foundations.md` owns it and no other stage may declare it (docs/plans/README.md, \"The eight shared paths\")",
      Tests  1 failed | 65 passed (66)
```

Before this change nothing in the suite read that document's `Owned paths`.

## 5. The matching rule against naive implementations (Step 1.4)

`sharedPathOf` swapped for each naive rule in turn.

Substring, `path.includes(shared.replace('/**', ''))`:

```
 FAIL  … > the shared-path rule > does not flag a neighbouring filename
 FAIL  … > the shared-path rule > does not flag a sibling directory that merely starts with `src/components/ui`
      Tests  2 failed | 64 passed (66)
```

`src/lib/money-format.ts` does not contain `src/lib/money.ts`, so the substring rule alone passes
it; the neighbour case also carries `src/lib/money.tsx`, which the substring rule does confuse. A
bare prefix of the path without its extension or glob,
`path.startsWith(shared.replace(/\/\*\*$|\.[a-z]+$/, ''))`, fails on both neighbours:

```
 FAIL  … > the shared-path rule > does not flag a neighbouring filename
AssertionError: expected [ …(2) ] to deeply equal []
 FAIL  … > the shared-path rule > does not flag a sibling directory that merely starts with `src/components/ui`
      Tests  2 failed | 64 passed (66)
```

Literal glob only, `path === shared`:

```
 FAIL  … > the shared-path rule > flags the glob, the bare directory and a file beneath it, naming the glob
AssertionError: expected [ Array(1) ] to deeply equal [ …(3) ]
      Tests  1 failed | 65 passed (66)
```

## 6. The exemption by basename

The exemption rewritten as `planPath === \`docs/plans/${SHARED_PATH_OWNER}\``:

```
 FAIL  … > the shared-path rule > exempts the foundations plan by basename, relative or absolute
+   "04-S2 (line 5): `src/server/db/schema.ts` — a shared path; …",
      Tests  1 failed | 65 passed (66)
```
