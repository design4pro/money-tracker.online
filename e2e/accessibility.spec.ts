import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { gotoApp, useLocale, useTheme } from './support/app'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'
import type { Browser } from '@playwright/test'

/**
 * Axe's own result shapes, read off the builder rather than imported from `axe-core`.
 *
 * `axe-core` is a transitive dependency here — `@axe-core/playwright` depends on it, nothing in
 * this repository declares it — so importing its types directly resolves under a hoisting node
 * layout and fails under pnpm's. Deriving them from the method that returns them cannot drift.
 */
type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>
type Violation = AxeResults['violations'][number]

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

/** The A and AA tags of every WCAG version this product claims. No `best-practice`. */
const WCAG_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa',
] as const

interface Surface {
  readonly name: string
  readonly path: string
  /** `undefined` = the signed-out visitor, which is the only way to see `/login`. */
  readonly session: 'demo' | undefined
}

/**
 * The four screens named in the brief.
 *
 * They are read with the seeded demo session, never written to, so `scripts/seed/verify.mjs` still
 * finds every counter it asserts. Reading the *demo* workspace also matters for what axe sees:
 * `/transactions` there is a populated grid and `/dashboard` a populated set of cards, so the scan
 * covers rendered rows, badges and figures rather than four empty-state illustrations.
 */
const SURFACES: readonly Surface[] = [
  { name: 'sign in', path: '/login', session: undefined },
  { name: 'dashboard', path: '/dashboard', session: 'demo' },
  { name: 'accounts', path: '/accounts', session: 'demo' },
  { name: 'transactions', path: '/transactions', session: 'demo' },
]

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

/**
 * One violation, written out so the failure names the element and the criterion.
 *
 * A bare rule id sends the next reader to the axe documentation to find out which of forty nodes
 * on the page it meant; the selector and the failure summary let them open the screen and see it.
 */
function describeViolation(violation: Violation): string {
  const nodes = violation.nodes
    .slice(0, 4)
    .map((node) => {
      const target = node.target.join(' ')
      const why = node.failureSummary?.replace(/\s+/g, ' ').trim() ?? ''
      return `    - ${target}\n      ${why}`
    })
    .join('\n')

  const more =
    violation.nodes.length > 4
      ? `\n    …and ${violation.nodes.length - 4} more node(s)`
      : ''

  return (
    `  [${violation.impact ?? 'unknown'}] ${violation.id}: ${violation.help}\n` +
    `  ${violation.helpUrl}\n${nodes}${more}`
  )
}

function report(results: AxeResults, label: string): string {
  return (
    `${results.violations.length} WCAG A/AA violation(s) on ${label}:\n` +
    results.violations.map(describeViolation).join('\n')
  )
}

async function scan(
  browser: Browser,
  surface: Surface,
  theme: AppTheme,
  locale: AppLocale,
): Promise<void> {
  const context = await browser.newContext(
    surface.session === undefined
      ? { storageState: { cookies: [], origins: [] } }
      : { storageState: storageStateFor(surface.session) },
  )

  try {
    // Both before the first navigation: the locale is negotiated on the server from this cookie,
    // and the theme is applied by the pre-paint bootstrap script. Applied afterwards, each would
    // scan a document that corrected itself after axe had already read it.
    await useLocale(context, locale)
    const page = await context.newPage()
    await useTheme(page, theme)

    await gotoApp(page, surface.path)
    // Axe reads the accessibility tree, which is only final once React has attached its handlers
    // and its `aria-*` state — `gotoApp` waits for that. `main` being visible is the extra claim
    // that the route resolved rather than landing on an error boundary that would scan clean.
    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', locale)

    const results = await new AxeBuilder({ page })
      .withTags([...WCAG_AA_TAGS])
      .analyze()

    // The assertion compares a short list of `impact · rule` lines rather than the raw violation
    // objects: a `toEqual` diff of axe's own structures buries the rule id under several screens
    // of `relatedNodes: []`, and the reader needs the rule and the selector, which the message
    // carries in full.
    const summary = results.violations.map(
      (violation) => `${violation.impact ?? 'unknown'} · ${violation.id}`,
    )
    expect(
      summary,
      report(results, `${surface.name} · ${theme} · ${locale}`),
    ).toEqual([])
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
})
