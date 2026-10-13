import AxeBuilder from '@axe-core/playwright'

import { expect, test } from './support/console'

import { mountHarness } from './support/mount-harness'

import type { Page } from '@playwright/test'

/**
 * A tall menu keeps every item reachable, and an open menu raises no
 * `scrollable-region-focusable` finding (#728, found on the groups screen in #701).
 *
 * The primitive used to cap itself at 320px, which is 6.7 rows at the 48px row height, so the
 * eighth item of a row menu sat below the fold and the capped box scrolled. A scrolling box whose
 * items are all `tabindex="-1"` (which is what the parent menu is while a submenu holds focus) is
 * exactly what axe reports. The cap is now whatever room React Aria leaves the popover, so a menu
 * that fits is never a scroll container. jsdom lays nothing out, so none of this can be asserted
 * in `menu.test.tsx`.
 */
test.describe('menu height', () => {
  test.skip(
    ({ isMobile }) => isMobile,
    'The viewport is set per case here; the mobile project adds touch emulation, not a layout.',
  )

  const viewports = [
    { name: '360px', width: 360, height: 640 },
    { name: '1280px', width: 1280, height: 800 },
  ] as const

  async function openMenu(page: Page) {
    await mountHarness(page, 'menu-harness.tsx', { title: 'Menu harness' })
    await page.getByRole('button', { name: 'Actions' }).click()
    await expect(page.getByRole('menu', { name: 'Actions' })).toBeVisible()
  }

  for (const viewport of viewports) {
    test(`an eight-item menu shows every item without scrolling at ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      })
      await openMenu(page)

      const menu = page.getByRole('menu', { name: 'Actions' })
      const { scrollHeight, clientHeight } = await menu.evaluate((node) => ({
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      }))
      expect(scrollHeight).toBeLessThanOrEqual(clientHeight)

      const last = page.getByRole('menuitem', { name: 'Delete group' })
      const box = await last.boundingBox()
      expect(box).not.toBeNull()
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
        viewport.height,
      )
    })
  }

  test('an open submenu raises no scrollable-region-focusable finding', async ({
    page,
  }) => {
    await openMenu(page)
    await page.getByRole('menuitem', { name: 'Move to' }).click()
    await expect(page.getByRole('menu', { name: 'Move to' })).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withRules(['scrollable-region-focusable'])
      .analyze()

    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })

  test('in a viewport too short for the menu, the last item is still reachable from the keyboard', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 280 })
    await openMenu(page)

    await page.keyboard.press('End')

    const last = page.getByRole('menuitem', { name: 'Delete group' })
    await expect(last).toBeFocused()
    await expect(last).toBeInViewport()
  })
})
