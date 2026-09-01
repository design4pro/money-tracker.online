import { expect, test } from '@playwright/test'

import { mountFocusHarness } from './support/mount-harness'

/**
 * Escape closes an overlay and puts focus back on the control that opened it.
 *
 * These three assertions started life in the jsdom component suite, where they
 * cannot be made honestly: React Aria's `FocusScope` restores focus through a
 * path jsdom does not implement, so `document.activeElement` ends up on
 * `<body>` there even though every real browser puts it back on the trigger.
 * Asserting `<body>` would have been asserting the bug; deleting them would
 * have dropped the one behaviour that decides whether a keyboard user can carry
 * on after closing a menu, a select or a modal, or is dumped at the top of the
 * document with nothing announced.
 *
 * So they live here, in Chromium and WebKit, against the real components. The
 * jsdom suites keep the half they can prove (the overlay closes, the selection
 * is unchanged) and point at this file for the other half.
 */
test.describe('focus restoration on Escape', () => {
  test.skip(
    ({ isMobile }) => isMobile,
    'A keyboard-only behaviour: the mobile project has no hardware keyboard.',
  )

  test.beforeEach(async ({ page }) => {
    await mountFocusHarness(page)
  })

  test('a menu returns focus to its trigger', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Actions' })

    await trigger.click()
    await expect(page.getByRole('menu')).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    // The restored focus is live, not merely a matching element: the very next
    // keypress works on the trigger the user is standing on.
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
  })

  test('a select returns focus to its trigger, with the value unchanged', async ({
    page,
  }) => {
    const trigger = page.getByRole('button', { name: /Account/ })

    await trigger.click()
    await expect(page.getByRole('listbox')).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(trigger).toBeFocused()
    // Escape cancels: the placeholder is still what the trigger reports.
    await expect(trigger).toContainText('Pick one')
  })

  test('a modal dialog returns focus to its trigger', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Open' })

    await trigger.click()
    await expect(
      page.getByRole('dialog', { name: 'Delete transaction' }),
    ).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })
})
