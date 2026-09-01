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
 * Screenshot baselines are per project and per theme, and are compared with animations disabled
 * so a mid-transition frame can never fail a run.
 */
export default defineConfig({
  testDir: './e2e',
  snapshotDir: './e2e/__screenshots__',
  /**
   * `{platform}` is in the path because font rasterisation is not portable.
   *
   * The same correct page, rendered by the same browser build, antialiases text differently on
   * macOS and on Linux. At the 0.2% tolerance below that is enough to fail nearly every frame
   * carrying a paragraph — a difference in where the pixels came from, not in what the design
   * says. Recording one set per platform is what lets the gate run both on a laptop and in CI
   * without either being a second-class approximation of the other.
   *
   * `-darwin` is recorded locally; `-linux` by the `Update e2e baselines` workflow, which runs
   * in the same container image the gate does. A design change needs both refreshed.
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
  globalTimeout: isCI ? 10 * 60_000 : undefined,
  reporter: [
    ['line'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['html', { open: 'never' }],
  ],

  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      // ~0.2% of a 1440x900 viewport: absorbs font antialiasing across platforms without hiding
      // a shifted card or a wrong colour.
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
