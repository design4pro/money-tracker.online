import path from 'node:path'
import { mkdir } from 'node:fs/promises'

import { DELIBERATE_SERVER_FAILURE, expect, test } from './support/console'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoWcagViolations } from './support/axe-scan'
import { mountHarness } from './support/mount-harness'
import { failServerFns } from './support/states'

import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'

import type { AppLocale, AppTheme } from './support/app'
import type { ExpectedConsoleMessage } from './support/console'
import type { Locator, Page } from '@playwright/test'

/**
 * The failure surfaces in a browser: the axe gate, the target-size and reflow checks, and the
 * frames `05-S2` phase 3 owes (`.ai/specs/2026-10-10-failure-panel-shapes-and-05-s2-reconciliation.md`).
 *
 * ## Which failures are real
 *
 * - **The 404 is real.** `/does-not-exist` is answered by the router's not-found component.
 * - **One forced failure is real: `unsubscribe.tsx`, not the harness.** No signed-in route can
 *   reach `RouteError`, because every route with a loader has its own `errorComponent`. The public
 *   unsubscribe route has a loader and none, so the router's default boundary answers it. Its loader
 *   returns `INVALID` without a server call unless the search carries a token, so the spec navigates
 *   to `/unsubscribe?t=<any token>` after `failServerFns` is installed. A `page.goto` would run the
 *   loader during the server render, where no browser stub reaches, and no public page links to the
 *   route, so the navigation is made through the history API the router listens to (see
 *   {@link navigateClientSide}).
 * - **The four shapes of `FailurePanel` are harness-only.** `quota` and `feature_locked` have no
 *   producer until `05-S1` Phases 3 and 4 and `22-billing` land, so the harness page
 *   (`support/failure-harness.tsx`) mounts every shape in both placements, and `RouteError`, in the
 *   product's own stylesheet.
 *
 * ## The console
 *
 * The forced failure writes the three messages `DELIBERATE_SERVER_FAILURE` measures and, on the
 * production build CI serves, the error the stub threw (see {@link FORCED_FAILURE_CONSOLE}),
 * declared per test with `expectConsole`; the 404 writes the browser's own report of the document it was asked
 * for. Nothing else is allowed, and the net is not widened.
 *
 * ## Frames
 *
 * Nothing in this repository compares a screenshot (ADR 0016) and a PNG never lands in it. The
 * frames are taken only when `FAILURE_EVIDENCE_DIR` names a directory outside the repository, and
 * the block that takes them is skipped otherwise, so CI never runs it.
 */

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']
const CATALOGUE = { en, pl } as const

type Key = keyof typeof en

/** The catalogue sentence for a key. Every key used here is a plain sentence. */
function text(locale: AppLocale, key: Key): string {
  const value = CATALOGUE[locale][key]
  if (typeof value !== 'string') {
    throw new Error(`${key} is a plural entry, not a sentence`)
  }
  return value
}

/** Chromium reporting the 404 document the test asked for: the outcome under test. */
const DOCUMENT_404: readonly ExpectedConsoleMessage[] = [
  {
    why: 'the browser reporting the 404 status of the document the test requested on purpose',
    match:
      /^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/,
  },
]

/**
 * What the forced failure writes: the shared measurement of a deliberate server failure, plus the
 * error itself. The router's default boundary hands the loader's error to `console.error` in the
 * production build CI serves (`vite preview`); the dev server the measurement was taken on does
 * not write it. Anchored on the text of the stub's own body (`e2e/support/states.ts`), so an
 * error from any other source still fails the run.
 */
const FORCED_FAILURE_CONSOLE: readonly ExpectedConsoleMessage[] = [
  ...DELIBERATE_SERVER_FAILURE,
  {
    why: 'the router’s default error boundary logging the error the intercepted loader threw, in the production build',
    match: /^deliberate failure from e2e\/support\/states\.ts$/,
  },
]

/** A route no page links to, reached with a token the server is never asked about. */
const FORCED_FAILURE_PATH = '/unsubscribe?t=forced-failure-token'

/**
 * Moves the router to `path` without a document load.
 *
 * The router's browser history listens for `popstate` and re-reads `location` and `history.state`
 * when one fires, so pushing an entry and dispatching the event is a client-side navigation that
 * runs the destination's loader in the browser, where the failure stub is.
 */
async function navigateClientSide(page: Page, target: string): Promise<void> {
  await page.evaluate((to) => {
    const index = (window.history.state?.__TSR_index ?? 0) + 1
    const key = Math.random().toString(36).slice(2)
    window.history.pushState(
      { __TSR_index: index, key, __TSR_key: key },
      '',
      to,
    )
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, target)
}

/**
 * Opens a public page, fails every server function, and navigates to the unsubscribe route, so
 * the router's default boundary renders `RouteError`. The stub goes in **after** the app has
 * loaded. The caller releases the returned interception.
 */
async function forceRouteError(page: Page, locale: AppLocale) {
  await gotoApp(page, '/login')
  const failing = await failServerFns(page)
  await navigateClientSide(page, FORCED_FAILURE_PATH)
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: text(locale, 'empty.error.title'),
    }),
  ).toBeVisible()
  return failing
}

/**
 * The page has no origin, so the browser offers it no clipboard and Copy would not render. A copy
 * is recorded rather than performed, which also makes it the same in every engine.
 */
async function recordClipboard(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (value: string) => {
          Object.assign(window, { __copied: value })
          return Promise.resolve()
        },
      },
    })
  })
}

async function openGallery(
  page: Page,
  locale: AppLocale,
  reference = 'evt_7f3a91c2',
): Promise<void> {
  await mountHarness(page, 'failure-harness.tsx', {
    lang: locale,
    globals: { locale, scenario: 'gallery', reference },
    before: recordClipboard,
  })
}

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test.describe(`${theme}, ${locale}`, () => {
      test('the real 404 has no WCAG A/AA violations', async ({
        page,
        context,
        expectConsole,
      }) => {
        expectConsole(DOCUMENT_404)
        await useLocale(context, locale)
        await useTheme(page, theme)

        await gotoApp(page, '/does-not-exist')

        await expect(
          page.getByRole('heading', {
            name: text(locale, 'empty.notFound.title'),
          }),
        ).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('lang', locale)
        await expectNoWcagViolations(page, `the 404 (${theme}, ${locale})`)
      })

      test('a forced failure renders RouteError in one main, under the route’s own title', async ({
        page,
        context,
        expectConsole,
      }) => {
        expectConsole(FORCED_FAILURE_CONSOLE)
        await useLocale(context, locale)
        await useTheme(page, theme)

        const failing = await forceRouteError(page, locale)
        try {
          // Exactly one landmark and one skip-link target on the failed page.
          await expect(page.locator('main')).toHaveCount(1)
          await expect(page.locator('#main-content')).toHaveCount(1)
          await expect(page.getByRole('main')).toContainText(
            text(locale, 'app.shell.error.body'),
          )
          // The tab names the destination, not the page the reader came from.
          await expect(page).toHaveTitle(
            `${text(locale, 'unsubscribe.meta.title')} · ${text(locale, 'app.name')}`,
          )
          // A client navigation took the content the reader asked for, so focus follows it.
          await expect(page.getByRole('heading', { level: 1 })).toBeFocused()

          await expectNoWcagViolations(
            page,
            `the forced failure (${theme}, ${locale})`,
          )
        } finally {
          await failing.release()
        }
      })

      test('every shape of the failure panel, both placements and RouteError, has no WCAG A/AA violations', async ({
        page,
      }) => {
        await useTheme(page, theme)
        await openGallery(page, locale)

        // Eight panels and the page-level failure: nothing was left out of the scan.
        await expect(page.locator('[data-shape]')).toHaveCount(9)
        await expectNoWcagViolations(
          page,
          `the failure harness (${theme}, ${locale})`,
        )
      })
    })
  }
}

test.describe('target size and reflow', () => {
  /**
   * Every match offers a 44 x 44 CSS px target (WCAG 2.5.5, claimed in `docs/ACCESSIBILITY.md` §3.4).
   *
   * That is the **hit area**, not the element's box: the primitives keep a 40 px (`md`) or 32 px
   * (`sm`) visual box and grow the hit area with the `target-min` pseudo-element, which
   * `boundingBox()` cannot see. So the target is measured the way a finger meets it: the corners,
   * the edge midpoints and the centre of the 44 x 44 box around the element must land on the
   * element itself, which also fails if a neighbour overlaps it. The element's own box must still
   * clear the 24 px floor of 2.5.8 (AA).
   */
  async function expectTargetSize(
    locator: Locator,
    label: string,
    locale: AppLocale,
  ) {
    const all = await locator.all()
    expect(
      all.length,
      `${label} (${locale}): nothing rendered to measure`,
    ).toBeGreaterThan(0)
    for (const [index, target] of all.entries()) {
      const measured = await target.evaluate((element) => {
        // 'instant': the stylesheet may smooth-scroll, and a point read mid-scroll is off screen.
        element.scrollIntoView({
          block: 'center',
          inline: 'center',
          behavior: 'instant',
        })
        const rect = element.getBoundingClientRect()
        // Half of 44, less half a pixel so a rounded edge cannot count as a miss.
        const reach = 22 - 0.5
        const misses: string[] = []
        for (const dy of [-reach, 0, reach]) {
          for (const dx of [-reach, 0, reach]) {
            const hit = document.elementFromPoint(
              rect.left + rect.width / 2 + dx,
              rect.top + rect.height / 2 + dy,
            )
            if (!hit || !element.contains(hit)) misses.push(`(${dx}, ${dy})`)
          }
        }
        return { width: rect.width, height: rect.height, misses }
      })
      const name = `${label} #${String(index)} (${locale})`
      expect(
        measured.misses,
        `${name}: points of its 44 x 44 box that land on something else`,
      ).toEqual([])
      expect(measured.width, `${name}: own width`).toBeGreaterThanOrEqual(24)
      expect(measured.height, `${name}: own height`).toBeGreaterThanOrEqual(24)
    }
  }

  for (const locale of LOCALES) {
    test(`Retry, Copy, the billing link and the dashboard link are 44 x 44 px at 360 px - ${locale}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 800 })
      await openGallery(page, locale)
      await expect(
        page.getByRole('button', {
          name: text(locale, 'failure.reference.copy'),
        }),
      ).toHaveCount(3)

      await expectTargetSize(
        page.getByRole('button', { name: text(locale, 'action.retry') }),
        'Retry',
        locale,
      )
      await expectTargetSize(
        page.getByRole('button', {
          name: text(locale, 'failure.reference.copy'),
        }),
        'Copy',
        locale,
      )
      await expectTargetSize(
        page.getByRole('link', { name: text(locale, 'billing.title') }),
        'the billing link',
        locale,
      )
      await expectTargetSize(
        page.getByRole('link', {
          name: text(locale, 'failure.dashboard.action'),
        }),
        'the dashboard link',
        locale,
      )
    })
  }

  test('the longest Polish strings and a 64-character reference do not scroll sideways at 320 px', async ({
    page,
  }) => {
    // 4 + 60 characters: the longest reference the panel will render (`FailureReference`), with no
    // break opportunity of its own.
    const reference = `evt_${'a1b2c3d4e5f6'.repeat(5)}`
    expect(reference).toHaveLength(64)

    await page.setViewportSize({ width: 320, height: 640 })
    await openGallery(page, 'pl', reference)

    await expect(page.getByText(reference, { exact: false })).not.toHaveCount(0)
    const width = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }))
    expect(width.viewport).toBe(320)
    expect(width.document, 'the page scrolls sideways').toBeLessThanOrEqual(320)
    expect(width.body, 'the body scrolls sideways').toBeLessThanOrEqual(320)
  })
})

test.describe('after an action', () => {
  test('a failed action moves focus to the panel’s heading', async ({
    page,
  }) => {
    await mountHarness(page, 'failure-harness.tsx', {
      globals: { locale: 'en', scenario: 'action', reference: 'evt_7f3a91c2' },
    })
    await page.getByRole('button', { name: text('en', 'action.save') }).click()

    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert.getByRole('heading')).toBeFocused()
  })

  test('Copy writes the bare reference and confirms it in a visible status line', async ({
    page,
  }) => {
    await openGallery(page, 'en')

    const panel = page.locator(
      '[data-shape="internal"][data-placement="in-place"]',
    )
    await panel
      .getByRole('button', { name: text('en', 'failure.reference.copy') })
      .click()

    await expect(panel.getByRole('status')).toHaveText(
      text('en', 'failure.reference.copied'),
    )
    expect(await page.evaluate(() => Reflect.get(window, '__copied'))).toBe(
      'evt_7f3a91c2',
    )
  })
})

/* -------------------------------------------------------------------------- */
/* Evidence frames                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Where the frames go, or `undefined` when none are asked for.
 *
 * It must be outside the repository: a PNG left inside it is a defect (`AGENTS.md`), so a path
 * under the project root is refused rather than written to.
 */
function evidenceDirectory(): string | undefined {
  const directory = process.env.FAILURE_EVIDENCE_DIR
  if (directory === undefined || directory === '') return undefined
  const resolved = path.resolve(directory)
  const inside = path.relative(process.cwd(), resolved)
  if (inside === '' || !inside.startsWith('..')) {
    throw new Error(
      `FAILURE_EVIDENCE_DIR=${directory} is inside the repository; frames go outside it`,
    )
  }
  return resolved
}

const FRAME_WIDTHS = [360, 1280, 2560] as const
const SHAPES = ['retryable', 'quota', 'feature_locked', 'internal'] as const

test.describe('evidence frames', () => {
  const directory = evidenceDirectory()
  test.skip(
    directory === undefined,
    'FAILURE_EVIDENCE_DIR is not set; frames are taken on request, outside the repository.',
  )

  for (const theme of THEMES) {
    for (const width of FRAME_WIDTHS) {
      const height = width === 360 ? 800 : 900
      const stem = (name: string) =>
        path.join(directory ?? '', `${name}-${theme}-${String(width)}.png`)

      test(`the four shapes, RouteError and the interaction states - ${theme}, ${String(width)} px`, async ({
        page,
      }) => {
        await mkdir(directory ?? '', { recursive: true })
        await page.setViewportSize({ width, height })
        await useTheme(page, theme)
        await openGallery(page, 'en')

        for (const shape of SHAPES) {
          for (const placement of ['in-place', 'after-action']) {
            await page
              .locator(`[data-shape="${shape}"][data-placement="${placement}"]`)
              .screenshot({ path: stem(`${shape}-${placement}`) })
          }
        }
        await page
          .locator('[data-shape="route-error"]')
          .screenshot({ path: stem('route-error') })

        // The line a reader sees after Copy.
        const internal = page.locator(
          '[data-shape="internal"][data-placement="in-place"]',
        )
        await internal
          .getByRole('button', { name: text('en', 'failure.reference.copy') })
          .click()
        await expect(internal.getByRole('status')).toHaveText(
          text('en', 'failure.reference.copied'),
        )
        await internal.screenshot({ path: stem('copy-confirmation') })

        // The heading that holds focus after an action failed.
        await mountHarness(page, 'failure-harness.tsx', {
          globals: {
            locale: 'en',
            scenario: 'action',
            reference: 'evt_7f3a91c2',
          },
        })
        await page
          .getByRole('button', { name: text('en', 'action.save') })
          .click()
        await expect(page.getByRole('alert').getByRole('heading')).toBeFocused()
        await page.screenshot({ path: stem('focused-heading-after-action') })
      })

      test(`the real 404 and the forced failure - ${theme}, ${String(width)} px`, async ({
        page,
        expectConsole,
      }) => {
        expectConsole([...DOCUMENT_404, ...FORCED_FAILURE_CONSOLE])
        await mkdir(directory ?? '', { recursive: true })
        await page.setViewportSize({ width, height })
        await useTheme(page, theme)

        await gotoApp(page, '/does-not-exist')
        await expect(
          page.getByRole('heading', {
            name: text('en', 'empty.notFound.title'),
          }),
        ).toBeVisible()
        await page.screenshot({ path: stem('not-found') })

        const failing = await forceRouteError(page, 'en')
        try {
          await page.screenshot({ path: stem('route-error-in-app') })
        } finally {
          await failing.release()
        }
      })
    }
  }
})
