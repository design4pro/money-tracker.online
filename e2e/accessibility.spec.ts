import { expect, test } from './support/console'

// The axe-core meter defect is corrected in `support/axe-defects.ts` rather than here, because
// `.github/a11y/axe-scan.mjs` scans the same pages and has to forgive the same node. Two copies of
// a three-condition correction with a 2027 re-check date would drift on the first edit.
// The scan itself — the tag list, the correction and the failure formatting — is shared with
// `states.spec.ts`, which holds the same bar over the empty screens.
import { expectNoWcagViolations } from './support/axe-scan'
// The surface list and the way a surface is opened are shared with `contrast-enhanced.spec.ts`.
import { ACCOUNTS, openSurface, SURFACES } from './support/surfaces'

import type { AppLocale, AppTheme } from './support/app'
import type { Surface } from './support/surfaces'
import type { Browser, BrowserContextOptions } from '@playwright/test'

/**
 * `@axe-core/playwright` over the four screens a reader cannot avoid, in both themes and both
 * locales.
 *
 * ## Why the matrix has these two axes
 *
 * Theme and locale are the two dimensions that change the rendered document rather than the
 * viewport. A dark theme is a different set of colour tokens, so contrast is a *different
 * question* in each — and contrast is the violation this product is most exposed to, since
 * `DESIGN.md` builds both palettes from one token layer and a single mis-mapped token is invisible
 * in the theme it was authored in. A locale changes `<html lang>`, the length of every label, and
 * the accessible name of every control, so a name that was correct in English can be missing in
 * Polish. Scanning one theme in one language is scanning a quarter of the product.
 *
 * Width is *not* a third axis of this matrix, because the project list supplies it: `openSurface`
 * creates its context under the running project's `use` options, so every scan here runs at that
 * project's own viewport, locale, time zone and clock pin - 1440x900 under `chromium`, 412x915
 * under `mobile-chromium`. Theme and locale are applied afterwards and stay explicit. The
 * `*.visual.spec.ts` panel scans follow the project the same way, through the `page` fixture. The
 * test after the matrix asserts the width, so a change that stopped it applying is red.
 *
 * ## What counts as a failure
 *
 * Any violation carrying a WCAG 2.0/2.1/2.2 **A or AA** tag, at any impact. That is stricter than
 * `docs/ACCESSIBILITY.md` §5.1, which fails the build only at `serious` and above — a deliberate
 * choice for a regression net: a `minor` A-level violation is still a failed success criterion, and
 * the point of this file is to hold the line rather than to triage it.
 *
 * Axe's `best-practice` rules are *excluded*, because they are not WCAG. Including them would make
 * this spec fail for reasons the conformance claim in `docs/ACCESSIBILITY.md` §1 does not make, and
 * the first person to hit one would widen the exclusion list rather than fix a real violation.
 *
 * And what this spec proves is narrow, which §5.1 states out loud: axe reaches roughly a third of
 * WCAG by criterion count. It is a floor. Keyboard traversal, focus order and the sensible landing
 * of focus after a save live in `keyboard.spec.ts`; the rest is the manual list in §5.3.
 */

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

async function scan(
  browser: Browser,
  contextOptions: BrowserContextOptions,
  surface: Surface,
  theme: AppTheme,
  locale: AppLocale,
): Promise<void> {
  const { context, page } = await openSurface(
    browser,
    contextOptions,
    surface,
    theme,
    locale,
  )

  try {
    await expectNoWcagViolations(page, `${surface.name} · ${theme} · ${locale}`)
  } finally {
    await context.close()
  }
}

test.describe('accessibility', () => {
  for (const surface of SURFACES) {
    for (const theme of THEMES) {
      for (const locale of LOCALES) {
        test(`${surface.name} has no WCAG A or AA violations · ${theme} · ${locale}`, async ({
          browser,
          contextOptions,
        }) => {
          await scan(browser, contextOptions, surface, theme, locale)
        })
      }
    }
  }

  /**
   * A scan that follows the project's viewport is a scan whose page is as wide as that viewport.
   *
   * This holds the outcome, not the mechanism: it stays green however `openSurface` gets there,
   * and goes red the day a scan stops running at the project's width, whether through a context
   * built from explicit options or a change in how Playwright applies `use` to `newContext()`.
   * It holds for every project, but the claim worth having is the phone one - 412 under
   * `mobile-chromium` - which is a width no other scan in this file reaches.
   */
  test("a scan runs at the project's viewport width", async ({
    browser,
    contextOptions,
  }, testInfo) => {
    const viewport = testInfo.project.use.viewport
    expect(
      viewport,
      'every project declares the viewport it scans at',
    ).toBeTruthy()

    const { context, page } = await openSurface(
      browser,
      contextOptions,
      ACCOUNTS,
      'light',
      'en',
    )

    try {
      expect(await page.evaluate(() => window.innerWidth)).toBe(viewport?.width)
    } finally {
      await context.close()
    }
  })

  /**
   * The credit meter on `/accounts` is a `role="meter"` with a sentence as its name.
   *
   * `react-aria-components` 1.22.1 emits a single `meter` token. The axe-core 4.13 fallback-list
   * defect in `isMeterFallbackRoleArtefact` therefore matches nothing on this page; this case
   * still asserts the reader-facing facts that correction used to stand in for.
   *
   * On Chromium it reads the browser's *own* accessibility tree over CDP; on WebKit, Playwright's
   * ARIA resolver is the available answer and it agrees.
   */
  test('the credit meter on accounts announces as a meter, with its whole sentence as the name', async ({
    browser,
    contextOptions,
  }, testInfo) => {
    const { context, page } = await openSurface(
      browser,
      contextOptions,
      ACCOUNTS,
      'light',
      'en',
    )

    try {
      const meters = page.getByRole('meter')
      const meterCount = await meters.count()
      expect(
        meterCount,
        'the seeded demo workspace has at least one credit account with a limit',
      ).toBeGreaterThan(0)

      await expect(page.getByRole('progressbar')).toHaveCount(0)

      const meter = meters.first()
      await expect(meter).toHaveAccessibleName(/ of .* used, \d+%$/)
      await expect(meter).toHaveAttribute('aria-valuenow', /^[\d.]+$/)
      await expect(meter).toHaveAttribute('aria-valuemin', '0')
      await expect(meter).toHaveAttribute('aria-valuemax', '1')
      await expect(meter).toHaveAttribute('role', 'meter')

      if (testInfo.project.name === 'chromium') {
        const cdp = await context.newCDPSession(page)
        try {
          await cdp.send('Accessibility.enable')
          const { nodes } = await cdp.send('Accessibility.getFullAXTree')
          const axMeters = nodes.filter(
            (axNode) => axNode.role?.value === 'meter',
          )
          expect(
            axMeters.length,
            "Chrome's own accessibility tree computes the node as role=meter",
          ).toBe(meterCount)
          expect(axMeters[0]?.name?.value).toMatch(/ of .* used, \d+%$/)
        } finally {
          await cdp.detach()
        }
      }
    } finally {
      await context.close()
    }
  })
})
