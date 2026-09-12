import { expect, test } from './support/console'

import { gotoApp } from './support/app'
import { storageStateFor } from './support/session'
import { holdServerFns } from './support/states'

import en from '#/lib/i18n/messages/en'

import type { Locator, Page } from '@playwright/test'

/**
 * The product's primary navigation, asserted as a navigation rather than as a page load.
 *
 * Until `AriaRouterProvider` was mounted, every row of the rail and every tab of the phone bar was
 * a plain anchor: React Aria's link machinery reads its router off a context whose default says
 * "the browser is the router", so the click was never intercepted. `docs/STATE-INVENTORY.md` §3
 * measured what that cost — two `document` requests per move, no data fetch, and therefore no
 * route's `pendingComponent` on the one navigation every reader uses.
 *
 * ## Why one file covers both navigations
 *
 * The rail and the bottom bar are one composition at two widths: `app-shell.tsx` draws the rail
 * `hidden … lg:flex` and the bar `lg:hidden`, and both label their `<nav>` with the same
 * `nav.primary`. So {@link primaryNavLink} resolves to whichever one the project's viewport is
 * showing, and the same four cases run against `bottom-nav.tsx` under `mobile-safari` and against
 * `sidebar-nav.tsx` under `chromium` and `webkit` — the phone bar had the identical defect and
 * would otherwise have no case at all.
 */

/**
 * A destination in whichever primary navigation this viewport draws.
 *
 * Both are in the DOM at every width; exactly one is `display: none`. Playwright's role engine
 * already skips an element the accessibility tree does not contain, and the visibility filter says
 * so out loud rather than leaving a reader to work out why two identically named navigations do
 * not trip strict mode.
 */
function primaryNavLink(page: Page, label: string): Locator {
  return page
    .getByRole('navigation', { name: en['nav.primary'] })
    .filter({ visible: true })
    .getByRole('link', { name: label, exact: true })
}

/**
 * How far down the ledger the scroll case moves before it navigates away.
 *
 * Far enough that the offset is unmistakably not the top, and comfortably inside the seeded
 * workspace's own ledger at both viewport heights this suite runs.
 */
const SCROLL_TO = 600

/** Every `document` request the browser made from now on, which is the thing under test. */
function recordDocumentRequests(page: Page): Array<string> {
  const documents: Array<string> = []
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documents.push(request.url())
  })
  return documents
}

test.describe('the primary navigation', () => {
  // The seeded workspace, read and never written: these cases are about the mechanism of a move,
  // and an empty workspace would leave every destination in its own empty state instead.
  test.use({ storageState: storageStateFor('demo') })

  test('moves between screens without asking the browser for a document', async ({
    page,
  }) => {
    await gotoApp(page, '/dashboard')
    await expect(
      page.getByRole('heading', { level: 1, name: en['dashboard.title'] }),
    ).toBeVisible()

    // Recorded only from here, so the navigation that got us onto the page is not counted.
    const documents = recordDocumentRequests(page)

    await primaryNavLink(page, en['nav.accounts']).click()

    await expect(page).toHaveURL(/\/accounts(\?|$)/)
    await expect(
      page.getByRole('heading', { level: 1, name: en['accounts.title'] }),
    ).toBeVisible()
    expect(documents).toEqual([])
  })

  test('draws the destination its loading state, which a document load never could', async ({
    page,
  }) => {
    await gotoApp(page, '/dashboard')
    await expect(
      page.getByRole('heading', { level: 1, name: en['dashboard.title'] }),
    ).toBeVisible()

    const held = await holdServerFns(page)
    try {
      await primaryNavLink(page, en['nav.accounts']).click()

      // The headline acceptance criterion of #245: a `pendingComponent` on the rail.
      const loading = page.locator('main [role="status"]')
      await expect(loading).toHaveCount(1)
      await expect(loading).toHaveText(en['accounts.list.loading'])

      // And the screen being left is gone rather than sitting there under the wrong URL, which is
      // the failure `docs/STATE-INVENTORY.md` §3 measured against the rail.
      await expect(
        page.getByRole('heading', { level: 1, name: en['dashboard.title'] }),
      ).toBeHidden()
    } finally {
      await held.release()
    }

    // A skeleton that never resolves is a different bug wearing this one's face.
    await expect(
      page.getByRole('heading', { level: 1, name: en['accounts.title'] }),
    ).toBeVisible()
  })

  test('leaves focus on the row that was activated', async ({ page }) => {
    await gotoApp(page, '/dashboard')

    const accounts = primaryNavLink(page, en['nav.accounts'])
    await accounts.click()
    await expect(page).toHaveURL(/\/accounts(\?|$)/)

    // A document load dumped focus at the top of the new document. Staying on the row is both the
    // better outcome and the one `aria-current="page"` then describes, so a keyboard reader can
    // carry straight on down the navigation.
    await expect(accounts).toBeFocused()
    await expect(accounts).toHaveAttribute('aria-current', 'page')
  })

  test('brings a scrolled screen back to where it was left', async ({
    page,
  }) => {
    await gotoApp(page, '/transactions')
    await expect(
      page.getByRole('heading', { level: 1, name: en['transactions.title'] }),
    ).toBeVisible()

    // The ledger arrives after hydration, so for a moment the document is one viewport tall and a
    // scroll issued then has nowhere to go and silently reads back as 0.
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight - window.innerHeight,
        ),
      )
      .toBeGreaterThan(SCROLL_TO)

    // `behavior: 'instant'` rather than the default: `app.css` sets `scroll-behavior: smooth` on
    // the document, so a plain `scrollTo` animates and the offset read on the next tick is still 0.
    await page.evaluate((top) => {
      window.scrollTo({ top, behavior: 'instant' })
    }, SCROLL_TO)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(SCROLL_TO)

    await primaryNavLink(page, en['nav.accounts']).click()
    await expect(page).toHaveURL(/\/accounts(\?|$)/)

    // Back, because that is the entry the offset was recorded against: TanStack keys its scroll
    // cache on the history entry (`scroll-restoration.ts`), and a second forward navigation to the
    // same path is a different entry that has never been scrolled.
    await page.goBack()
    await expect(page).toHaveURL(/\/transactions(\?|$)/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(SCROLL_TO)
  })
})
