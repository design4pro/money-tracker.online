# 0023. oxlint replaces ESLint

Status: proposed
Date: 2026-09-24

## Context

The gate runs far more often on the agents' host than in CI: every cezar run and every interactive
agent runs `validation.commands` before each push, several of them side by side on one 4-vCPU VPS.
On 2026-09-24 that host sat at a load average of 18-22 with its 4 GB of swap full, and the heaviest
single process on it was ESLint at 1.7 GB RSS.

`@tanstack/eslint-config` sets `parserOptions.project: true`, so ESLint built a second TypeScript
program next to the one `pnpm typecheck` builds in the same gate. #460 turned that off - only three
enabled rules read types - and put `--cache` in the `lint` script. Measured on the quiet VPS:

| `pnpm lint`                 | wall   | max RSS |
| --------------------------- | ------ | ------- |
| ESLint, typed (before #460) | 55.5 s | 1.96 GB |
| ESLint, untyped, cold       | 27.8 s | 0.88 GB |
| ESLint, untyped, warm cache | 3.3 s  | 0.33 GB |
| oxlint 1.85, same rule set  | 2.2 s  | 0.58 GB |

The warm cache only helps the checkout that wrote it. A fresh cezar worktree, a push to `develop`
and every CI run on a branch the cache has not seen pay the cold price.

The second reason is TypeScript 7. Its `typescript` package no longer exports the compiler API (the
main entry returns the version; the rest is under `typescript/unstable/*`), and typescript-eslint
declares `typescript <6.1.0`. As long as ESLint lints this repository, `tsc` cannot move to the
native compiler.

## Decision

`oxlint` replaces `eslint` and `@tanstack/eslint-config` in the dependency set. The rules move to
`.oxlintrc.json`, produced by `@oxlint/migrate` from the old `eslint.config.js` and checked against
it:

- The linted file set is identical: 749 files under both tools, compared file by file.
- The layering law and the money rule behave as before, checked with probe files: a value import of
  `drizzle-orm` or of the schema from client code is an error, a type-only schema import is not,
  `components/ui` may not import from `server/`, the dev seed route and tests stay exempt, and
  `toFixed` under `src/` is an error outside tests.
- `eslint-disable` comments keep working; oxlint reads them.

What does not carry over, because oxlint has no counterpart: `@typescript-eslint/naming-convention`
(the `T`-prefix on type parameters) and `@stylistic/spaced-comment`. `no-octal` is dropped as well -
an octal literal is already a syntax error in a strict-mode module. `node/prefer-node-protocol`
continues as `unicorn/prefer-node-protocol`.

oxlint honours `.gitignore`, the nested `.ai/**/.gitignore` files included. The ESLint `ignores`
list had to be reconciled with them by hand, and every gap turned the gate red on the machine that
wrote the directory (#203, #229). That reconciliation is gone: `ignorePatterns` names only the
tracked paths that are not ours to lint, and `scripts/__tests__/lint-ignores.test.ts` pins both
halves through the real binary.

There is no lint cache any more. At two seconds there is nothing for one to save, and a cache was
the one place where a stale verdict could hide.

## Consequences

- SPEC §3 lists oxlint in the pinned tooling instead of ESLint.
- `pnpm lint`, `pnpm lint:fix` and `pnpm format` call `oxlint`. The CI lint rung loses its cache
  step.
- `eslint.config.js` is deleted, and `tsconfig.json` no longer includes it.
- The type-aware rules stay off. oxlint can run them through `oxlint-tsgolint`; bringing them back
  is a separate decision with its own measurement, because it adds a dependency.
- With nothing left importing the compiler API, TypeScript 7 becomes possible. That upgrade is its
  own ADR.
