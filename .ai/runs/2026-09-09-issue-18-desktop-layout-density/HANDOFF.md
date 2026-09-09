# Handoff — 2026-09-09-issue-18-desktop-layout-density

**Last updated:** 2026-09-09T22:55:00Z
**Branch:** `feat/issue-18-desktop-layout-density`
**PR:** https://github.com/design4pro/money-tracker.online/pull/156 (draft, claimed)
**Current phase/step:** Phase 6 Step 6.1
**Last commit:** `9d3b368` — docs(runs): record the Net worth follow-up as issue #161

## What just happened

- Phase 5 landed in three commits and closed `/dashboard`. `WidgetGrid` carries `items-start`, so a
  panel ends where its content ends instead of being padded out to the tallest panel in its row;
  `WidgetFrame`'s `height` prop was carried along rather than left as a no-op (`'fill'` now renders
  `self-stretch`, `'content'` is the default).
- The header band, which this spec's Non-goals say was already fixed by the passbook work, now has a
  browser case holding it there. Deleting the band's right-hand group reproduces issue #18's "empty
  ~1000px header strip" exactly: 983.3px in `en`, 1004.9px in `pl`.
- The Net worth mid-card void is **issue #161**, recorded in Follow-ups above and due in the PR body.
- Checkpoint 4 passed. `typecheck`, `lint`, `build`, `prettier` green; **`pnpm test` 2463/2463 with
  no caveat** — the dashboard-data timeouts that checkpoints 1-3 recorded did not reproduce, which
  settles them as machine load; 68/68 across `desktop-density`, `accessibility` and `core-flow` on
  chromium in both locales.
- Six frames captured and read, including a 1440 before/after pair showing the bottom row's
  120-150px voids close.

## Next concrete action

Phase 6, the last one — the two toolbars, both **earn** rather than cap:

- **6.1** — `accounts.filter.count` in `src/lib/i18n/messages/en.ts` and `pl.ts` in one commit. EN
  reads `Showing {shown} of {total} accounts`. Polish needs all four CLDR categories
  (`one`/`few`/`many`/`other`); the branch is chosen by `params.count`
  (`src/lib/i18n/interpolate.ts:70`), so the call site passes `count` alongside `shown`/`total`
  pre-formatted with `formatNumber(locale, value)` — `interpolate` stringifies with `String()`.
  Verify with the parity test plus a unit case resolving 1, 2, 5 and 22.
- **6.2** — render that count at the end of the `/accounts` filter band, only when the filter
  narrows. Assert it is above the fold at 360×800 in both locales: this is one of the two phases
  that changes a narrow viewport, and the spec says so rather than hiding behind a blanket promise.
- **6.3** — cap the `/transactions` search field from `md` up
  (`src/components/app/transactions/filter-bar.tsx:344`, `className="min-w-0 flex-1 sm:min-w-56"`).

Then the **final gate**: the full `validation.commands` list in order, the full integration suite via
`om-integration-tests`, the design-system/style pass, the final-gate verification comment on PR #156,
the PR body refresh (`Status: complete`, `## What Changed`, `## 🧪 Tests`, #161 linked), the full
label set with its rationale comment, `om-auto-review-pr 156 --autofix` (release the lock first,
reclaim after), the summary comment, `mark-pr-ready`, and the lock release.

## Blockers / open questions

- none

## Environment caveats

- Dev runtime runnable: **yes** — `sh .ai/scripts/test-env-up.sh` serves `http://127.0.0.1:3016`
  (vite dev, local D1, seeded demo workspace). Stop it with `.ai/scripts/test-env-down.sh`.
- Browser / UI checks: enabled. `pnpm exec playwright test <file> --project=chromium` with
  `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3016`.
- Frames: `.ai/qa/artifacts_issue-18/<phase>/`, outside the repository by `.gitignore:32`.
- Database/migration state: clean — this run touches no schema and regenerates no `drizzle/`.
- The `pnpm test` flakiness recorded at checkpoints 1-3 did not reproduce at checkpoint 4 (2463/2463
  green, `dashboard-data.test.ts` included). Treat it as machine load, not as a branch defect.

## Worktree

- Path: `/Users/rafalwolak/dev/cloudflare/money-tracker.online/.ai/cezar/worktrees/bbb45f6f-7fb3-4923-ba7e-d450c548032e`
- Created this run: no — reused the Cezar task worktree, branched from `origin/develop`.
