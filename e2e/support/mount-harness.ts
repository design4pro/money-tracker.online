import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { build } from 'vite'

import type { Page } from '@playwright/test'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))

/** What one harness entry bundles to: the script, and the stylesheet it imported, if any. */
export interface HarnessBundle {
  readonly script: string
  readonly css: string
}

/**
 * The harnesses, bundled once per worker and entry.
 *
 * The components under test are React, so they need a bundler to reach a
 * browser, and Vite is the one this repo already builds with — the same
 * resolution, the same `#/` subpath imports, the same JSX transform. Building
 * in-process rather than against the dev server keeps this spec independent of
 * the application: it exercises the component library, and it must not start
 * failing because a route or a session fixture changed.
 *
 * `entry` is a file name beside this module. Each entry is its own bundle, so a
 * second harness is a new file and not a copy of this function.
 *
 * Tailwind is part of the build because an entry may import the product's
 * stylesheet (`#/styles/app.css`): a harness that measures a target size or a
 * contrast ratio has to run on the real tokens and utilities, or it measures
 * unstyled markup. An entry that imports no CSS pays nothing for it.
 */
const bundles = new Map<string, Promise<HarnessBundle>>()

export function bundleHarness(entry: string): Promise<HarnessBundle> {
  let bundled = bundles.get(entry)
  if (bundled) return bundled

  bundled = build({
    root: projectRoot,
    configFile: false,
    logLevel: 'warn',
    plugins: [tailwindcss()],
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
        entry: fileURLToPath(new URL(`./${entry}`, import.meta.url)),
        formats: ['iife'],
        name: 'Harness',
        fileName: 'harness',
      },
    },
  }).then((result) => {
    const outputs = Array.isArray(result) ? result : [result]
    let script: string | undefined
    let css = ''
    for (const output of outputs) {
      if (!('output' in output)) continue
      for (const chunk of output.output) {
        if (chunk.type === 'chunk' && chunk.isEntry) script = chunk.code
        if (chunk.type === 'asset' && chunk.fileName.endsWith('.css')) {
          css += String(chunk.source)
        }
      }
    }
    if (script === undefined) {
      throw new Error(`${entry}: vite produced no entry chunk`)
    }
    return { script, css }
  })

  bundles.set(entry, bundled)
  return bundled
}

export interface MountHarnessOptions {
  /** The document language, for the rules axe runs on `<html>`. */
  readonly lang?: string
  readonly title?: string
  /**
   * Handed to the entry as `window.__HARNESS__` before it runs. This is how a spec tells a
   * harness which locale or scenario to render, since a page built with `setContent` has no URL.
   */
  readonly globals?: Readonly<Record<string, unknown>>
  /**
   * Runs in the blank page before the entry does. For what a component reads once while it
   * renders, such as an API the browser lacks on a page with no origin, and so cannot be added
   * after the mount.
   */
  readonly before?: (page: Page) => Promise<void>
}

/**
 * Render a harness entry into a blank page and wait for it to say it is ready.
 *
 * The entry sets `data-harness-ready="true"` on `<body>` once what it renders is on the page.
 */
export async function mountHarness(
  page: Page,
  entry: string,
  {
    lang = 'en',
    title = 'Harness',
    globals = {},
    before,
  }: MountHarnessOptions = {},
): Promise<void> {
  const { script, css } = await bundleHarness(entry)

  await page.setContent(
    `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
      '<div id="root"></div></html>',
  )
  if (css !== '') await page.addStyleTag({ content: css })
  await page.evaluate((values) => {
    Object.assign(window, { __HARNESS__: values })
  }, globals)
  await before?.(page)
  await page.addScriptTag({ content: script })
  await page.waitForSelector('body[data-harness-ready="true"]')
}

/** The overlay harness: menu, select and modal, for the focus-restoration spec. */
export function mountFocusHarness(page: Page): Promise<void> {
  return mountHarness(page, 'focus-harness.tsx', { title: 'Focus harness' })
}
