import AxeBuilder from '@axe-core/playwright'

import { expect, test } from './support/console'

import { mountHarness } from './support/mount-harness'

/**
 * The toast close button passes axe and meets the target size (#730, found on the groups screen
 * in #701).
 *
 * jsdom lays nothing out and runs no axe, so neither the 44px target nor `role-img-alt` can be
 * asserted in `toast.test.tsx`; this runs the real component on the real tokens in a browser.
 */
test.describe('toast close button', () => {
  test.skip(
    ({ isMobile }) => isMobile,
    'The viewport is set per case here; the mobile project adds touch emulation, not a layout.',
  )

  const viewports = [
    { name: '360px', width: 360, height: 640 },
    { name: '1280px', width: 1280, height: 800 },
  ] as const
  const schemes = ['dark', 'light'] as const
  const locales = [
    { locale: 'en', dir: 'ltr', name: 'Close' },
    { locale: 'pl', dir: 'ltr', name: 'Zamknij' },
    { locale: 'en', dir: 'rtl', name: 'Close' },
  ] as const

  for (const viewport of viewports) {
    for (const scheme of schemes) {
      for (const { locale, dir, name } of locales) {
        test(`a visible toast passes axe and the close button is a 44px box inside the toast at ${viewport.name}, ${scheme}, ${locale} ${dir}`, async ({
          page,
        }) => {
          await page.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          })
          await page.emulateMedia({
            colorScheme: scheme,
            reducedMotion: 'reduce',
          })
          await mountHarness(page, 'toast-harness.tsx', {
            title: 'Toast harness',
            lang: locale,
            globals: { locale, dir },
          })

          const close = page.getByRole('button', { name, exact: true })
          await expect(close).toBeVisible()

          const toast = page.locator('[data-sonner-toast]')
          const surface = await toast.evaluate((node) => {
            const probe = document.createElement('div')
            probe.style.cssText =
              'background:var(--color-surface-raised);border:1px solid var(--color-border-subtle);border-radius:var(--radius-lg);padding:calc(var(--spacing) * 3.5);color:var(--color-ink)'
            document.body.appendChild(probe)
            const actual = getComputedStyle(node)
            const expected = getComputedStyle(probe)
            const properties = [
              'background-color',
              'border-top-color',
              'border-top-width',
              'border-top-style',
              'border-top-left-radius',
              'padding-top',
            ]
            const measured = {
              actual: properties.map((property) =>
                actual.getPropertyValue(property),
              ),
              expected: properties.map((property) =>
                expected.getPropertyValue(property),
              ),
              title: getComputedStyle(node.querySelector('[data-title]')!)
                .color,
              ink: expected.color,
            }
            probe.remove()
            return measured
          })
          expect(surface.actual).toEqual(surface.expected)
          expect(surface.title).toBe(surface.ink)
          const [box, toastBox] = await Promise.all([
            close.boundingBox(),
            toast.boundingBox(),
          ])
          expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

          // Entirely inside the toast, at its inline-end top corner: none of the box is off-screen
          // and no neighbouring toast shares its pixels.
          const toastLeft = toastBox?.x ?? 0
          const toastRight = toastLeft + (toastBox?.width ?? 0)
          const left = box?.x ?? 0
          const right = left + (box?.width ?? 0)
          expect(left).toBeGreaterThanOrEqual(toastLeft)
          expect(right).toBeLessThanOrEqual(toastRight)
          expect(
            dir === 'rtl' ? left - toastLeft : toastRight - right,
          ).toBeLessThanOrEqual(1)
          expect(box?.y ?? 0).toBeGreaterThanOrEqual(toastBox?.y ?? 0)

          // The title never runs under the box.
          const title = await page
            .locator('[data-title]')
            .evaluate((node) => node.getBoundingClientRect().toJSON())
          expect(
            dir === 'rtl' ? title.left - right : left - title.right,
          ).toBeGreaterThanOrEqual(0)

          const results = await new AxeBuilder({ page })
            .withRules(['role-img-alt', 'target-size'])
            .analyze()
          expect(results.violations.map((violation) => violation.id)).toEqual(
            [],
          )
        })
      }
    }
  }

  test('the toast card retains its visible keyboard focus cue', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await mountHarness(page, 'toast-harness.tsx', { title: 'Toast harness' })

    const card = page.locator('[data-sonner-toast]')
    await expect(card).toBeVisible()
    const restingShadow = await card.evaluate(
      (node) => getComputedStyle(node).boxShadow,
    )
    await card.focus()
    await expect(card).toBeFocused()
    await expect
      .poll(() => card.evaluate((node) => getComputedStyle(node).boxShadow))
      .not.toBe(restingShadow)
  })

  test('a keyboard user reaches the close button, sees a focus ring and dismisses with Enter', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await mountHarness(page, 'toast-harness.tsx', { title: 'Toast harness' })

    const close = page.getByRole('button', { name: 'Close', exact: true })
    await close.focus()
    await expect(close).toBeFocused()
    // The product's outline (`focus-ring`), not sonner's faint box-shadow.
    await expect(close).toHaveCSS('outline-style', 'solid')

    await page.keyboard.press('Enter')
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  })
})
