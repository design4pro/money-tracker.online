import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'
import viteReact from '@vitejs/plugin-react'

const src = fileURLToPath(new URL('./src/', import.meta.url))

/**
 * The per-case budget for the three projects that pay a fixed startup cost per file.
 *
 * Vitest's default is 5000 ms, and it is a budget for the *case*: whatever the runner does lazily
 * on the way to the first assertion is charged to whichever case triggers it. That is fine for a
 * pure function and wrong for every project below, each for its own reason:
 *
 * - `ui` builds a jsdom environment and transforms React Aria's module graph per file — together
 *   the two largest lines in vitest's own run summary. Under the whole 161-file suite on a
 *   16-core machine the slowest case reached 4667 ms, 93% of the default; run on its own that
 *   same file's four cases take 233-563 ms each. So roughly four of those seconds are the file
 *   starting up, charged to the first case, and not the component being exercised.
 * - `tooling` runs the repository's shell hooks the only way that proves anything: `bash()` is
 *   `spawnSync('bash', …)`, a real process fork per call, so a case that walks a table of
 *   commands is bound by how fast the OS schedules processes. Slowest measured: 2860 ms.
 * - `server` is the same shape from a third direction: its slowest case (2901 ms) compiles the
 *   whole Tailwind stylesheet inside the case body, and its database tests replay every file in
 *   `drizzle/` into a fresh in-memory SQLite per `beforeEach`.
 *
 * What the three share is that the expensive part is fixed per *file* and lands on whichever case
 * runs first, so the peak tracks the machine — how cold Vite's transform cache is, how many
 * workers are competing — rather than anything in the diff under test. It is not a simple load
 * multiplier either: the 4667 ms above was measured on an idle machine with a cold cache, while
 * the same suite run under twelve extra CPU burners peaked at 2712 ms with a warm one. That is
 * why the default turned `pnpm test` red locally and never on CI, whose runners are unloaded
 * (#88).
 *
 * 15000 ms is roughly three times the earlier worst case measured for UI and server tests. The
 * tooling project needs 30000 ms on the shared host: two different shell-hook cases took 19334 ms
 * and 15707 ms under contention, then passed alone in 10350 ms and 12630 ms. The higher budget
 * is limited to tooling; `workerd` keeps the default because nothing there has come near it.
 */
const SLOW_STARTUP_TEST_TIMEOUT_MS = 15_000

/**
 * Four projects, because the code under test needs different worlds:
 *
 * - `ui` runs component tests in jsdom with the React plugin.
 * - `server` runs repositories, queue handlers, the money and FX arithmetic, and route handlers
 *   in plain Node. Nothing there may import `cloudflare:workers`; bindings arrive as arguments,
 *   which is what makes them fake-able.
 * - `tooling` runs the repository's own scripts in plain Node as well, over `scripts/**`
 *   rather than `src/**`.
 * - `workerd` runs the handful of things a fake cannot reproduce inside the real runtime, on the
 *   real bindings from `wrangler.jsonc` (ADR 0015). Its files are named `*.workerd.test.ts` and
 *   `server` excludes them, so the suffix is what says which world a file expects.
 *
 * `server` collects `.tsx` as well as `.ts` because the transactional email templates under
 * `src/server/email` are React components: they render to a string on the server and never reach
 * a DOM, so they belong in the Node project rather than in jsdom. Vite's esbuild transform picks
 * up `jsx: react-jsx` from `tsconfig.json`, which is all a server-rendered component needs — the
 * React plugin exists for Fast Refresh, which no test has.
 *
 * `tooling` exists because its failure mode is silence: a seed or capture script that quietly
 * produces the wrong thing says nothing either way. The scripts themselves are plain `.mjs` that
 * `tsc` only sees through their `.d.mts` neighbours, so tests are the real gate over them.
 */
/**
 * The `workerd` project: the exception to "bindings arrive as arguments".
 *
 * `server` fakes its bindings on purpose, and that is right for almost everything - a repository
 * that takes a `Database` is testable in milliseconds and says what it means. Two things are not
 * reproducible that way, and both are the kind that fail in production and nowhere else: a Durable
 * Object's storage and its single-threaded turn semantics, and D1 accepting the SQL Drizzle
 * generated. This project runs those inside workerd, on the bindings `wrangler.jsonc` declares,
 * with the migrations in `drizzle/` applied to a real (in-memory) D1. Everything else stays where
 * it is - including the queue consumer, which has no handler to assert against yet.
 *
 * `main` is a test-only entry rather than `src/server/worker.ts`: the pool needs a module that
 * exports the Durable Object class so the `LEDGER` binding resolves, and the real entry pulls the
 * whole TanStack Start application in behind it for no gain here.
 */
const migrations = await readD1Migrations(
  fileURLToPath(new URL('./drizzle', import.meta.url)),
)

const workerdProject = {
  resolve: {
    alias: [{ find: /^#\/(.*)$/, replacement: `${src}$1` }],
  },
  plugins: [
    cloudflareTest({
      main: './src/server/worker.workerd-entry.ts',
      miniflare: {
        compatibilityDate: '2026-08-15',
        compatibilityFlags: ['nodejs_compat'],
        // Read in Node, applied inside workerd by `vitest.setup.workerd.ts`.
        bindings: { TEST_MIGRATIONS: migrations },
      },
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  /**
   * Not covered, and it cannot be: `@vitest/coverage-v8` constructs a
   * `node:inspector` Session at import time, and inside workerd that constructor throws
   * `ERR_METHOD_NOT_IMPLEMENTED`, which fails the entire run rather than this project
   * alone. The pool refuses the v8 provider for exactly this reason and points at
   * Istanbul, which instruments source instead of asking the runtime; adopting it would
   * mean a new dependency, and the stack is frozen (`docs/SPEC.md` §3.1).
   *
   * So `pnpm test:coverage` runs `--project='!workerd'` and `pnpm test:workerd` runs this
   * one uninstrumented. `pnpm test` still runs all four, and CI runs both scripts. What is
   * lost is the coverage *number* for `src/server/do/**`; no threshold reads those files.
   */
  test: {
    name: 'workerd',
    globals: false,
    setupFiles: ['./vitest.setup.workerd.ts'],
    include: ['src/server/**/*.workerd.test.ts'],
  },
}

export default defineConfig({
  resolve: {
    alias: [{ find: /^#\/(.*)$/, replacement: `${src}$1` }],
  },
  test: {
    // Leave one CPU for the coordinator and cap process pressure: the 4-vCPU VPS runs several
    // agent gates side by side, and an uncapped run per gate pushed it into swap.
    // Node 24 reads the container CPU quota through availableParallelism().
    maxWorkers: Math.max(1, Math.min(2, availableParallelism() - 1)),
    projects: [
      {
        extends: true,
        plugins: [viteReact()],
        test: {
          name: 'ui',
          environment: 'jsdom',
          globals: false,
          /**
           * Node's own Web Storage, off, so jsdom's survives.
           *
           * From Node 26 `localStorage` and `sessionStorage` are globals by default, and without
           * `--localstorage-file` both read as `undefined`. Vitest's `populateGlobal` skips any
           * key already present on the global unless it is in its own hard-coded window-key
           * list, which these two are not — so jsdom's real `Storage` objects are never copied
           * and every `window.localStorage.clear()` throws. CI runs Node 24, where the API is
           * flag-gated and off, so this would be red on a developer machine only.
           */
          execArgv: ['--no-experimental-webstorage'],
          setupFiles: ['./vitest.setup.dom.ts'],
          testTimeout: SLOW_STARTUP_TEST_TIMEOUT_MS,
          include: [
            'src/components/**/*.test.{ts,tsx}',
            'src/lib/**/*.test.{ts,tsx}',
          ],
          restoreMocks: true,
        },
      },
      {
        extends: true,
        test: {
          name: 'tooling',
          environment: 'node',
          globals: false,
          // `e2e/support` is here rather than under a browser project because the modules it
          // matches import no Playwright: the console policy (ADR 0016) is a pure classifier,
          // and the tolerance table is the one place in this repository where a single array
          // entry turns a red run green, so it is asserted in the fast loop rather than only
          // in the browser gate.
          include: [
            'scripts/**/__tests__/*.test.{ts,mjs}',
            // `.ai/scripts` is the second home for a pipeline script. Its test companions
            // run in this project for the same reason `scripts/ci/__tests__` do: they are
            // policy that lives outside `src/**` and nothing else gates them.
            '.ai/scripts/**/__tests__/*.test.mjs',
            'e2e/support/__tests__/*.test.ts',
          ],
          testTimeout: 30_000,
          restoreMocks: true,
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          globals: false,
          setupFiles: ['./vitest.setup.node.ts'],
          include: [
            'src/server/**/*.test.{ts,tsx}',
            'src/routes/**/*.test.ts',
            'src/styles/**/*.test.ts',
          ],
          // The workerd project owns these; run in Node they would fail on `cloudflare:test`.
          exclude: ['src/server/**/*.workerd.test.ts'],
          testTimeout: SLOW_STARTUP_TEST_TIMEOUT_MS,
          restoreMocks: true,
        },
      },
      workerdProject,
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Generated by `tsr generate`.
        'src/routeTree.gen.ts',
        // Declarative schema and token surfaces: no branches to cover.
        'src/server/db/schema.ts',
        'src/server/db/auth-schema.ts',
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'src/**/*.test.{ts,tsx}',
        // The workerd entry exists only to give the pool a module to load.
        'src/server/worker.workerd-entry.ts',
      ],
      /**
       * Thresholds are per-glob rather than global: they hold the modules carrying arithmetic
       * and protocol logic to a real bar without turning every new UI file into a coverage
       * failure. The money path is first on that list — a rounding bug there is silent, is
       * wrong by a currency-dependent amount, and is discovered by a user reconciling a
       * statement rather than by a stack trace.
       *
       * `VITEST_SHARDED` drops them, and CI sets it on each shard of the unit job. A shard runs
       * a third of the files, so the coverage it measures for any one glob is a third of the
       * truth and the threshold fails on work another shard did. They are applied once, in
       * `test-report`, over the merged picture. A local `pnpm test:coverage` shards nothing and
       * keeps them.
       */
      thresholds:
        process.env.VITEST_SHARDED === '1'
          ? undefined
          : {
              'src/lib/money/**': {
                statements: 95,
                branches: 95,
                functions: 95,
                lines: 95,
              },
              'src/server/ledger/**': {
                statements: 90,
                branches: 85,
                functions: 90,
                lines: 90,
              },
              'src/server/import/**': {
                statements: 85,
                branches: 85,
                functions: 85,
                lines: 85,
              },
            },
    },
  },
})
