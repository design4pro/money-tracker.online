# Checkpoint 2 — Phases 2 and 3 closed (Steps 2.1 … 3.3)

**UTC:** 2026-09-09T20:25:00Z
**Steps covered:** 2.1 … 3.3 (`f4295f1` … `76d758d`)
**Touched areas:** `/categories` (route + `category-states.tsx`), `/transactions/groups`,
`/recurring` (route + `recurring-skeletons.tsx` + the new `panes.ts`), `e2e/desktop-density.spec.ts`,
new `recurring-skeletons.test.tsx`.

## Checks

| Check                                                                  | Result                                       |
| ---------------------------------------------------------------------- | -------------------------------------------- |
| `pnpm typecheck`                                                       | **pass** — no diagnostics                    |
| `pnpm lint`                                                            | **pass** — 0 errors, 2 pre-existing warnings |
| `pnpm build`                                                           | **pass** — built in 3.93s                    |
| `pnpm test`                                                            | **pass with the same caveat** — see below    |
| `npx prettier --check` on every touched file                           | **pass**                                     |
| `e2e/desktop-density.spec.ts` (chromium, both locales)                 | **pass** — 34/34                             |
| `e2e/narrow-viewport.spec.ts` + `e2e/accessibility.spec.ts`            | **pass** — 64/64 together with the above     |
| `e2e/recurring.visual.spec.ts` + `recurring-candidates.visual.spec.ts` | **pass** — nothing the reorder broke         |
| Token guard red-green (Step 2.1)                                       | **pass** — see below                         |
| Red-then-green on each new browser case                                | **pass** — see below                         |
| Frames at 1440 + 360, light + dark, for all three routes               | **captured and read**                        |

### The token guard, finally exercised

Phase 1 could not show it: `src/styles/__tests__/token-classes.test.ts` only sees a token a source
file consumes, and Phase 1 added no consumer. Step 2.1 added `max-w-list` to
`src/routes/_app/categories/index.tsx`, so the deletion of `--container-list` from
`src/styles/app.css` was re-run:

```
AssertionError: expected [ 'max-w-list' ] to deeply equal []
+ [ "max-w-list" ]
```

Restored, green again. The deletion was never committed.

### Red-then-green on the new browser cases

- **`/categories`** — the cap removed from the tree's wrapper, the `en` case re-run: **failed** on
  `width <= 912`. Restored: passes.
- **`/transactions/groups`** — the cap removed from the table's wrapper: **failed** on the same
  assertion. Restored: passes.
- **`/recurring` rail track** — the template changed to `lg:grid-cols-[minmax(0,1fr)_auto]`: the
  rail measured **332.48px** instead of 320. Restored: passes. That is the exact regression the case
  exists to catch — an `auto` track lets the rail's own content decide the column.

### `pnpm test` — the caveat, unchanged from checkpoint 1

Two failures out of 2458, both `Error: Test timed out in 5000ms` in
`src/routes/_app/dashboard/-server/__tests__/dashboard-data.test.ts`. Run alone the file is 3/3 in
2.55s. Nothing on this branch reaches it — the diff is three route modules, two component modules,
one new 15-line constant module, one e2e file and one new component test — and the file was already
flaky on this machine at checkpoint 1, before any of it existed. `skill verifying-changes`: a
timeout is a claim about the machine until the text says otherwise. CI is the arbiter and the final
gate re-runs it.

## Environment

- `sh .ai/scripts/test-env-up.sh` → `http://127.0.0.1:3016` (vite dev, local D1, seeded demo
  workspace), still up from checkpoint 1.
- Frames: `.ai/qa/artifacts_issue-18/phase-2-3/` — sixteen PNGs, outside the repository
  (`AGENTS.md` → Never; `.gitignore:32`), attached to PR #156.

## What the frames say

- **`/categories` at 1440** — the tree now ends at x≈1144 instead of x≈1405. The rows read as a
  list rather than as a set of rules drawn across the page. **Observed, not acted on:** the gap
  _inside_ a row (name and badge end at x≈600, the overflow menu sits at x≈1114) is narrowed by the
  cap but not closed; that is the row's own composition, which the spec deliberately leaves alone —
  issue #18's Out of scope forbids adding a fifth fact to fill it.
- **`/transactions/groups` at 1440** — four columns over 896px instead of over 1156px. `EXPENSES`,
  `TOTAL` and `ACTIONS` now sit close enough to their figures to be read as their headings.
- **`/recurring` at 1440** — the series list at 812px with the `Due soon` rail at 320px beside it.
  The rail ends at its own last row (`items-start`), so the empty space below it is empty page
  rather than a stretched card.
- **`/recurring` at 360, before and after** — the phase's one contestable trade, and the pair is in
  the PR body. Before: `Due soon` occupied the whole first screen and the first series card was cut
  off by the fold. After: the first two series cards are above the fold and `Due soon` follows the
  list. The reorder is real and it is the right way round — the reason somebody opens `/recurring`
  is the series they keep.
- Nothing moved at 360 on `/categories` or `/transactions/groups`, in either theme, which is what
  the caps promised.

## Decisions taken in these phases

- **A shared constant for the `/recurring` panes.** The spec asks the skeleton's and the loaded
  screen's pane widths to match to within 1px. Two copies of one class string is a drift waiting to
  happen, so `RECURRING_PANES` (`src/components/app/recurring/panes.ts`) is imported by both and the
  match is true by construction rather than by assertion.
- **The "nothing is due" case is asserted by emptying the rail in the page**, not by seeding a
  workspace. No fixture holds series with nothing outstanding, and writing recurring rows straight
  into D1 to make one would be a great deal of fixture for a claim about a grid track. The variable
  — the rail's content — is isolated either way.
- **`/transactions/groups` error panel left uncapped.** The spec names the skeleton and the empty
  state for that step and not the error panel, unlike the `/categories` step, which names all four.
  Followed literally rather than widened.
