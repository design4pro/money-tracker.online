import { expect } from '@playwright/test'

import { gotoApp, useLocale, useTheme } from './app'
import { storageStateFor } from './session'

import type { AppLocale, AppTheme } from './app'
import type { SessionId } from './session'
import type { Browser, BrowserContext, Page } from '@playwright/test'

/**
 * The screens a reader cannot avoid, and the one way this suite opens them.
 *
 * Two specs scan this list — `accessibility.spec.ts` for every WCAG A/AA violation, and
 * `contrast-enhanced.spec.ts` for the 7:1 text floor under a hover wash. They shared nothing
 * before, which is a shape worth naming: issue #20 was reported against a `/categories` row that
 * the Playwright suite could not have seen, because `/categories` was in `.github/a11y/routes.json`
 * and not here. One list is how that stops happening.
 */

export interface Surface {
  readonly name: string
  readonly path: string
  /**
   * `undefined` = the signed-out visitor, which is the only way to see `/login`.
   *
   * {@link SURFACES} below is all `demo`, because a populated workspace is what those scans need.
   * `states.spec.ts` builds its own list on the `empty` session for the opposite reason.
   */
  readonly session: SessionId | undefined
}

/** Named, because `accessibility.spec.ts` opens this same surface for its meter case. */
export const ACCOUNTS: Surface = {
  name: 'accounts',
  path: '/accounts',
  session: 'demo',
}

/**
 * They are read with the seeded demo session, never written to, so `scripts/seed/verify.mjs` still
 * finds every counter it asserts. Reading the *demo* workspace also matters for what axe sees:
 * `/transactions` there is a populated grid and `/dashboard` a populated set of cards, so the scan
 * covers rendered rows, badges and figures rather than seven empty-state illustrations.
 *
 * `/budgets`, `/recurring` and `/goals` are here rather than only in their own per-route specs
 * because those specs assert the plans' narrower bar — zero `serious`, zero `critical`, one theme,
 * one locale. The A/AA bar is every WCAG violation at any impact, in **both** themes and **both**
 * locales, and the three surfaces carry exactly the things that axis catches: a hand-written
 * `role="meter"` whose accessible value is a sentence, a status word that must survive translation,
 * and a hue per verdict in two palettes. Their detail routes are not listed: an id in the path
 * makes the surface a seeded row rather than a route, and the per-route visual specs already scan
 * those with the same rule set.
 */
export const SURFACES: readonly Surface[] = [
  // The landing page is first because it is the only surface most visitors ever load, and
  // because its own copy now states that WCAG 2.2 AA is enforced by a gate that fails the build.
  // A page making that claim while sitting outside the gate would be the one accessibility
  // falsehood this product cannot afford.
  { name: 'landing', path: '/', session: undefined },
  { name: 'sign in', path: '/login', session: undefined },
  { name: 'dashboard', path: '/dashboard', session: 'demo' },
  ACCOUNTS,
  { name: 'transactions', path: '/transactions', session: 'demo' },
  // `.github/a11y/routes.json` has scanned this route all along; this list had not, which is how
  // issue #20 was able to name a `/categories` row nobody here could reproduce. The two are
  // meant to agree.
  { name: 'categories', path: '/categories', session: 'demo' },
  { name: 'budgets', path: '/budgets', session: 'demo' },
  { name: 'recurring', path: '/recurring', session: 'demo' },
  { name: 'savings goals', path: '/goals', session: 'demo' },
]

/**
 * A context and a hydrated page for one surface, in one theme and one locale.
 *
 * The caller owns the context and must close it — which is why this answers both.
 */
export async function openSurface(
  browser: Browser,
  surface: Surface,
  theme: AppTheme,
  locale: AppLocale,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(
    surface.session === undefined
      ? { storageState: { cookies: [], origins: [] } }
      : { storageState: storageStateFor(surface.session) },
  )

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

  // WCAG 2.2 §2.4.2: the tab names the page before the product, in the reader's language - the
  // same words as the screen's own `<h1>`, composed by `src/routes/-lib/page-title.ts`. The
  // landing page is the one surface that keeps the root's sentence, by design.
  if (surface.path !== '/') {
    const heading = (await page.locator('h1').first().innerText()).trim()
    await expect(page).toHaveTitle(`${heading} · Money Tracker`)
  }

  return { context, page }
}
