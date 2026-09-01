import { fileURLToPath } from 'node:url'
import { build } from 'vite'

import type { Page } from '@playwright/test'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const entry = fileURLToPath(new URL('./focus-harness.tsx', import.meta.url))

/**
 * The harness, bundled once per worker.
 *
 * The components under test are React, so they need a bundler to reach a
 * browser, and Vite is the one this repo already builds with — the same
 * resolution, the same `#/` subpath imports, the same JSX transform. Building
 * in-process rather than against the dev server keeps this spec independent of
 * the application: it exercises the component library, and it must not start
 * failing because a route or a session fixture changed.
 */
let bundled: Promise<string> | undefined

export function bundleFocusHarness(): Promise<string> {
  bundled ??= build({
    root: projectRoot,
    configFile: false,
    logLevel: 'warn',
    // React and React Aria both branch on `process.env.NODE_ENV`, which does
    // not exist in a browser. Vite substitutes it for an application build; a
    // bare `lib` build leaves it in, so the bundle throws on its first line.
    define: { 'process.env.NODE_ENV': '"development"' },
    resolve: {
      alias: [{ find: /^#\/(.*)$/, replacement: `${projectRoot}src/$1` }],
    },
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: {
        entry,
        formats: ['iife'],
        name: 'FocusHarness',
        fileName: 'focus-harness',
      },
    },
  }).then((result) => {
    const outputs = Array.isArray(result) ? result : [result]
    for (const output of outputs) {
      if (!('output' in output)) continue
      for (const chunk of output.output) {
        if (chunk.type === 'chunk' && chunk.isEntry) return chunk.code
      }
    }
    throw new Error('focus harness: vite produced no entry chunk')
  })

  return bundled
}

/** Render the harness into a blank page and wait for it to mount. */
export async function mountFocusHarness(page: Page): Promise<void> {
  const script = await bundleFocusHarness()

  await page.setContent(
    '<!doctype html><meta charset="utf-8"><title>Focus harness</title><div id="root"></div>',
  )
  await page.addScriptTag({ content: script })
  await page.waitForSelector('body[data-harness-ready="true"]')
}
