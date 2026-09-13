import { expect, test } from './support/console'

import { gotoApp } from './support/app'
import { storageStateFor } from './support/session'

/**
 * The diagnostic that only ever runs during an outage, exercised outside one.
 *
 * `e2e/support/__tests__/reachability.test.ts` pins the wording. This pins the thing the wording
 * depends on and vitest cannot see: that `page.request` reaches the server by a path the page's own
 * navigation does not, so the two can disagree. That is the entire finding of #189 — on run
 * 34144653183 the browser stopped being able to load anything from `localhost:3010` while the
 * server went on answering every request it received — and a probe that quietly travelled with the
 * navigation would report `answered: false` for both situations and diagnose nothing.
 *
 * The wedge is reproduced the only way a test can reproduce it: a route handler that accepts the
 * navigation and never answers it, which is what the browser saw. The server is untouched and stays
 * up throughout, so if the probe still finds it, the mechanism works.
 */

test.use({ storageState: storageStateFor('demo') })

test('a navigation the browser cannot finish is blamed on the browser, not the application', async ({
  page,
}) => {
  // Two seconds rather than the config's twenty: the navigation is guaranteed to hang, so the
  // whole budget would be spent proving something the first two seconds already prove.
  page.setDefaultNavigationTimeout(2_000)

  // Accepted and never answered. `route.abort()` would not do: that fails the navigation
  // immediately with a transport error, which is the one signature #189 is *not* about.
  await page.route('**/dashboard', () => {
    /* Swallow the request. The handler never calls fulfil, continue or abort. */
  })

  const failure = await gotoApp(page, '/dashboard').catch(
    (error: unknown) => error,
  )

  expect(failure).toBeInstanceOf(Error)
  const message = (failure as Error).message

  // Playwright's own error survives: the wrapper appends, it never replaces.
  expect(message).toContain('Timeout 2000ms exceeded')
  // And the appended verdict clears the application, which it can only do by having reached it.
  expect(message).toContain("what failed is the browser's access to it")
  // Whichever status came back, not which one: the probe carries no session, so a protected route
  // answers it 307 rather than 200, and "the server answered" is the only claim being made.
  expect(message).toMatch(/HTTP \d{3} in \d+ms/)
})
