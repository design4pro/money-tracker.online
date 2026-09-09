# Checkpoint 4 — Phase 5 closed (Steps 5.1 … 5.3)

**UTC:** 2026-09-09T22:55:00Z
**Steps covered:** 5.1 … 5.3 (`3ec1aa0`, `e1ca9d7`, `9d3b368`)
**Touched areas:** `src/components/app/dashboard/` (`widget-grid.tsx`, `widget-frame.tsx`,
`net-worth-widget.tsx` docblock, `__tests__/widget-grid.test.tsx`),
`src/routes/_app/dashboard/index.tsx`, `e2e/desktop-density.spec.ts`.

## Checks

| Check                                                  | Result                                       |
| ------------------------------------------------------ | -------------------------------------------- |
| `pnpm typecheck`                                       | **pass** — no diagnostics                    |
| `pnpm lint`                                            | **pass** — 0 errors, 2 pre-existing warnings |
| `pnpm build`                                           | **pass** — built in 1.63s                    |
| `pnpm test`                                            | **pass** — 2463/2463, 162 files, no caveat   |
| `npx prettier --check` on every touched file           | **pass**                                     |
| `e2e/desktop-density.spec.ts` (chromium, both locales) | **pass** — 34/34                             |
| `e2e/accessibility.spec.ts` + `e2e/core-flow.spec.ts`  | **pass** — 68/68 together with the above     |
| Red-then-green on both new browser cases               | **pass** — see below                         |
| Frames for `/dashboard` at 1440 + 360, light + dark    | **captured and read**                        |

### `pnpm test` — the flake did not reproduce

The full suite is 2463/2463 green this run, and
`src/routes/_app/dashboard/-server/__tests__/dashboard-data.test.ts` is among the files that passed.
That is the last evidence needed for what checkpoints 1-3 recorded: those 5s timeouts were load on
this machine, not a defect on this branch. The final gate runs it once more.

### Red-then-green on the new browser cases

- **Panels not stretched** (Step 5.1) — `items-start` removed from the grid, the case re-run in both
  locales: **failed** on `expect(heights.size).toBeGreaterThan(1)` with `Received: 1`. One height for
  three panels holding three different amounts is the defect itself. Restored: passes.
- **The header band carries both ends** (Step 5.2) — this one is green on its first run by design,
  so it was made to fail deliberately instead: deleting the band's right-hand group (the
  `PeriodSelector` and the primary "New transaction" link) leaves **983.3px** of empty band in `en`
  and **1004.9px** in `pl` against a 32px bound. That is issue #18's "empty ~1000px header strip",
  reproduced to the pixel and now guarded.

## Environment

- `sh .ai/scripts/test-env-up.sh` → `http://127.0.0.1:3016`, still up from checkpoint 1.
- Frames: `.ai/qa/artifacts_issue-18/phase-5/` — six PNGs, outside the repository (`AGENTS.md` →
  Never), attached to PR #156.

## What the frames say

- **`/dashboard` at 1440, before** — the bottom row's three cards all end at y≈1275: `Spending by
category` finishes its legend at y≈1105 and carries 170px of empty floor, `Accounts` finishes its
  link at y≈1120 and carries 155px. Both are the "120-150px voids" issue #18 measured.
- **`/dashboard` at 1440, after** — each card ends where its own content ends: `Spending` at y≈1130,
  `Accounts` at y≈1148, `Latest transactions` at y≈1275. The row's bottom edge is ragged, which is
  what three panels of different lengths look like when none of them is padded out to match the
  others.
- **Unchanged in both frames:** the header band, the summary `dl`, `Net worth` (already
  content-height before this phase), and the whole page at 360 in both themes, where the grid is one
  column and `items-start` has nothing to do.
- **Still there, and now filed:** the gap inside the `Net worth` card between its caption and the
  card's own end. That is #161 — vertical density inside a hand-rolled panel, a different fault with
  a different fix.

## Decisions taken in this phase

- **`WidgetFrame`'s `height` prop was carried along rather than left as a no-op.** The spec's step
  names one line — `items-start` on the grid — but `WidgetFrame` already had a `height` prop whose
  `'fill'` branch worked by _adding no class_ and relying on the grid's ambient stretch. Adding
  `items-start` on its own would have turned a documented prop into a silent no-op. So `'fill'` now
  renders `self-stretch` explicitly and `'content'` is the default; the `Net worth` frame drops the
  `height="content"` it needed when stretching was the default. Same behaviour the spec asked for,
  minus a dead prop. Recorded here because it is wider than the step's literal text.
- **The header band case asserts existing behaviour on purpose.** It is expected green on its first
  run. Its value is the red proof above: the claim in this plan's Non-goals — "the passbook work
  already closed #18's header finding" — is now something a test says rather than something a
  document asserts.
- **The Net worth void went to its own issue (#161), not into this PR.** Spec Q10. Everything else
  in issue #18 is horizontal — a row wider than its content — and answered by a width band or a
  second column. That one is vertical density inside a hand-rolled chart (ADR 0007) and shares
  neither the decision rule nor the token.
