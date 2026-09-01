import { defineConfig } from 'vite'
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

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  build: { sourcemap: uploadsSourceMaps ? 'hidden' : false },

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
     * `.claude/worktrees/` and `.sandcastle/worktrees/` hold full git worktrees — each a copy of
     * this checkout, `node_modules` and Playwright reports included. Chokidar walks all of it,
     * and every file another checkout's test run writes comes back to us as a page reload; the
     * dev server then churns until it dies. None of it is application source, so none of it
     * should reach the watcher.
     */
    watch: {
      ignored: [
        '**/.claude/**',
        '**/.sandcastle/**',
        '**/playwright-report/**',
        '**/test-results/**',
      ],
    },
  },

  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
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
