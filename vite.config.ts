import { defineConfig } from 'vite'

import { BASELINE_DAY } from './e2e/baseline-day'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { sentryVitePlugin } from '@sentry/vite-plugin'

/**
 * Source maps exist only for the build that is going to upload them.
 *
 * Sentry needs real maps to turn a bundled frame into a `src/` file and line, and without that
 * the error reports are worth very little. But a map that ships is the application's source
 * published to anyone who asks, so this build generates them only when it also has somewhere to
 * send them, emits them as `'hidden'` (no `sourceMappingURL` comment, so no browser ever requests
 * one), and has the plugin delete the client half again once the upload succeeds. A local
 * `pnpm build` has no token, generates nothing, and therefore cannot leak anything through
 * `pnpm deploy`.
 *
 * Sentry resolves a frame through the debug id it injects into the bundle, not through the
 * comment, so `'hidden'` costs it nothing.
 */
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
const uploadsSourceMaps =
  sentryAuthToken !== undefined && sentryAuthToken !== ''

/**
 * The day an end-to-end build believes it is, folded in at compile time.
 *
 * `src/server/clock.ts` lets a *development* request pin the day with a header, and guards it with
 * `import.meta.env.DEV` on purpose: a header that could move the server's idea of today in
 * production is a header that can read a budget period which has not opened yet. A production build
 * folds that guard to `false` and drops the branch, and that is the property to preserve.
 *
 * So the browser gates, which serve a build rather than the dev server, get their day the only way
 * that keeps the property intact - baked in, not accepted at runtime. With `E2E_BUILD` unset this
 * emits the literal `undefined`, the comparison in `clock.ts` becomes `undefined !== undefined`, and
 * the whole branch is eliminated exactly as the header branch is. There is no header to send, no
 * variable to set and nothing to reach in a deployed worker: the day is only in a bundle that is
 * only ever built by CI's own e2e step.
 *
 * The cost is stated rather than hidden: the artefact the gate photographs differs from the one that
 * deploys by this one folded constant. That is a far smaller divergence than the dev server it
 * replaces, and it is the smallest one that lets a screenshot be stable at all.
 */
const e2eServerToday =
  process.env.E2E_BUILD === '1' ? JSON.stringify(BASELINE_DAY) : 'undefined'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    sourcemap: uploadsSourceMaps ? 'hidden' : false,
    rolldownOptions: {
      treeshake: {
        /**
         * The design system has no module-level side effects, and the bundler has to be told.
         *
         * `src/components/ui/index.ts` re-exports every primitive, and 130-odd modules import
         * from it. Rolldown drops a re-export edge nobody uses only when it can prove the
         * target module pure; a wrapper whose top level calls `cva()` or `cn()`, or that
         * imports a package without a `sideEffects` declaration, cannot be proved pure, so
         * every one of those edges stays live for every importer. The result was one 614 kB
         * `ui` chunk - calendar, date picker, table, grid list, number field, sonner and
         * their React Aria hooks - loaded by the login page.
         *
         * Declaring the directory side-effect free is the same contract a component library
         * states with `"sideEffects": false`, and it is true here: every module in it only
         * defines components and class strings (the directory's own rules in `index.ts`
         * forbid anything that fetches or registers). With it, each route reaches only the
         * primitives it renders, and the rarely used ones land in chunks of their own.
         */
        moduleSideEffects: [
          { test: /\/src\/components\/ui\//, sideEffects: false },
        ],
      },
    },
  },
  define: { __E2E_SERVER_TODAY__: e2eServerToday },

  /**
   * Port 3010, and it must not drift.
   *
   * `playwright.config.ts` defaults `baseURL` to `http://localhost:3010` and refuses to run
   * against anything outside 3010-3020, because a suite pointed at another checkout's server
   * does not fail — it photographs a different branch's application and calls it evidence.
   * `strictPort` is what makes that guarantee hold: without it Vite silently walks to 3011 when
   * 3010 is taken, and the suite then tests whatever *is* on 3010.
   */
  server: {
    port: 3010,
    strictPort: true,

    /**
     * `.claude/worktrees/` holds full git worktrees — each a copy of this
     * checkout, `node_modules` and Playwright reports included. Chokidar walks all of it,
     * and every file another checkout's test run writes comes back to us as a page reload; the
     * dev server then churns until it dies. None of it is application source, so none of it
     * should reach the watcher.
     */
    watch: {
      ignored: [
        '**/.claude/**',
        '**/playwright-report/**',
        '**/test-results/**',
      ],
    },
  },

  /**
   * `vite preview` serves the built bundle, and CI's browser gates run against it rather than
   * against `vite dev`. A dev server compiles the client module graph per route on first visit,
   * and that cost 69% of the e2e suite's wall clock - so the gate now measures the artefact that
   * actually deploys instead of what a developer's watcher serves.
   *
   * It does not inherit `server.port`: left alone it binds 4173, and the suite would then be
   * pointed at whatever *is* on 3010. The guarantee above has to be restated here to hold for the
   * built bundle as well as for the watcher.
   */
  preview: {
    port: 3010,
    strictPort: true,
  },

  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart({
      router: {
        codeSplittingOptions: {
          /**
           * `pendingComponent` is split off each route along with the other three.
           *
           * The plugin's own default leaves it in the route's reference part, which is the part
           * every route contributes to the entry chunk. Seventeen routes declare a skeleton, and
           * a skeleton imports the surface it stands in for - the shell, the dashboard widgets,
           * the charts - so with the default the entry carried the whole application, React Aria,
           * d3 and sonner included, to the marketing page. A skeleton is only ever shown after
           * `pendingMs`, which is far longer than fetching its chunk takes, and `defaultPreload`
           * is `intent`, so the chunk is usually there before the click lands anyway.
           */
          defaultBehavior: [
            ['component'],
            ['pendingComponent'],
            ['errorComponent'],
            ['notFoundComponent'],
          ],
        },
      },
    }),
    viteReact(),
    // Last on purpose: it reads the bundle the other plugins produced, so it has to run after
    // them. Inert without a token — `disable` short-circuits it before it looks for anything.
    sentryVitePlugin({
      disable: !uploadsSourceMaps,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: sentryAuthToken,
      telemetry: false,
      sourcemaps: {
        // Only the client maps. `dist/client` is served as static assets, so a map left there is
        // the front end's source published to anyone who asks. `dist/server` is not served — it
        // is the Worker bundle — and wrangler's `upload_source_maps` wants those maps so the
        // Cloudflare dashboard can un-minify a stack too. Deleting both would quietly take that
        // away.
        filesToDeleteAfterUpload: ['./dist/client/**/*.map'],
      },
      // The plugin's default is to log an upload failure and let the build succeed. That is the
      // wrong default here: the expected failure is an expired or mis-scoped token, which is
      // permanent, and it would ship a release whose every future stack trace is unreadable
      // while the deploy stays green. Fail instead, loudly. The cost is that a Sentry outage
      // blocks a deploy; the lever is unsetting SENTRY_AUTH_TOKEN for that run.
      errorHandler: (error) => {
        throw error
      },
    }),
  ],
})

export default config
