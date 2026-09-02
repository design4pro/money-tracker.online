import { defineConfig, devices } from '@playwright/test'

const isCI = process.env.CI === 'true' || process.env.CI === '1'

/**
 * Point the suite at an already-running server (a `wrangler dev` session, or a deployed
 * preview) instead of starting `pnpm dev`.
 */
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL
const baseURL = externalBaseURL ?? 'http://localhost:3010'

/**
 * Refuse to run against a server this workspace does not own.
 *
 * Ports 3010-3020 are the range this repo works in — 3010 is what `vite.config.ts` binds with
 * `strictPort`, and the sandcastle loop allocates the rest to its parallel worktrees. Anything
 * below is a developer's own process or another checkout's. A misdirected suite is worse than no
 * suite: it does not fail, it photographs a different branch's application and reports it as
 * evidence. So this is a hard stop rather than a warning.
 *
 * Set PLAYWRIGHT_ALLOW_ANY_PORT=1 for a deliberate run against a preview deployment or a
 * hand-started server.
 */
if (!isCI && process.env.PLAYWRIGHT_ALLOW_ANY_PORT !== '1') {
  const port = Number(new URL(baseURL).port || '80')
  if (port < 3010 || port > 3020) {
    throw new Error(
      `playwright: refusing to run against ${baseURL}.\n` +
        `Ports 3010-3020 are reserved for automated rounds; ${port} is not one of them and may ` +
        `belong to another checkout or to the developer.\n` +
        `Start the server with \`pnpm dev\` (which binds 3010 with strictPort) or pass ` +
        `PLAYWRIGHT_BASE_URL=http://localhost:30xx for another round's port.\n` +
        `To target a preview deployment on purpose, set PLAYWRIGHT_ALLOW_ANY_PORT=1.`,
    )
  }
}

/**
 * The clock the Worker reads, pinned for the whole suite.
 *
 * The server picks *which rows* a screen shows by comparing a fixture date against its own
 * `new Date()` — the dashboard reads the current month, the upcoming rail reads forward from
 * today, the budget bars divide by days elapsed — so a baseline recorded one evening photographs
 * a different set of rows the next morning, and every following month boundary moves the whole
 * dashboard. No mask absorbs that: a row leaving a list moves everything below it.
 *
 * `serverToday()` in `src/server/clock.ts` therefore accepts this header on a development
 * request, and both browser projects send it on every request the context makes, so the SSR
 * document and the server-function RPCs that follow it agree about the day. The guard around it
 * is `import.meta.env.DEV`, which the production build folds to `false` and drops, so the header
 * is inert against anything but a dev server.
 */
const SERVER_TODAY_HEADER = 'x-mt-server-today'
const BASELINE_DAY = '2026-08-20'
const clockPin = { [SERVER_TODAY_HEADER]: BASELINE_DAY }

/**
 * End-to-end, accessibility and visual-regression suite.
 *
 * Three browser projects:
 *
 * - `chromium` at 1440x900, the desktop layout, and where the axe-core scans run.
 * - `mobile-safari` on an iPhone 15, because safe-area insets, `100dvh` and momentum scrolling
 *   behave differently there than anywhere else, and transaction entry is the mobile use case.
 * - `webkit` at desktop width, which is not the same surface as mobile WebKit: it is where
 *   desktop Safari's own layout and focus-ring behaviour is checked, and Safari is the browser
 *   most likely to disagree about `:focus-visible` — the criterion the whole keyboard story
 *   rests on.
 *
 * Screenshot baselines are per project, per theme and per locale, and are compared with
 * animations disabled so a mid-transition frame can never fail a run. They are recorded for
 * `chromium` and `mobile-safari` only, because those are the two projects `ci.yml` runs; a
 * `webkit` run skips them rather than failing for want of files. `e2e/visual.spec.ts` owns the
 * frames and `e2e/support/visual.ts` owns that rule.
 */
export default defineConfig({
  testDir: './e2e',
  snapshotDir: './e2e/__screenshots__',
  /**
   * `{platform}` is in the path because a frame is only comparable to one taken on the same OS —
   * and one platform, Linux, is the only one recorded.
   *
   * The reason is stronger than antialiasing. This product loads **no web font at all**:
   * `src/styles/app.css` says so, there is no `@font-face` and no `public/` directory. So
   * `--font-sans` falls past `'Inter'` and `'Inter Fallback'` to `-apple-system` on macOS and to
   * `ui-sans-serif` on Linux, which are different typefaces with different metrics, breaking lines
   * in different places. No tolerance absorbs that and no un-suffixed baseline can serve both.
   *
   * Only `-linux` is recorded, because Linux is what the gate in `ci.yml` runs. A second `-darwin`
   * set would buy a laptop a green run and cost the project a second set of PNGs to refresh in
   * lockstep, by whoever owns a Mac, or the gate starts disagreeing with itself. So the frames are
   * *skipped* off Linux rather than recorded there, and `e2e/support/visual.ts` owns that rule and
   * states it in the skip reason. Keeping `{platform}` in the filename is what makes an accidental
   * `--update-snapshots` on a Mac unable to overwrite the set CI compares against.
   *
   * `-linux` is recorded by `pnpm sandcastle:baselines`, or by the `Update e2e baselines` workflow
   * (`.github/workflows/update-snapshots.yml`), both of which run in the same container image the
   * gate does.
   */
  snapshotPathTemplate:
    '{snapshotDir}/{testFileName}/{arg}-{projectName}-{platform}{ext}',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // Parallel workers share one dev server and one D1 file. The real contention is the auth rate
  // limiter's single per-path bucket, which the session fixture asks for once per worker. One
  // worker per CI shard: parallelism in CI comes from the shards in ci.yml, and two browsers
  // plus Vite SSR on a 2-vCPU runner starves hydration past the action timeout. Locally
  // Playwright's default (half the cores) applies.
  workers: isCI ? 1 : undefined,
  timeout: 30_000,
  // A wall-clock ceiling on the whole run, not a per-test one, and not a tolerance: nothing that
  // fails is accepted, the job is only allowed to take longer to find out. It was ten minutes
  // until `e2e/visual.spec.ts` landed. That file adds 28 frames per project, each of which opens a
  // screen the run has not opened before and waits for a development server to compile it, and it
  // measured 5.1 minutes for `chromium` alone on a quiet 16-core machine - so on the two-core
  // runner the comment above is about, the old ceiling was no longer a safety net but a scheduled
  // failure. Twenty-five sits inside the `timeout-minutes: 30` that ci.yml puts on the job, so the
  // job's own limit stays the outer bound and this one still cuts a hung run short.
  globalTimeout: isCI ? 25 * 60_000 : undefined,
  reporter: [
    ['line'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['html', { open: 'never' }],
  ],

  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      // ~0.2% of a 1440x900 viewport. Baselines are single-platform (see `snapshotPathTemplate`),
      // so this is not absorbing a cross-OS font difference — it is headroom for the last-pixel
      // disagreement a GPU or a subpixel rounding can produce between two runs on the same image,
      // and it is far too tight to hide a shifted card or a wrong colour.
      maxDiffPixelRatio: 0.002,
      threshold: 0.2,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    // Deterministic rendering: a fixed locale, zone and theme keep both the screenshots and any
    // date or money assertion stable. `en-GB` rather than `en-US` because it is the grouping and
    // date order the English baselines were recorded in; the Polish locale is exercised by its
    // own tests, which pin `pl-PL` per test. Dark theme and reduced motion are per-test
    // concerns — switch them with `page.emulateMedia()`.
    locale: 'en-GB',
    timezoneId: 'UTC',
    colorScheme: 'light',
  },

  projects: [
    // Signs the demo account in once and caches the session. Every browser project depends on it
    // because `/sign-in/email` is rate limited to ten attempts a minute, which per-test sign-in
    // blows through.
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        extraHTTPHeaders: clockPin,
      },
    },
    {
      name: 'mobile-safari',
      dependencies: ['setup'],
      // Includes `defaultBrowserType: 'webkit'`, a 393x852 viewport and touch.
      use: { ...devices['iPhone 15'], extraHTTPHeaders: clockPin },
    },
    {
      name: 'webkit',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1440, height: 900 },
        extraHTTPHeaders: clockPin,
      },
    },
  ],

  webServer:
    externalBaseURL === undefined
      ? {
          command: 'pnpm dev',
          url: baseURL,
          // Locally, attach to the dev server that is probably already up; in CI always start a
          // clean one so the run is reproducible.
          reuseExistingServer: !isCI,
          timeout: 120_000,
          stdout: 'ignore',
          stderr: 'pipe',
        }
      : undefined,
})
