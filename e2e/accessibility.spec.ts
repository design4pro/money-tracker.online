import { expect, test } from './support/console'

// The axe-core meter defect is corrected in `support/axe-defects.ts` rather than here, because
// `.github/a11y/axe-scan.mjs` scans the same pages and has to forgive the same node. Two copies of
// a three-condition correction with a 2027 re-check date would drift on the first edit.
import { RAC_METER_FALLBACK_ROLE } from './support/axe-defects'
// The scan itself — the tag list, the correction and the failure formatting — is shared with
// `states.spec.ts`, which holds the same bar over the empty screens.
import { expectNoWcagViolations } from './support/axe-scan'
// The surface list and the way a surface is opened are shared with `contrast-enhanced.spec.ts`.
import { ACCOUNTS, openSurface, SURFACES } from './support/surfaces'

import type { AppLocale, AppTheme } from './support/app'
import type { Surface } from './support/surfaces'
import type { Browser } from '@playwright/test'

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
 * Width is deliberately *not* a third axis here: `playwright.config.ts` owns the viewports and
 * already runs this file at a phone width under `mobile-safari`. Multiplying it here would run the
 * same scans twice under two different owners.
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
  surface: Surface,
  theme: AppTheme,
  locale: AppLocale,
): Promise<void> {
  const { context, page } = await openSurface(browser, surface, theme, locale)

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
        }) => {
          await scan(browser, surface, theme, locale)
        })
      }
    }
  }

  /**
   * The positive half of the correction in `isMeterFallbackRoleArtefact`.
   *
   * Dropping an axe node earns nothing unless the behaviour it was pointing at is asserted
   * somewhere. So this holds the three facts the correction rests on, and holds them harder than
   * the rule it replaces: the fallback list is present, it resolves to **`meter`** rather than
   * decaying to `progressbar` or to nothing, and the value attributes it carries produce the
   * whole sentence as the accessible name — "zł 1,692.11 of zł 10,000.00 used, 17%", not "17%".
   *
   * On Chromium it goes further and reads the browser's *own* accessibility tree over CDP, which
   * is what a screen reader consumes; on WebKit, where no such protocol is reachable from here,
   * Playwright's ARIA resolver is the available answer and it agrees.
   *
   * If React Aria ever stops emitting the list, or a browser stops resolving it, this fails —
   * which is the signal to delete the correction rather than to widen it.
   */
  test('the credit meter on accounts announces as a meter, with its whole sentence as the name', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await openSurface(
      browser,
      ACCOUNTS,
      'light',
      'en',
    )

    try {
      const fallbackNodes = page.locator(`[role="${RAC_METER_FALLBACK_ROLE}"]`)
      const fallbackCount = await fallbackNodes.count()
      expect(
        fallbackCount,
        'the seeded demo workspace has at least one credit account with a limit',
      ).toBeGreaterThan(0)

      // Every one of them resolves to `meter`, and none of them to `progressbar`: the second
      // token is the fallback for an agent that lacks the first, and no browser we ship to needs
      // it any more. `toHaveCount` on both is what makes that a claim rather than an assumption.
      await expect(page.getByRole('meter')).toHaveCount(fallbackCount)
      await expect(page.getByRole('progressbar')).toHaveCount(0)

      const meter = page.getByRole('meter').first()
      await expect(meter).toHaveAccessibleName(/ of .* used, \d+%$/)
      await expect(meter).toHaveAttribute('aria-valuenow', /^[\d.]+$/)
      await expect(meter).toHaveAttribute('aria-valuemin', '0')
      await expect(meter).toHaveAttribute('aria-valuemax', '1')

      if (testInfo.project.name === 'chromium') {
        const cdp = await context.newCDPSession(page)
        try {
          await cdp.send('Accessibility.enable')
          const { nodes } = await cdp.send('Accessibility.getFullAXTree')
          const meters = nodes.filter(
            (axNode) => axNode.role?.value === 'meter',
          )
          expect(
            meters.length,
            "Chrome's own accessibility tree computes the fallback list as role=meter",
          ).toBe(fallbackCount)
          expect(meters[0]?.name?.value).toMatch(/ of .* used, \d+%$/)
        } finally {
          await cdp.detach()
        }
      }
    } finally {
      await context.close()
    }
  })
})
