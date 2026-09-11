import { defineConfig, devices } from '@playwright/test'

import { BASELINE_DAY } from './e2e/baseline-day'

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
 * `strictPort`, and the rest are for parallel checkouts. Anything
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
 * today, the budget bars divide by days elapsed — so a spec written one evening asserts against a
 * different set of rows the next morning, and every following month boundary moves the whole
 * dashboard. Retiring the baselines did not retire this: a count, a total and an empty state all
 * depend on which day the server thinks it is.
 *
 * `serverToday()` in `src/server/clock.ts` therefore accepts this header on a development
 * request, and both browser projects send it on every request the context makes, so the SSR
 * document and the server-function RPCs that follow it agree about the day. The guard around it
 * is `import.meta.env.DEV`, which the production build folds to `false` and drops, so the header
 * is inert against anything but a dev server.
 *
 * Which is why CI does not rely on it. The browser gates serve a build, where that branch no longer
 * exists, so `vite.config.ts` folds the same constant in at compile time as `__E2E_SERVER_TODAY__`.
 * The header stays for `pnpm dev`, the define covers the build, and both take their day from
 * `e2e/baseline-day.ts` so there is one date in the repository rather than two that agree today.
 */
const SERVER_TODAY_HEADER = 'x-mt-server-today'
const clockPin = { [SERVER_TODAY_HEADER]: BASELINE_DAY }

/**
 * End-to-end and accessibility suite.
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
 * No screenshot is compared anywhere. ADR 0016 retired the baselines: what a screen *looks* like
 * is judged by the blind A/B pair (`scripts/visual/capture.mjs`), by a human, at review. What this
 * suite asserts is that a screen answers, hydrates, says nothing in the console and can be acted
 * on — see `e2e/support/console.ts` for the last of those.
 */
export default defineConfig({
  testDir: './e2e',
  // Narrower than the default `**/*.@(spec|test).*`, which would also collect
  // `e2e/support/__tests__/*.test.ts` - the console policy's vitest neighbours (ADR 0016). Those
  // import no Playwright, so Playwright loading them fails at `describe` with a message about
  // `config` that says nothing about the real cause. `.spec.ts` is what every browser test here
  // is named; the `setup` project overrides this with its own `testMatch`.
  testMatch: /\.spec\.ts$/,
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
  // A wall-clock ceiling on one Playwright process, not a per-test one, and not a tolerance:
  // nothing that fails is accepted, the job is only allowed to take longer to find out. In CI a
  // process is one shard of one project, so the suite as a whole gets this once per leg of
  // ci.yml's e2e matrix, and the cap promises nothing about the total. The history is the reason
  // for the number: ten minutes held until `e2e/visual.spec.ts` landed, that file's 28 frames per
  // project pushed it to twenty-five, and ADR 0016 has now deleted the file. Fifteen rather than
  // back to ten, because ten was measured against a suite this one has grown past. A leg that
  // grows towards it gets another shard in ci.yml, not a bigger number here (#239); the measured
  // leg timings live beside that matrix. It sits inside the `timeout-minutes: 20` that ci.yml puts
  // on the job, so this one still fires first.
  globalTimeout: isCI ? 15 * 60_000 : undefined,
  reporter: [
    ['line'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['html', { open: 'never' }],
  ],

  expect: {
    timeout: 5_000,
  },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    // Deterministic rendering: a fixed locale, zone and theme keep every date and money assertion
    // stable. `en-GB` rather than `en-US` because it is the grouping and date order this suite's
    // English expectations are written in; the Polish locale is exercised by its own tests, which
    // pin `pl-PL` per test. Dark theme and reduced motion are per-test concerns — switch them
    // with `page.emulateMedia()`.
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
