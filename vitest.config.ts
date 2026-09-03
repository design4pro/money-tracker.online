import { fileURLToPath } from 'node:url'
import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'
import viteReact from '@vitejs/plugin-react'

const src = fileURLToPath(new URL('./src/', import.meta.url))

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
          include: ['scripts/**/__tests__/*.test.{ts,mjs}'],
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
