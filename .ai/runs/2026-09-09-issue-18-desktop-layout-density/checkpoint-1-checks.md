# Checkpoint 1 — Phase 1 closed (Steps 1.1 … 1.4)

**UTC:** 2026-09-09T19:25:00Z
**Steps covered:** 1.1 … 1.4 (`4e348ca` … `a4f6c2b`)
**Touched areas:** `src/styles/tokens.css`, `src/styles/app.css`, `DESIGN.md`, eight `_app` route
modules (one class each), new `e2e/desktop-density.spec.ts`.

## Checks

| Check                                                            | Result                                       |
| ---------------------------------------------------------------- | -------------------------------------------- |
| `pnpm typecheck`                                                 | **pass** — no diagnostics                    |
| `pnpm lint`                                                      | **pass** — 0 errors, 2 pre-existing warnings |
| `pnpm build`                                                     | **pass** — built in 17.29s                   |
| `pnpm test`                                                      | **pass with a caveat** — see below           |
| `npx prettier --check DESIGN.md`                                 | **pass**                                     |
| Generated CSS carries `--list-max` and `--container-list`        | **pass** — read out of `dist/client/assets`  |
| `e2e/desktop-density.spec.ts` (chromium, both locales)           | **pass** — 18/18                             |
| Red-then-green on the new browser case                           | **pass** — see below                         |
| Frames at 1440 + 360, light + dark, for the three Phase 1 routes | **captured and read**                        |

### `pnpm test` — the caveat, stated rather than buried

The full suite reports between one and seven failures on this machine, and the set changes between
runs. Every failure is `Error: Test timed out in 5000ms` in one of two files:

- `.claude/hooks/__tests__/hooks.test.ts` — 198 cases that each spawn a shell; 50–90s wall clock.
- `src/routes/_app/dashboard/-server/__tests__/dashboard-data.test.ts` — a server data loader.

Run alone, both are green: hooks 198/198, dashboard-data 3/3 in 1.53s. Run as a pair, they go red
together. Neither is reachable from anything on this branch — `git diff origin/develop --stat` is
two CSS files, `DESIGN.md`, eight `className` strings and one new e2e file, and neither test file
imports any of them. This is the machine, not the change (`skill verifying-changes`: a timeout is a
claim about the machine until the text says otherwise; five other dev servers were listening on
3011–3015 during these runs). CI is the arbiter and the final gate re-runs it.

### Red-then-green on the new browser case

The `max-w-prose` cap was removed from `payees/index.tsx`, the `/payees … en` case re-run against
the same server, and it **failed**; the class was restored and it passed. So the case asserts the
change rather than the page.

The token guard is **not** exercised yet, and deliberately: `src/styles/__tests__/token-classes.test.ts`
only sees a token a `.tsx` file consumes, and Phase 1 adds no consumer. Step 2.1 owns that
red-green.

## Environment

- `sh .ai/scripts/test-env-up.sh` → `http://127.0.0.1:3016` (vite dev, local D1, seeded demo
  workspace). Ports 3011–3015 were already taken by other checkouts.
- Frames: `.ai/qa/artifacts_issue-18/phase-1/` — twelve PNGs, `{1440,360}-{light,dark}-{payees,goals,transactions-rules}`.
  They stay outside the repository (`AGENTS.md` → Never; `.gitignore:32`), so this checkpoint has no
  `checkpoint-1-artifacts/` folder. They are attached to the PR instead.

## What the frames say

`/transactions/rules` at 1440 is the clearest read: the subtitle that ran the full column now wraps
at ~585px, three lines, and the heading block reads as a block instead of as a banner. `/payees` and
`/goals` change by one wrapped line each. Nothing moved at 360 on any of the three, in either theme,
which is what Phase 1 promised.

**Observed, not acted on:** the `/transactions/rules` rows show the same fault issue #18 is about —
content ending at x≈650 with the card rule drawn to x≈1405. That route is not one of the spec's
seven surfaces (it is listed under "subtitle line length only"), so it is recorded here rather than
widened into this PR.

## Deviation recorded

The reference recipe for the Tasks table (`references/per-step-loop.md`) is to write a placeholder
`Commit` cell and `git commit --amend` the real short SHA in before pushing. That is self-defeating:
amending changes the SHA again, so the cell ends up naming a commit that no longer exists — which
is what happened to Step 1.1 on its first write (`b4a8975`, unreachable). Per-Step commits therefore
write `pending`, and each checkpoint backfills the real SHAs by reading `git log`. The Steps stay
1:1 with their commits and the recorded SHAs are reachable.
