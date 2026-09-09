import { expect, test } from './support/console'

import { gotoApp, useLocale } from './support/app'
import { storageStateFor } from './support/session'

import type { AppLocale } from './support/app'

/**
 * What a screen must not do with 1440px.
 *
 * ## The fault this file exists to catch
 *
 * The inverse of `narrow-viewport.spec.ts`. There the defect is a row too small for its content;
 * here it is a row too large for it — a name and a handful of short facts ending at x≈455 with a
 * `border-subtle` rule drawn to x≈1360, which is a promise of a column that is not there. Seven
 * critics holding eight PNGs and no contact between them converged on it across six of seven
 * surfaces (`docs/rounds/2026-09-03-blind-comparison.md`, finding 1), and issue #18 carries the
 * measurements.
 *
 * ## The three shapes of the assertion
 *
 * `.ai/specs/2026-09-09-desktop-layout-density.md` decides per surface between capping the measure
 * and earning the width, and states each decision as something a browser can check at 1440×900:
 *
 * - **cap** — the named block's rendered width is ≤ 912px (the 896px band plus 16px of tolerance).
 * - **pair** — two cards sit on one row: equal `y`, differing `x`, each ≤ 620px.
 * - **earn** — the named band carries a rendered node within 32px of each of its two ends.
 *
 * ## Why measured rather than photographed
 *
 * ADR 0016 retired screenshot baselines: what a screen *looks* like is judged by a human against
 * the blind A/B pair, and frames are still taken by hand for review. What can be asserted
 * mechanically is narrower and more durable — a width, two box positions, a computed line-height —
 * and none of it needs a reference image to be true.
 *
 * ## Both locales, because `pl` is the longer catalogue
 *
 * A band tuned on English and broken in Polish is a failure this repository has recorded once
 * already, so every capped block is read in both. Strings are quoted rather than imported, for the
 * `import.meta.glob` reason `support/app.ts` sets out.
 */

test.use({
  storageState: storageStateFor('demo'),
  viewport: { width: 1440, height: 900 },
})

const LOCALES: readonly AppLocale[] = ['en', 'pl']

/* -------------------------------------------------------------------------- */
/* Phase 1 — the eight page subtitles                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every `_app` page whose `<h1>` is followed by a subtitle paragraph.
 *
 * Eight, not the seven surfaces issue #18 names: `DESIGN.md` → Layout claims product-wide that "no
 * running text is uncapped", so capping a subset would leave the design document false in between.
 */
const SUBTITLE_ROUTES = [
  '/categories',
  '/transactions/groups',
  '/accounts',
  '/budgets',
  '/recurring',
  '/payees',
  '/goals',
  '/transactions/rules',
] as const

/**
 * The two subtitles long enough that 65ch cannot hold them in either locale.
 *
 * `rules.subtitle` is 147 characters in `en` and 162 in `pl`; `groups.subtitle` is 134 and 166.
 * Both are more than twice the cap, so wrapping is not a judgement about how wide a `ch` is on the
 * machine running this — it is arithmetic. The shorter offenders (`categories`, `payees`) sit close
 * enough to the cap that asserting on their line count would be asserting about a font metric.
 */
const MUST_WRAP: ReadonlyArray<string> = [
  '/transactions/groups',
  '/transactions/rules',
]

for (const locale of LOCALES) {
  for (const route of SUBTITLE_ROUTES) {
    test(`the page subtitle on ${route} is capped without moving off the body leading — ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await gotoApp(page, route)

      const subtitle = page.locator('h1 + p').first()
      await expect(subtitle).toBeVisible()

      const measured = await subtitle.evaluate((element) => {
        const style = getComputedStyle(element)
        const root = getComputedStyle(document.documentElement)
        return {
          maxWidth: style.maxWidth,
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
          fontSize: Number.parseFloat(style.fontSize),
          lineHeight: Number.parseFloat(style.lineHeight),
          bodyLeading: Number.parseFloat(
            root.getPropertyValue('--text-body--line-height'),
          ),
          readingLeading: Number.parseFloat(
            root.getPropertyValue('--leading-reading'),
          ),
        }
      })

      // The cap is real, and the paragraph sits inside it.
      expect(measured.maxWidth).not.toBe('none')
      expect(measured.width).toBeLessThanOrEqual(
        Number.parseFloat(measured.maxWidth) + 1,
      )

      // `max-w-prose` caps width and nothing else. `prose-measure` would also set the reading
      // leading, which moves the block off the 2.5rem pitch `DESIGN.md` → The On-Pitch Rule
      // governs — so the leading here must still be the body's.
      expect(measured.lineHeight).toBeCloseTo(
        measured.fontSize * measured.bodyLeading,
        0,
      )
      expect(measured.bodyLeading).not.toBeCloseTo(measured.readingLeading, 2)

      // The two longest of the four subtitles that broke the 80-character ceiling of WCAG 1.4.8
      // now wrap, which is the visible half of this change and the half a reader notices.
      if (MUST_WRAP.includes(route)) {
        expect(measured.height).toBeGreaterThan(measured.lineHeight * 1.5)
      }
    })
  }
}
