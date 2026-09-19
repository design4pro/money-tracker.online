import { expect, test } from './support/console'

import { gotoApp } from './support/app'
import { holdEveryServerFn } from './support/states'

/**
 * The guarded shell's pending fallback, reached by a signed-out reader, and the way back (#339).
 *
 * A client-side navigation from the sign-in screen into a guarded route renders the guard's
 * pending fallback while `_app.beforeLoad` resolves the session, and then lands back on sign-in.
 * The layout that was on screen before must come back as a fresh mount, not as a subtree React
 * hid under the fallback and revealed afterwards: React Aria's text fields lose their label slot
 * while hidden, and each re-renders once without an accessible name on the way back — four
 * console warnings the fixture below turns red.
 *
 * `window.__TSR_ROUTER__` rather than a link, because the sign-in screen has no link into the
 * product. It is TanStack Router's own client handle, set in every build.
 */

// A signed-out reader: no cached session, whatever the project default is.
test.use({ storageState: { cookies: [], origins: [] } })

test('a signed-out reader held on the guard is sent to sign in without console output', async ({
  page,
}) => {
  await gotoApp(page, '/login')
  const email = page.getByRole('textbox', { name: 'Email address' })
  await expect(email).toBeVisible()

  const held = await holdEveryServerFn(page)
  try {
    await page.evaluate(() => {
      const router = (
        window as unknown as {
          __TSR_ROUTER__: { navigate: (options: { to: string }) => unknown }
        }
      ).__TSR_ROUTER__
      void router.navigate({ to: '/accounts' })
    })

    // The window the issue is about: the guard is in flight and its fallback is on screen.
    await expect(page).toHaveURL(/\/accounts/)
    await expect(page.getByRole('main').getByRole('status')).toBeVisible()
    await expect(email).toBeHidden()
  } finally {
    await held.release()
  }

  await expect(page).toHaveURL(/\/login\?redirect=/)
  await expect(email).toBeVisible()
})
