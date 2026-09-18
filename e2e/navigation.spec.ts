import { expect, test } from './support/console'

import { gotoApp } from './support/app'
import { expectNoWcagViolations } from './support/axe-scan'
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
 * showing, and the same four cases run against `bottom-nav.tsx` under `mobile-chromium` and `mobile-safari` and against
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

  test('says which screen it arrived on, and stays clean while saying it', async ({
    page,
  }) => {
    await gotoApp(page, '/dashboard')

    // Empty on arrival: the browser announced the document it loaded, and the region exists from
    // the first paint only so that assistive technology is already watching it.
    //
    // Unscoped, and the count is the point: a loaded dashboard draws no other live region, so this
    // also says that the announcer did not arrive beside one of the widgets' loading states.
    const announcer = page.getByRole('status')
    await expect(announcer).toHaveCount(1)
    await expect(announcer).toHaveText('')

    await primaryNavLink(page, en['nav.accounts']).click()
    await expect(page).toHaveURL(/\/accounts(\?|$)/)
    await expect(
      page.getByRole('heading', { level: 1, name: en['accounts.title'] }),
    ).toBeVisible()

    // The destination's own title, which is what the tab now shows and what a document load would
    // have read out - no second copy of the screen's name to translate or keep in step.
    const title = await page.title()
    expect(title).toContain(en['accounts.title'])
    await expect(announcer).toHaveText(title)

    // Scanned in exactly this state, because it is the only state in which the region has text:
    // an `aria-live` region that is off-screen, inside no landmark and holding a whole sentence is
    // the shape a rule such as `aria-hidden-focus` or `region` would object to if it objected.
    await expectNoWcagViolations(page, '/accounts after a rail navigation')
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

/**
 * The iPhone 15's viewport, set explicitly so every project runs the sheet case.
 *
 * `bottom-nav.tsx` is `lg:hidden`, so the sheet exists only below 1024px and `chromium` and
 * `webkit` would otherwise never reach it — the same reason `narrow-viewport.spec.ts` fixes its
 * own width rather than relying on the project matrix.
 */
const PHONE_VIEWPORT = { width: 393, height: 852 }

/**
 * The one navigation the rail has no equivalent of: the phone's overflow sheet.
 *
 * It is a modal — React Aria's overlay, focus trap and `aria-modal` — and the bar that owns its
 * open state lives in the `_app` layout route, so a route change does not unmount it. While the
 * bar was plain anchors, the document load tore the sheet down as a side effect; the client-side
 * move this file exists to assert removed that side effect, and with it the only thing closing
 * the sheet. The case below is the regression guard: the destination has to arrive *and* the
 * modal over it has to be gone.
 */
test.describe('the phone bar overflow sheet', () => {
  test.use({
    storageState: storageStateFor('demo'),
    viewport: PHONE_VIEWPORT,
  })

  test('closes itself on the way to the destination it names', async ({
    page,
  }) => {
    await gotoApp(page, '/dashboard')
    await page
      .getByRole('button', { name: en['app.nav.more'], exact: true })
      .click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    await sheet
      .getByRole('link', { name: en['nav.budgets'], exact: true })
      .click()

    await expect(page).toHaveURL(/\/budgets(\?|$)/)
    await expect(
      page.getByRole('heading', { level: 1, name: en['budgets.title'] }),
    ).toBeVisible()

    // Gone, not merely scrolled past. A sheet left open here keeps its overlay and its focus trap
    // over the screen that just arrived, so the reader lands somewhere they cannot act on until
    // they find Escape.
    await expect(sheet).toHaveCount(0)
  })
})
