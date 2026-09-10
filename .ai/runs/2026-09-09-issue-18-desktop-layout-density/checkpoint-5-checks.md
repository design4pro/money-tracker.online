# Checkpoint 5 — Phase 6 closed (Steps 6.1 … 6.3), and with it the plan

**UTC:** 2026-09-09T23:25:00Z
**Steps covered:** 6.1 … 6.3 (`8a04d8b`, `278c444`, `0198f19`)
**Touched areas:** `src/lib/i18n/messages/en.ts`, `src/lib/i18n/messages/pl.ts`,
`src/lib/i18n/__tests__/shipped-plurals.test.ts` (new), `src/routes/_app/accounts/index.tsx`,
`e2e/desktop-density.spec.ts`. **`src/components/app/transactions/filter-bar.tsx` is untouched** —
see "Step 6.3 ships its assertion and not its edit" below.

## Checks

| Check                                                                   | Result                                       |
| ----------------------------------------------------------------------- | -------------------------------------------- |
| `node .ai/scripts/agent-kit-check.mjs`                                  | **pass** — 32 managed files match, kit 16    |
| `pnpm generate-routes` + `git diff --exit-code -- src/routeTree.gen.ts` | **pass** — no drift                          |
| `pnpm typecheck`                                                        | **pass** — no diagnostics                    |
| `pnpm lint`                                                             | **pass** — 0 errors, 2 pre-existing warnings |
| `pnpm build`                                                            | **pass** — built in 1.96s                    |
| `pnpm exec vitest run src/lib/i18n/__tests__ src/styles/__tests__`      | **pass** — 197/197, 13 files                 |
| `e2e/desktop-density.spec.ts` (chromium, both locales)                  | **pass** — 38/38                             |
| plus `accessibility` + `core-flow` + `narrow-viewport`                  | **pass** — 77/77 together                    |
| `pnpm exec prettier --check` on every touched file                      | **pass**                                     |
| Frames for `/accounts` and `/transactions` at 1440 + 360, light + dark  | **captured and read**                        |

The two lint warnings are `no-shadow` in `src/server/billing/webhook-verify.ts` and
`worker-configuration.d.ts`, both on `main` and neither in a file this run touches.

## Red-then-green on the new browser cases

- **The `/accounts` counterweight** (Step 6.2) — with the render condition forced to `false`, all
  **four** new `/accounts` cases fail on `expect(...).toBeVisible()` with `element(s) not found`,
  while the two older subtitle cases on the same route stay green. The band's end holding nothing
  at all is exactly the shape issue #18 names. Restored: 6/6.
- **The phone-cost bound** (Step 6.2) — measured at 360×800 as the delta between the band carrying
  the count and the same band without it: **89px → 115px, a delta of 26px**, identical in `en` and
  `pl`, against a 40px budget. One caption line and the 8px above it, which is the whole of what
  this phase costs a 360px screen.
- **The toolbar cluster** (Step 6.3) — this case ships without a change behind it, so it was made
  to fail deliberately: giving the search field `md:w-[640px] md:flex-none` fails it in both
  locales with `Expected: < 578 / Received: 640`. A field that takes more than half the bar is the
  defect the case exists to catch, and it catches it.
- **The Polish plural** (Step 6.1) — the unit case failed first with `'Widoczne 1 z 5 konta'` where
  `'kont'` is correct, because `pl.ts` had no `many` branch. Four categories later it passes for
  1, 2, 5 and 22.

## Step 6.3 ships its assertion and not its edit

The plan's Step 6.3 asked for a bounded width on the `/transactions` search field from `md` up, so
that "the three icon controls close up beside it into one start cluster". **Measured before writing
it, the field is already 274.3px (`en`) / 282.1px (`pl`) inside a 1156px bar at 1440×900**, and the
next control sits at the bar's own 8px gutter. The 1440 frame shows why: the toolbar has since grown
a date filter, a sort select and a sort-direction button, and it runs edge to edge — Search, Any
date, Date, sort, Filters, New transaction. `md:max-w-md` is 448px, so the cap would not bind at any
viewport and the diff would have changed no rendered pixel.

Issue #18's "the top bar is a wide empty band holding three icons at its edge" was measured on
2026-09-03 against a bar that no longer exists. This is the same call the plan already makes about
the dashboard header band, in the plan's own words: _"A phase that 'fixed' it would be a diff with
no defect behind it."_

So the Step landed as an assertion. That is worth more than the edit would have been: the property
the spec cares about held only by accident of how many controls the bar happens to carry, and is now
checked in both locales — at 1440 the field is under half the bar and the next control is within
16px of its end edge; at 360 the field is still the widest control on its row (151px of a 328px bar,
sharing it with a 121px date control and a 40px button) and the row is full.

## What the frames say

- **`/accounts` at 1440, narrowed** — `Showing 0 of 5 accounts` sits at x≈1409, the band's own end,
  opposite the segmented control at x≈252. The row that carried a control and ~900px of nothing now
  carries both of its ends.
- **`/accounts` at 1440, `?status=all`** — the same band with nothing at its end, because "5 of 5"
  is a sentence that says nothing. The absence is the design, and the browser case asserts it.
- **`/accounts` at 360** — the count wraps onto its own line under the control, 20px taller than the
  quiet band, and nothing else on the screen moves.
- **`/transactions` at 1440 and 360** — unchanged by this run, and photographed for exactly that
  reason: the toolbar is one packed cluster in both themes at both widths.

## Observed, not acted on

At 360×800 on `/accounts` the first account row already sits at y≈860 — below the fold — in the
demo workspace, and it did so before this phase: measuring the same assertion against the
pre-change file gives identical numbers. The cause is the two overview cards above the list, not
the count. It is recorded here because the plan's Risks section asked for an above-the-fold
assertion at 360 and this is why the Step carries a delta bound instead.

## Environment

- `sh .ai/scripts/test-env-up.sh` → `http://127.0.0.1:3016`, still up from checkpoint 1.
- Frames: `.ai/qa/artifacts_issue-18/phase-6/` — twelve PNGs, outside the repository
  (`AGENTS.md` → Never), attached to PR #156.
- Frames are `en` only, as in every earlier phase: `scripts/visual/capture.mjs` has no locale flag
  and the locale is a cookie, not a query parameter. The Polish rendering of the new copy is
  covered by the `pl` half of every browser case rather than by a frame.
