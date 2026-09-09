# Handoff — 2026-09-09-issue-18-desktop-layout-density

**Last updated:** 2026-09-10T02:25:00Z
**Branch:** `feat/issue-18-desktop-layout-density`
**PR:** https://github.com/design4pro/money-tracker.online/pull/156 (ready for review, claimed)
**Current phase/step:** every Tasks row is `done`, including the four `X.Y-review-fix` Steps from
the two review passes — the run is at its closing sequence
**Last commit:** `71b61bb` — fix(recurring): re-derive the rail track against the real badge, cap
the stacked panes

## What just happened

- **The second review pass found that checkpoint 6's own fix was measured against a stand-in.** The
  e2e stand-in for the `Due soon` status column had no `whitespace-nowrap` and carried the English
  word in both locales, so it measured 406px where the real `Badge` reading `Po terminie` needs
  **419px**. The `28rem` track therefore shipped 13px short in `pl`, and the assertion written to
  catch exactly that stayed green. Re-derived against the real `badgeVariants` string: **`30rem`**,
  438px of content in both locales, 19px of headroom. Red proof at `28rem`:
  `Expected: <= 406 / Received: 419`, `pl` only.
- **The same pass found that moving the split to `xl` left 1024–1279 uncapped** — a stacked pane
  with nothing holding it takes the whole 995px well, which is finding 1 of the issue on the surface
  the issue names. Fixed with `max-w-list xl:max-w-none` on the shared `RECURRING_PANES` constant,
  so `recurring-skeletons.tsx` follows without a second edit. Red proof:
  `Expected: <= 912 / Received: 995`, both locales.
- Both landed as `3.6-review-fix` / `71b61bb`. Three stale `lg` references and a dead SHA in
  `PLAN.md` went with them. Details and every number: `checkpoint-7-checks.md`.
- **Gate at `71b61bb`:** 163 files / 2465 tests passed, build ok, no drift, lint 0 errors (2
  pre-existing warnings). **chromium 101/101** across five spec files; **webkit 52/56**, all four
  failures `pl`-only, none on `/recurring`, all tracing to the pre-existing #163.
- Eight fresh frames in `.ai/qa/artifacts_issue-18/review-fix-2/`, read at 1440, 1152 and 360.
- The spec carries an amendment recording what Phase 3 actually shipped (`30rem`, `xl`, the
  `max-w-list` cap) and Phase 6's assertion-only outcome.

## Next concrete action

The **closing sequence**:

1. Commit and push the run-folder update + spec amendment.
2. Post the `om-code-review` report **verbatim, in English**, as the PR review body via `review-pr`,
   carrying the CI-pending disclosure paragraph.
3. Label transitions on #156, then the comprehensive summary comment.
4. Release the `in-progress` lock, write the closing HANDOFF/NOTIFY entries.
5. `.ai/scripts/test-env-down.sh`.

## Blockers / open questions

- **CI checks are unreadable from here, and the review body must say so.** `gh pr checks 156` and
  both the check-runs and branch-protection APIs return
  `403 Resource not accessible by personal access token`. `mergeStateStatus` read `CLEAN` at
  `16f294d`. Required checks still gate the merge; nothing here relaxes that.

## Environment caveats

- Dev runtime runnable: **yes** — `sh .ai/scripts/test-env-up.sh` serves `http://127.0.0.1:3016`
  (vite dev, local D1, seeded demo workspace). Stop it with `.ai/scripts/test-env-down.sh`.
- Browser / UI checks: enabled. `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3016 pnpm exec playwright
test <file> --project=chromium --no-deps`. **`--no-deps` matters**: the auth setup project is
  rate-limited at five sign-ins per five minutes and reusing the cached storage state avoids a 429.
- `pnpm test -- <files>` does not filter — the `--` passthrough runs the whole suite. Use
  `pnpm exec vitest run <files>` for a targeted run.
- Frames: `.ai/qa/artifacts_issue-18/<phase>/`, outside the repository by `.gitignore:32`. They are
  `en` only, as in every phase: `scripts/visual/capture.mjs` has no locale flag and the locale is a
  cookie, not a query parameter.
- A Playwright run that fails writes `test-results/`; remove it before committing.
- Database/migration state: clean — this run touches no schema and regenerates no `drizzle/`.
- The `pnpm test` flakiness recorded at checkpoints 1-3 did not reproduce at checkpoint 4 (2463/2463
  green, `dashboard-data.test.ts` included). Treat it as machine load, not as a branch defect.

## Worktree

- Path: `/Users/rafalwolak/dev/cloudflare/money-tracker.online/.ai/cezar/worktrees/bbb45f6f-7fb3-4923-ba7e-d450c548032e`
- Created this run: no — reused the Cezar task worktree, branched from `origin/develop`.
