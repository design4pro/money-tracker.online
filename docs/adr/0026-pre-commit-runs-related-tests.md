# 0026. The pre-commit hook runs the tests a commit reaches

Status: proposed
Date: 2026-09-24

## Context

`.husky/pre-commit` ran `lint-staged`, `pnpm typecheck` and the whole `pnpm test` on every
developer commit. On the 4-vCPU VPS the whole suite took 222 s at a load average under 3 (217 test
files), and on a host shared with agent runs it is the suite that times out first, on a test the
commit never touched.

Cezar runs skip the hook (`CEZ_TASK_ID`, docs/agents/cezar.md) and are gated by the full
`validation.commands`. Their logs from 2026-09-23 and 2026-09-24 show that runs already narrow
their own test runs outside that gate, so there is nothing to change for them. The hook is where the
time goes.

`vitest --changed` picks tests by the module graph, and that graph is blind to a test that checks
a file it never imports. 48 test-side files read the disk or start a process, 44 of them test
files: the i18n source rules, the design-token and font checks, the repository harnesses that
replay `drizzle/`, the ignore-list test that reads `.gitignore`, and the hook tests. `.gitignore` is
not hypothetical: a change to it broke `pnpm test` through the ignore-list test (then
`eslint-ignores.test.ts`) on 2026-09-24 (#444).

## Decision

The hook runs:

```sh
pnpm exec vitest related --run --passWithNoTests \
  $(git diff --cached --name-only --diff-filter=d) \
  $(git grep -lE '<disk or process access>' -- '*.test.*' '*__tests__/*')
```

That covers every test that imports a staged file, and every test-side file that reads the disk or
starts a process, together with every test that imports such a helper. The second list is found
by `git grep` on every commit, not kept by hand, so a new test of that kind joins it without anyone
remembering to add it. A staged `package.json`, vitest config or setup file still runs the whole
suite: vitest checks the related files against `forceRerunTriggers`.

Rejected alternatives:

- **Plain `--changed`.** It drops the 44 disk-reading test files, and those are the rule tests a commit
  is most likely to break without importing them.
- **Keep the whole suite.** The part of it no commit could reach is exactly what this ADR saves.

## Consequences

- The disk-reading set alone is 70 test files and 2006 of the suite's 3685 tests, 121 s against
  the full run's 222 s, measured one after the other on `develop` at 08b2ad7 with this change on
  top. That is the least a commit pays. A commit that reaches a shared module pays more; one that touches the vitest config
  pays the whole suite.
- A test that reads the disk through something the grep does not name, such as a new fs API or a
  helper outside `__tests__`, escapes the hook. It is still caught by `validation.commands` and CI,
  which run the whole suite; the hook is the early warning, not the gate.
- `pnpm test` before a PR is now step 3 of the verification ladder (`verifying-changes`), no
  longer something the hook does on every commit.
- `scripts/__tests__/pre-commit.test.ts` pins the command: stubbed `npx` and `pnpm` record what the
  hook asks for in a scratch repository.
