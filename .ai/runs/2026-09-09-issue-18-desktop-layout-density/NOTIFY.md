# Notify — 2026-09-09-issue-18-desktop-layout-density

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-09-09T18:55:00Z — run started

- Brief: implement `.ai/specs/2026-09-09-desktop-layout-density.md` — the width vocabulary and the
  per-surface cap-or-earn decision for the seven `_app` surfaces of issue #18.
- External skill URLs: none.
- Engine decision: `om-auto-create-pr-loop` (steps: 24, `--loop`: no) — the spec's Implementation
  Plan has 24 Steps, above `engine.loopStepThreshold` (20).
- Plan decision: the spec's six "capture and read frames" steps produce no commit (no PNG enters the
  repository) and map onto this engine's checkpoint passes, leaving 18 commit-bearing Steps.
- Plan decision: every Step is `inline`. Each is a one-to-three-line presentational change plus its
  assertion and depends on `DESIGN.md` vocabulary and comment prose the main session already holds;
  executor overhead would exceed the work.
- Spec correction carried into the plan: Step 3.2's rail copy is `recurring.upcoming.empty`, the key
  `UpcomingPanel` actually renders. The spec names `recurring.due.none`, which is a different
  existing key used elsewhere. No new key either way.

## 2026-09-09T19:25:00Z — checkpoint 1 (Steps 1.1 … 1.4)

- Phase 1 closed. `typecheck`, `lint`, `build`, `prettier` green; `e2e/desktop-density.spec.ts`
  18/18 on chromium in both locales; the new case proven red without the cap.
- Twelve frames captured and read at 1440 and 360, light and dark, for `/payees`, `/goals` and
  `/transactions/rules`. Outside the repository, attached to PR #156.
- **Problem, not a blocker:** `pnpm test` reports load-flaky 5s timeouts in
  `.claude/hooks/__tests__/hooks.test.ts` and
  `src/routes/_app/dashboard/-server/__tests__/dashboard-data.test.ts`. Both green alone, red as a
  pair, neither reachable from this branch's diff. Five other dev servers were on 3011-3015. CI is
  the arbiter.
- **Decision:** per-Step commits write `pending` in the Tasks table's `Commit` cell and each
  checkpoint backfills the real short SHA. The reference's amend recipe records a pre-amend SHA that
  the amend then makes unreachable, which happened once (`b4a8975`).
- **Observed, not acted on:** `/transactions/rules` rows carry the same void issue #18 describes,
  but that route is not one of the spec's seven surfaces. Recorded, not widened into this PR.
- Environment: `.ai/scripts/test-env-up.sh` → `http://127.0.0.1:3016`.

## 2026-09-09T20:25:00Z — checkpoint 2 (Steps 2.1 … 3.3)

- Phases 2 and 3 closed. `typecheck`, `lint`, `build`, `prettier` green; 64/64 across
  `desktop-density`, `narrow-viewport` and `accessibility` on chromium in both locales; every new
  browser case proven red without its change.
- The token guard Phase 1 could not exercise now bites: deleting `--container-list` fails
  `token-classes.test.ts` with `max-w-list` in `dead`. Restored, never committed.
- **Decision:** the `/recurring` pane geometry lives in one exported constant,
  `RECURRING_PANES` (`src/components/app/recurring/panes.ts`), imported by the screen and by its
  skeleton. The spec asks the two to match to within 1px; a shared constant makes that true by
  construction instead of by assertion.
- **Decision:** "the rail keeps its column when nothing is due" is asserted by removing the rail's
  content in the page and re-measuring the track, not by seeding a workspace. No fixture holds
  series with nothing outstanding and writing recurring rows into D1 to make one would be a great
  deal of fixture for a claim about a grid track.
- **Decision:** `/transactions/groups` keeps its error panel uncapped. The spec names the skeleton
  and the empty state for that step and not the error panel, unlike the `/categories` step. Followed
  literally rather than widened.
- **Deliberate visible change, called out rather than left in a frame:** on a phone `Due soon` now
  sits **below** the series list. The 360 before/after pair is at the top of the PR body.
- **Observed, not acted on:** capping `/categories` narrows but does not close the gap inside a row
  between the badge and the overflow menu. That is the row's own composition and issue #18's Out of
  scope forbids adding a fact to fill it.
- **Problem, unchanged:** `pnpm test` reports two load-flaky 5s timeouts in
  `dashboard-data.test.ts`. Green alone (3/3 in 2.55s), unreachable from this branch's diff, and
  already flaky at checkpoint 1 before any of this existed. CI is the arbiter.

## 2026-09-09T22:45:00Z — checkpoint 3 (Phase 4 closed, Steps 4.1 … 4.3)

- **Checkpoint passed.** `typecheck`, `lint`, `build`, `prettier` green. `pnpm test` 2461/2462 —
  the one failure is the same `dashboard-data.test.ts` 5s timeout every checkpoint has recorded.
  Browser: 30/30 on `e2e/desktop-density.spec.ts`, 47/47 across `budgets.visual`, `narrow-viewport`
  and `accessibility`, chromium, both locales.
- **Red-then-green on both new browser cases.** Unpaired, the second budget card measured
  `x = 244.4375` against the first's `446.4375` — directly below it. Uncapped, the filtered-empty
  panel measured 1156px, the whole well, against a 912px bound.
- **Decision:** the budget list's arrangement lives in `budgetListClass(count)`
  (`src/components/app/budgets/list-layout.ts`), imported by the route and by the skeleton. Same
  reason as `RECURRING_PANES`: the loading picture and the loaded screen agree by construction.
- **Decision:** a workspace with exactly one budget takes `max-w-list`, not half a two-column grid.
  A lone card in `lg:grid-cols-2` is the void the pairing exists to close, moved rather than removed.
- **Decision:** `BudgetCard`'s `<li>` becomes its own bordered card. A hairline between rows says
  "the row below is the next one", which stops being true the moment the next one is beside it.
- **Decision:** the _unfiltered_ `BudgetEmptyState` is left alone. It is a dashed, centred call to
  action for a workspace with no budgets at all, not a list that came back empty; only the filtered
  panel that literally replaces the list took the band.
- **Two claims a browser could not make**, asserted as unit cases instead: a one-budget workspace
  (the seed holds three and the suite only reads it) and the loading picture (racing a browser
  against a pending component would assert about how fast a local D1 answers).
- **Problem, unchanged:** the `dashboard-data.test.ts` flake. Green alone, unreachable from this
  branch's diff, flaky since before this work existed. CI is the arbiter.

## 2026-09-09T22:55:00Z — checkpoint 4 (Phase 5 closed, Steps 5.1 … 5.3)

- **Checkpoint passed.** `typecheck`, `lint`, `build`, `prettier` green. **`pnpm test` 2463/2463 with
  no caveat** — the `dashboard-data.test.ts` timeouts recorded at checkpoints 1, 2 and 3 did not
  reproduce, which settles them as load on this machine rather than anything on this branch.
  Browser: 68/68 across `desktop-density`, `accessibility` and `core-flow`, chromium, both locales.
- **Red-then-green on both new browser cases.** Without `items-start` the three bottom-row dashboard
  panels measured one shared height for three different amounts of content. And the header-band case,
  which is green by design, was made to fail on purpose: deleting the band's right-hand group leaves
  983.3px of empty band in `en` and 1004.9px in `pl` — issue #18's "empty ~1000px header strip",
  reproduced to the pixel.
- **Decision, wider than the spec's literal step:** `WidgetFrame`'s `height` prop was carried along.
  Its `'fill'` branch worked by adding no class and relying on the grid's ambient stretch, so putting
  `items-start` on the grid alone would have turned a documented prop into a silent no-op. `'fill'`
  now renders `self-stretch` and `'content'` is the default; `Net worth` drops the `height="content"`
  it needed when stretching was the default.
- **Decision:** the header-band case asserts behaviour that already passes, on purpose. Its value is
  that the Non-goals claim — "the passbook work already closed #18's header finding" — becomes
  something a test says rather than something a document asserts.
- **Follow-up filed:** the Net worth mid-card void is **issue #161** (spec Q10). Vertical density
  inside a hand-rolled chart (ADR 0007); shares neither this spec's decision rule nor its token.
- **Problem, resolved:** the `pnpm test` caveat carried since checkpoint 1 is closed by this run's
  clean full suite.

## 2026-09-09T23:40:00Z — checkpoint 5: Phase 6 closed, and with it the plan

- **Steps 6.1 … 6.3 landed** — `8a04d8b` (`accounts.filter.count` in both catalogues, all four
  Polish CLDR categories), `278c444` (the `/accounts` filter band carries the count at its end),
  `0198f19` (the `/transactions` toolbar gains a browser case and no edit). Every Tasks row is now
  `done`.
- **Checkpoint 5 verification:** `agent-kit-check` (32 files, kit 16), `generate-routes` with no
  drift, `typecheck`, `lint` (0 errors, 2 pre-existing warnings), `build` (1.96s), `prettier` on
  every touched file — all green. 197/197 on the i18n + styles unit files. Browser: **77/77**
  across `desktop-density` (38), `accessibility`, `core-flow` and `narrow-viewport`, chromium,
  both locales.
- **Red-then-green on all four new browser cases.** Forcing the counterweight's render condition to
  `false` fails all four `/accounts` cases with `element(s) not found` while the two older subtitle
  cases on the same route stay green. The toolbar case, which ships without a change behind it, was
  made to fail on purpose: `md:w-[640px] md:flex-none` on the search field fails it in both locales
  with `Expected: < 578 / Received: 640`.
- **Decision, and the largest one of the run: Step 6.3 ships its assertion and not its edit.** The
  step asked for a bounded width on the `/transactions` search field from `md` up. Measured first,
  the field is already 274.3px (`en`) / 282.1px (`pl`) inside a 1156px bar at 1440×900 and the next
  control sits at the bar's own 8px gutter; the toolbar has since grown a date filter, a sort select
  and a sort button and runs edge to edge. `md:max-w-md` is 448px, so the cap would not bind at any
  viewport and the diff would change no rendered pixel. Issue #18's "wide empty band holding three
  icons at its edge" was measured on 2026-09-03 against a bar that no longer exists — the same call
  the plan already makes about the dashboard header band, in its own words: "A phase that 'fixed' it
  would be a diff with no defect behind it."
- **Decision:** the plan's 360×800 criterion for Step 6.2 changed shape. It asked for the first
  account row to be above the fold; measured, it is not — y≈860 in an 800px viewport — and it was
  not before this Step either, because two overview cards sit above the list in the demo workspace.
  The case therefore bounds what the Step _added_: 89px → 115px, a 26px delta, identical in `en` and
  `pl`, against a 40px budget. The pre-existing fold position is recorded as observed, not acted on.
- **Frames:** twelve PNGs in `.ai/qa/artifacts_issue-18/phase-6/` — `/accounts` narrowed and quiet,
  `/transactions`, at 1440 and 360 in both themes. `en` only, as in every phase: `capture.mjs` has
  no locale flag and the locale is a cookie; the Polish rendering is covered by the `pl` half of
  every browser case.
- **Next:** the final gate — full `validation.commands`, the full integration suite via
  `om-integration-tests`, the design-system/style pass, then the PR body, labels,
  `om-auto-review-pr 156 --autofix`, the summary comment and `mark-pr-ready`.

## 2026-09-10T00:30:00Z — final gate

- **Full `validation.commands` green, in order:** `agent-kit-check` (32 files, kit 16),
  `generate-routes` and `db:generate` with no drift, `typecheck`, `lint` (0 errors, 2 warnings that
  are on `develop`), **`pnpm test` 2465/2465 in 163 files**, `build`.
- **Full integration suite: 456 passed, 71 failed, 24 skipped, 17.0m** — and the 71 took the rest of
  this entry to account for, because a number that size is not a thing to wave through.
- **Blocker investigated and cleared, 1 of 2: the timeouts are contention.** `fullyParallel: true`
  with no local `workers` cap puts three browser projects on one Vite dev server and one D1 file.
  Re-run serially (`--workers=1`): `webkit` over `desktop-density` + `budgets.visual` +
  `budget-detail.visual` → **44 passed, 8 failed**; `mobile-safari` over `desktop-density` → **34
  passed, 4 failed**. Every timeout gone. Every Phase 6 case passes on `webkit` once it is not
  competing for the server — the parallel failures were `Test timeout` and `page.goto: Timeout`,
  never an assertion and never a measurement.
- **Blocker investigated and cleared, 2 of 2: the hydration mismatch is older than this branch.**
  What survives the serial re-run is eight `pl` cases with one cause, which React prints in full:
  `budget-card.tsx:100` renders `1–31 sie 2026` on the server and `01–31.08.2026` in WebKit;
  `dashboard-header.tsx:109` does the same with `Zakres:` in front of it. Both are
  `formatCalendarDateRange(…, 'medium')` and **neither is touched here** — the only change to
  `budget-card.tsx` on this branch is the `<li>` class list and a comment, and
  `dashboard-header.tsx` is not in the diff at all. Proven rather than argued: with `src/` checked
  out from `origin/develop` and nothing else changed, the same command gives the same four failures
  with the same diff. **Filed as #163** (`bug`, `priority-medium`, `risk-low`).
- **Decision: `desktop-density.spec.ts` was left running on the `mobile-safari` project.** The file
  forces a 1440×900 viewport onto `devices['iPhone 15']`, which is a surface that does not exist,
  and the repository has an idiom for excluding it (`test.skip(({ isMobile }) => isMobile, …)`, used
  in eight places). Measured serially, the file does not actually fail there beyond #163's four `pl`
  cases — so there is no defect to fix, only an opinion about where a suite belongs, and
  `AGENTS.md` → Ask First covers narrowing what a test asserts. Recorded in `final-gate-checks.md`
  for a reviewer to decide rather than narrowed unilaterally.
- **Design-system / style pass:** `token-classes.test.ts` green, `DESIGN.md` and the code agree,
  no new component or variant, `prettier --check` clean on every touched file. One thing considered
  and not done, recorded with its reasoning: a `role="status"` live region on the `/accounts` count.

## 2026-09-10T00:55:00Z — checkpoint 6: the review pass, three findings, three fixes

`om-auto-review-pr 156 --autofix` returned **request changes** with three majors. Each was
re-derived from a measurement rather than accepted, and all three held:

- **`/accounts`** — the Step 6.2 counterweight wrapper made `SegmentedFilter` a flex item, so its
  `border-b` ran 438px inside a 1156px band. The rule the first account group sits on
  (`first:border-t-0`) was not there from x≈690 outward. Moved to the wrapper — `ee3ffb4`.
- **`/recurring` outline** — the Step 3.1 reorder left `h1 → h3,h3,h3 → h2`. axe missed it because
  `heading-order` is `best-practice` and `accessibility.spec.ts:52` excludes that tag. Series
  heading promoted to `h2` — `cef03d8`.
- **`Due soon` rail** — the `20rem` track left the table 278px for 290px (`en`) / 298px (`pl`) of
  columns, 406px with the status column, so the rail scrolled sideways at 1440. Track widened to
  `28rem`; the pane split moved `lg` → `xl` because at 1024px a 28rem aside leaves the series list
  268px, which is the defect this spec exists to remove — `d7490fc`.

**Decision recorded:** the `lg` → `xl` move is a deliberate deviation from the spec's "two panes on
one row from `lg`", taken on the spec's own rule (earn the width where there is width to earn) and
disclosed in `panes.ts`, the commit, the checkpoint and the PR body. A reviewer who disagrees has
the numbers to overrule it.

All six new browser cases proven red against the unfixed `src/`. Gate re-run at `d7490fc`: 2465
tests passed, build ok, no drift. Serial browser runs: chromium 94/94 across four spec files,
webkit 52/56 with all four failures `pl`-only and traced to the pre-existing #163. Twelve frames in
`.ai/qa/artifacts_issue-18/review-fix/`, read.

The single failing test in `final-gate-checks.md` §1 is settled as a flake: the same commit re-runs
2465/2465 green, and the only delta from the previous green head is run-folder markdown.

## 2026-09-10T02:20:00Z — checkpoint 7: the re-review caught checkpoint 6's own measurement

`om-auto-review-pr 156 --autofix`, second pass over the diff at `701dd9c`: **request changes**, two
majors and one minor. Both majors were about the fix checkpoint 6 had just shipped.

- **The rail track was derived against a stand-in, not the component.** The e2e stand-in for the
  status column had no `whitespace-nowrap` and carried the English word in both locales, so it
  measured 406px where the real `Badge` reading `Po terminie` needs **419px**. The `28rem` track
  shipped 13px short in `pl`, and the assertion written to catch exactly that stayed green. Track
  re-derived against the real `badgeVariants` string: **`30rem`**, 438px of content in both
  locales. Red proof at `28rem`: `Expected: <= 406 / Received: 419`, `pl` only — `71b61bb`.
- **Moving the split to `xl` left 1024–1279 uncapped.** A stacked pane with nothing holding it takes
  the whole 995px well, which is finding 1 of the issue on the surface the issue names. Fixed with
  `max-w-list xl:max-w-none` on the shared `RECURRING_PANES` constant, so the skeleton follows
  without a second edit. Red proof: `Expected: <= 912 / Received: 995`, both locales — `71b61bb`.
- **Minor:** three stale `lg` references (`recurring/index.tsx:193`, `recurring-skeletons.test.tsx:11`,
  the PR body) and a dead SHA in `PLAN.md` (`359e60e`, the pre-amend hash of `d7490fc`).

**Decisions recorded:** three review suggestions were deferred rather than applied, because each
would delete or narrow an assertion and AGENTS.md → Ask First puts that with a human — the
`WidgetFrame` `height` prop, `desktop-density.spec.ts:754`'s exact-float `toBe`, and the
`/recurring` skeleton's missing filter row (pre-existing). Two pre-existing heading skips found
while fixing the outline were filed as **#166** instead of folded in.

Gate at `71b61bb`: 163 files / 2465 tests passed, build ok, no drift, lint 0 errors. Browser:
chromium **101/101** across five spec files, webkit **52/56** with all four failures `pl`-only,
none on `/recurring`, all tracing to the pre-existing #163. Eight frames in
`.ai/qa/artifacts_issue-18/review-fix-2/`, read at 1440, 1152 and 360.
