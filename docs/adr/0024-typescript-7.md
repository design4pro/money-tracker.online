# 0024. TypeScript 7

Status: proposed
Date: 2026-09-24

## Context

`pnpm typecheck` runs in every gate, on the agents' 4-vCPU VPS as often as anywhere, and after ADR
0023 took ESLint out it was the gate's heaviest rung left. TypeScript 7 is the native (Go) compiler;
it checks the same program with the same `tsconfig.json` and reports no errors on this tree.

What held the upgrade back was ESLint: typescript-eslint declares `typescript <6.1.0`, and
TypeScript 7's `typescript` package no longer exports the compiler API (the main entry returns the
version; the rest is under `typescript/unstable/*`). With oxlint in its place nothing in the
dependency tree imports `typescript` any more - `pnpm why typescript` lists only the direct
devDependency - and no file in the repository does either.

Measured on the VPS with the load average under 2.5, one run each:

| `tsc --noEmit`                   | wall   | max RSS |
| -------------------------------- | ------ | ------- |
| TypeScript 6.0.3                 | 41.1 s | 1.63 GB |
| TypeScript 7.0.2, default        | 9.9 s  | 2.02 GB |
| TypeScript 7.0.2, `--checkers 2` | 8.3 s  | 1.33 GB |
| TypeScript 7.0.2, `--checkers 1` | 9.7 s  | 1.13 GB |

Under load the gap widens: the same TypeScript 6 check took 145.6 s on the host at a load average
of 9, and TypeScript 7 with two checkers 10.0 s.

## Decision

`typescript` moves from `^6.0.2` to `^7.0.2`. The name set is unchanged; SPEC §3 names the major, so
it moves with it.

`pnpm typecheck` runs `tsc --noEmit --checkers 2`. Memory grows with the number of checkers, and
the default count took more memory than TypeScript 6 did without being faster. Two checkers were
the fastest measured and stay under TypeScript 6's memory; one saves another 0.2 GB at a slightly
longer run. On a host several gates share, memory is what runs out first, so the flag is set for
every machine, CI included, rather than tuned per host.

## Consequences

- SPEC §3 lists TypeScript 7.
- Anything that needs the compiler API - a codemod, a custom lint rule, a test that parses source -
  has to get it from `typescript/unstable/*` or another package, and that is its own decision.
- `pnpm build` and the test suites do not load `typescript`, and passed unchanged on this commit.
- `pnpm typecheck` is the single entry point: CI, the pre-commit hook and `validation.commands`
  all call it, so the flag lives in one place.
- The gate's `--incremental` rung (#450) works unchanged: 8.4 s and 1.46 GB with no build info,
  2.1 s and 0.57 GB on the next run.
