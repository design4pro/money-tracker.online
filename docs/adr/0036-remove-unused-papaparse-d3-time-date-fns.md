# 0036. Unused `papaparse`, `d3-time` and `date-fns` are removed from the dependency set

Status: accepted
Date: 2026-11-03

## Context

#234 dispositioned every runtime dependency that nothing imports. Seven of those rows were
`pending-*` because `docs/SPEC.md` §3.1 freezes `package.json` and `AGENTS.md` puts adding, removing
or upgrading a package under **Ask First**. #353 is where those decisions were spent.

Three of the seven were placement, not removal: `@tanstack/react-devtools`,
`@tanstack/react-query-devtools` and `@tanstack/react-router-devtools` are consumed by
`@tanstack/devtools-vite` (already a `devDependency`) and no application file imports them. They
move to `devDependencies`. That move is recorded here only so the freeze's ledger is complete; it
is not a change to the pinned runtime set.

The other four were `motion`'s shape (ADR 0019): the module that was supposed to import the package
exists, and it does the job another way.

| Package                | The promise                                                                   | What `git ls-files` actually imports                                                               |
| ---------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `papaparse`            | `19-S1` / `IMP-02` — the CSV parser                                           | `src/server/import/csv/scan.ts`, `sniff.ts` and `parse.ts` are hand-rolled                         |
| `d3-time`              | `16-S1` / `CHART-01` — scale and axis utilities over `d3-scale` and `d3-time` | `src/components/charts/scales.ts` imports `scaleBand` and `scaleLinear` from `d3-scale` only       |
| `date-fns`             | `docs/MONEY.md` — formatting only                                             | `src/lib/i18n/format.ts` formats through `@internationalized/date` and `@internationalized/number` |
| `@tanstack/react-form` | SPEC §3's stack list, and nothing else                                        | `src/components/ui/form.tsx` ships on React Aria `Form`                                            |

## Decision

`papaparse`, `d3-time` and `date-fns` are removed from `package.json` and `pnpm-lock.yaml`.
`@types/papaparse` and `@types/d3-time` leave with them; nothing else in the tree depended on those
type packages. `d3-scale` and `d3-shape` stay.

**`@tanstack/react-form` stays** in `dependencies` and in SPEC §3. #353 asked the question; the
answer is keep the declaration even though no file imports it yet. Its row in
`scripts/__tests__/dependency-imports.test.ts` is `keep`, citing this ADR.

The three TanStack `*-devtools` packages move from `dependencies` to `devDependencies` at the same
caret versions they already had. `pnpm build` with `--frozen-lockfile` after the lockfile update is
what proves the production bundle does not need them as runtime dependencies.

## What this costs

Nothing at runtime: removing packages no module imports cannot change a byte of the bundle. The
cost is optionality. A future CSV parser, a `d3-time` tick helper, or a `date-fns` formatter starts
from a re-install and a fresh ADR rather than from an import. That is the intended shape of the
freeze.

Keeping `@tanstack/react-form` costs the inverse: a declared unused runtime dependency, watched by
the import guard, until a stage actually imports it or a later ADR removes it.

## Consequences

- SPEC §3 no longer lists `d3-time`, `papaparse` or `date-fns` in the pinned stack, and still lists
  `@tanstack/react-form`. §3.1 records this removal beside ADR 0019.
- ADR 0007 is amended, not rewritten: the 2026-09-01 decision still names `d3-time`; the live stack
  is `d3-scale` and `d3-shape`.
- `docs/MONEY.md` §1.5 drops the `date-fns` formatting clause. Calendar arithmetic stays on
  `@internationalized/date`; formatting stays in `src/lib/i18n/format.ts`.
- `docs/plans/16-charts.md` and `docs/plans/99-boundaries-and-blockers.md` BND-20 name `d3-scale` /
  `d3-shape` only.
- The import guard drops the three moved packages and the three removed ones. It may only shrink.
