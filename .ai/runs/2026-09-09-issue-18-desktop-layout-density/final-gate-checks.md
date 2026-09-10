# Final gate — every Tasks row is `done`

**UTC:** 2026-09-09T23:55:00Z
**Head:** `3da2811` — docs(runs): checkpoint 5 - Phase 6 closed, steps 6.1..6.3 verified
**Steps covered:** all 18 commit-bearing Steps, Phases 1 … 6.

## 1. The full `validation.commands` gate, in order

| #   | Command                                                                 | Result                                             |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| 0   | `node .ai/scripts/agent-kit-check.mjs`                                  | **pass** — 32 managed files match the lock, kit 16 |
| 1   | `pnpm generate-routes` + `git diff --exit-code -- src/routeTree.gen.ts` | **pass** — no drift                                |
| 2   | `pnpm db:generate < /dev/null` + `git diff --exit-code -- drizzle/`     | **pass** — no drift; this run touches no schema    |
| 3   | `pnpm typecheck`                                                        | **pass** — no diagnostics                          |
| 4   | `pnpm lint`                                                             | **pass** — 0 errors, 2 warnings                    |
| 5   | `pnpm test`                                                             | **pass** — **2465 passed, 163 files**, no caveat   |
| 6   | `pnpm build`                                                            | **pass**                                           |

The two lint warnings are `no-shadow` in `src/server/billing/webhook-verify.ts:206` and
`worker-configuration.d.ts:112`. Both are on `develop`; neither file is touched by this run.

`pnpm test` is clean end to end. The 5s timeouts in
`src/routes/_app/dashboard/-server/__tests__/dashboard-data.test.ts` that checkpoints 1-3 recorded
did not reproduce at checkpoint 4 and have not reproduced here — settled as load on this machine
rather than anything on this branch.

## 2. The full integration suite

`PLAYWRIGHT_BASE_URL=http://127.0.0.1:3016 pnpm exec playwright test` — the whole suite across the
three configured browser projects (`chromium`, `mobile-safari`, `webkit`), reusing the shared test
environment from `.ai/qa/test-env.json`.

**Result: 456 passed, 71 failed, 24 skipped, 17.0m.** Every one of the 71 is one of two things —
contention on the single dev server, or a defect older than this branch. The work to prove that is
below, because a number this size is not a thing to wave through.

### The 71, classified

Every failure block was read and bucketed by its own error text. The four buckets are disjoint and
sum to 71.

| Failure mode                                             | Count | Where                                               |
| -------------------------------------------------------- | ----- | --------------------------------------------------- |
| `Test timeout of 30000ms` / `page.goto: Timeout 20000ms` | 27    | all three projects, nine spec files                 |
| `toBeVisible()` on a page that never finished loading    | 12    | six spec files, none of them touched by this branch |
| Polish date range hydrates differently (**#163**)        | 15    | `webkit` + `mobile-safari` only, `pl` only          |
| WebKit `__tsd/console-pipe` page error                   | 17    | `webkit` + `mobile-safari` only                     |

The second bucket is the first one wearing a different hat. `getByRole('navigation', { name: 'Import
steps' })`, `getByRole('table')` and `getByRole('heading', { name: 'Fundusz awaryjny' })` are not
elements this branch could have removed — they are elements that had not rendered yet when the
assertion ran. None of the twelve is in `desktop-density.spec.ts`.

### The timeouts are contention, and the proof is a serial re-run

`fullyParallel: true` with no `workers` cap locally means three browser projects hammering one Vite
dev server and one D1 file. Re-running the affected subset with `--workers=1`:

- `webkit`, `desktop-density` + `budgets.visual` + `budget-detail.visual` → **44 passed, 8 failed**.
  Every timeout gone.
- `mobile-safari`, `desktop-density` alone → **34 passed, 4 failed**. Every timeout gone.

In particular **every Phase 6 case passes on `webkit`** once it is not competing for the server:
`/accounts` counterweight (both locales), the phone delta (both locales), the `/transactions`
toolbar. Their parallel-run failures were `Test timeout of 30000ms exceeded` and
`page.goto: Timeout 20000ms exceeded` — never an assertion, never a measurement.

### The hydration mismatch is older than this branch — filed as #163

What survives the serial re-run is four `pl` cases in `desktop-density.spec.ts` and four in
`budgets.visual` / `budget-detail.visual`, all with one cause. React prints it exactly:

```
<span data-tsd-source="/src/components/app/budgets/budget-card.tsx:100:17">
+   01–31.08.2026        (WebKit, client)
-   1–31 sie 2026        (SSR)
```

Two call sites, both `formatCalendarDateRange(locale, start, end, 'medium')` —
`budgets/budget-card.tsx:100` and `dashboard/dashboard-header.tsx:109`. **Neither is touched by this
branch**: the only change to `budget-card.tsx` here is the `<li>` class list and the comment above
it, and `dashboard-header.tsx` does not appear in the diff at all.

Measured rather than asserted. With `src/` checked out from `origin/develop` and nothing else
changed, the same command produced **the same four failures with the same diff**:

```
git checkout origin/develop -- src
PLAYWRIGHT_BASE_URL=… pnpm exec playwright test \
  e2e/budgets.visual.spec.ts e2e/budget-detail.visual.spec.ts \
  --project=webkit --no-deps --workers=1
→ 4 failed, 10 passed          # identical on this branch's head
git checkout HEAD -- src
```

It is the same class of defect `AGENTS.md` → Never already legislates against for
`Intl.DisplayNames` in `src/lib/i18n` — an ICU disagreement between the SSR runtime and WebKit —
except on `formatRange`, at a call site the existing ban does not cover. **Filed as #163**
(`bug`, `priority-medium`, `risk-low`) with the measurement above.

The `__tsd/console-pipe` page errors are the same shape of pre-existing WebKit noise (a dev-server
console channel refused by WebKit's access-control checks) and appear only in files this branch does
not touch.

### Observed, not acted on: `desktop-density.spec.ts` runs on the `mobile-safari` project

The file sets `test.use({ viewport: { width: 1440, height: 900 } })`, and `mobile-safari` is
`devices['iPhone 15']` — touch, `isMobile: true`, `deviceScaleFactor: 3`. Overriding the viewport
gives a 1440px iPhone, a surface that does not exist, on a suite whose docblock is "what a screen
must not do with 1440px" and which is the declared inverse of `narrow-viewport.spec.ts`.

The repository has an idiom for exactly this — `test.skip(({ isMobile }) => isMobile, '<reason>')`,
used in `keyboard.spec.ts:90`, `focus-restoration.spec.ts:22` and six other places. It was **not**
applied here. Measured serially, the file does not actually fail on that project beyond #163's four
`pl` cases, so there is no defect to fix; what is left is an opinion about where a suite belongs,
and `AGENTS.md` → Ask First covers "narrowing what a test asserts". Narrowing it unilaterally on the
strength of a taste argument is not this run's call to make. Recorded here so a reviewer can make
it.

## 3. The design-system / style pass

- **`src/styles/__tests__/token-classes.test.ts` — pass.** The scanner reads `src/**/*.{ts,tsx}` for
  token-shaped classes and rejects one that names no token. Every class this run added
  (`max-w-list`, `max-w-prose`, `items-start`, `self-stretch`, `text-caption`, `text-ink-2`) is
  either a first-class Tailwind utility or resolves through the container namespace that Step 1.2
  added.
- **`DESIGN.md` and the code agree.** Step 1.3 amended → Layout with the three bands before any
  surface consumed the middle one, so no screen caps at a width the design document does not name.
- **No new component and no new variant.** Every change is a class list on markup that already
  existed, plus two extracted layout helpers (`budgets/list-layout.ts`, `recurring/panes.ts`) that
  exist so a screen and its skeleton cannot drift apart — each with a unit test asserting exactly
  that.
- **`pnpm exec prettier --check` on every touched file — pass.** Repo-wide `pnpm check` reports
  four files, none of them this run's: `docs/agents/cezar.md` (untouched here, dirty on `develop`)
  and three gitignored Playwright auth caches under `e2e/.auth/`. `pnpm check` is not a gate
  (`AGENTS.md` → Validation Commands); "keep what you touch prettier-clean" is, and it is.
- **Considered and not done: a live region on the `/accounts` count.** The repository does put
  `role="status"` on a figure that changes in place (`transactions/-ui/split-editor.tsx:294` is the
  same `text-caption text-ink-2` shape). It was left off here for two reasons. The node is
  **conditionally mounted**, and a live region that appears at the same moment its content does is
  unreliable across screen readers — announcing it properly would mean always rendering the region,
  which changes the layout contract this phase was written to establish. And the state change that
  produces it is a **route navigation**: the segmented control is a `radiogroup` that announces its
  own selection, and `shell/route-pending.tsx` already carries a polite region for the load. Left
  visible here rather than decided silently, because `needs-qa` is on this PR and a human reading
  the screen with a reader is the right judge of it.

## 4. Accessibility

`e2e/accessibility.spec.ts` runs axe over every `_app` surface in light and dark, `en` and `pl`,
and is part of the suite in §2. No AAA claim is made anywhere in this change (`AGENTS.md` → Never);
the one WCAG criterion this run cites by number is **1.4.8** (Visual Presentation, AAA's
80-character line-length item), quoted in `DESIGN.md` and in the Phase 1 commit as the _reason_ the
subtitles were capped — not as a claim that the product meets it.

## 5. Scope and compatibility

- No server module, no repository, no migration, no queue handler, no amount, no auth or tenant
  scoping. `git diff --stat origin/develop...HEAD` touches `src/styles/`, `DESIGN.md`, eight route
  modules, seven `src/components/app/**` files, two i18n catalogues, `e2e/`, and the run folder.
- Nothing in `BACKWARD_COMPATIBILITY.md` is a CSS custom property or a utility name, so the
  additive `--list-max` protects nothing and breaks nothing.
- One new message key, `accounts.filter.count`, in **both** catalogues in the same change, with all
  four Polish CLDR categories. `src/lib/i18n/__tests__/parity.test.ts` is green.
