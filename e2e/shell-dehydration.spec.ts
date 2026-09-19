import { expect, test } from './support/console'

import { gotoApp } from './support/app'
import { DEMO, storageStateFor } from './support/session'

/**
 * What issue #230's fix must not change, asserted where the change lands.
 *
 * `src/router.tsx` now carries the shell the SSR pass resolved into the browser's cache, so
 * `_app.beforeLoad` answers a tab's first client-side navigation from cache (ADR 0018). Two things
 * could go wrong with that and neither would show up as a missing skeleton: the guard could stop
 * redirecting a visitor with no session, and a session-derived value could start riding in a
 * document the guard never ran for. `src/router.tsx` is in every visitor's entry chunk, which is
 * why the second is asserted rather than assumed.
 */

/** The seeded workspace's name — a session-derived value, shown only inside the guarded shell. */
const DEMO_WORKSPACE_NAME = 'Demo Household'

test.describe('a visitor with no session', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('is still sent to sign in by a client-side navigation into the product', async ({
    page,
  }) => {
    await gotoApp(page, '/login')

    const documents: Array<string> = []
    page.on('request', (request) => {
      if (request.resourceType() === 'document') documents.push(request.url())
    })

    // No link on a signed-out page leads into the product, so the router is driven directly: this
    // is the move a signed-out tab would make, and the document it started from primed nothing.
    await page.evaluate(() =>
      window.__TSR_ROUTER__?.navigate({ to: '/accounts' }),
    )

    // The guard's observable answer, unchanged: the sign-in screen, with the way back intact —
    // `/accounts` plus whatever search defaults its route validated in.
    await expect(page).toHaveURL(/\/login\?redirect=%2Faccounts(%3F|$)/)
    // And it was answered by the router, not by a document load that would have hidden a change.
    expect(documents).toEqual([])
  })
})

test.describe('a signed-in reader', () => {
  test.use({ storageState: storageStateFor('demo') })

  /**
   * The served document, not the live page: the router serializes its dehydrated payload into the
   * HTML as script text, so the only place it can be read is the response body. The search is for
   * the reader's own values rather than for a field name, so it survives a rename of the payload.
   *
   * `/` is the document a signed-in reader can be served where `_app` never matches. `/login`
   * redirects them before any document is written, so it has nothing to carry.
   */
  test('is not echoed into a document the guard never ran for', async ({
    page,
  }) => {
    const landing = await page.request.get('/', { maxRedirects: 0 })
    expect(landing.status()).toBe(200)
    const body = await landing.text()
    expect(body).not.toContain(DEMO.email)
    expect(body).not.toContain(DEMO_WORKSPACE_NAME)

    // The control: the same search does find both inside the product, so the absence above is a
    // statement about the landing page and not about a search that could never match.
    const inside = await page.request.get('/dashboard?period=thisMonth')
    expect(inside.status()).toBe(200)
    const product = await inside.text()
    expect(product).toContain(DEMO.email)
    expect(product).toContain(DEMO_WORKSPACE_NAME)
  })
})
