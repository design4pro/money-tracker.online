import { expect, test } from './support/console'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'

/**
 * `/loans` and one liability's detail: axe plus the claims the screens are for.
 *
 * The demo workspace is read and never written. It carries three synthetic liabilities (Studio
 * lease, Equipment credit, Workshop loan) so the list is populated rather than empty.
 */

test.use({ storageState: storageStateFor('demo') })

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`loans has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      await gotoApp(page, '/loans?status=all')

      await expect(page.getByRole('meter').first()).toBeVisible()
      await expectNoSeriousViolations(page, `/loans (${theme}, ${locale})`)
    })

    test(`a liability detail has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      await gotoApp(page, '/loans/demo-loan-1')

      await expect(
        page.getByRole('heading', { name: 'Studio lease' }),
      ).toBeVisible()
      await expectNoSeriousViolations(
        page,
        `/loans/demo-loan-1 (${theme}, ${locale})`,
      )
    })
  }
}

test('every liability announces progress as a meter with amounts, not a bare percent', async ({
  page,
}) => {
  await gotoApp(page, '/loans?status=all')

  const meters = page.getByRole('meter')
  await expect(meters.first()).toBeVisible()
  expect(await meters.count()).toBeGreaterThan(0)

  for (const meter of await meters.all()) {
    const valueText = await meter.getAttribute('aria-valuetext')
    const valueNow = Number(await meter.getAttribute('aria-valuenow'))
    expect(valueText ?? '').not.toBe('')
    expect(valueText ?? '').not.toMatch(/^[\d.,\s]+%$/)
    expect(valueNow).toBeGreaterThanOrEqual(0)
    expect(valueNow).toBeLessThanOrEqual(100)
    expect((await meter.getAttribute('aria-label')) ?? '').not.toBe('')
  }
})

test('a liability row is a link to its own schedule', async ({ page }) => {
  await gotoApp(page, '/loans?status=all')

  const first = page.locator('a[href^="/loans/demo-loan"]').first()
  await expect(first).toBeVisible()
  const href = await first.getAttribute('href')
  expect(href ?? '').toMatch(/^\/loans\/demo-loan-\d+$/)

  await first.click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(page.url()).toContain(href ?? '')
  await expect(page.getByRole('table')).toBeVisible()
})

test('overdue is a word on the list, not a colour alone', async ({ page }) => {
  await gotoApp(page, '/loans?status=all')
  await expect(page.getByText('Overdue').first()).toBeVisible()
})

for (const width of [320, 360]) {
  test(`Polish schedule reflows and actions remain reachable at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await useLocale(context, 'pl')
    await gotoApp(page, '/loans/demo-loan-1')
    const region = page.getByRole('region', { name: 'Harmonogram rat' })
    await expect(region).toBeVisible()
    const layout = await region.evaluate((node) => ({
      width: node.clientWidth,
      scroll: node.scrollWidth,
      rowDisplay: getComputedStyle(node.querySelector('tbody tr') as Element)
        .display,
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }))
    expect(layout.rowDisplay).toBe('block')
    expect(layout.scroll).toBeLessThanOrEqual(layout.width)
    expect(layout.document).toBeLessThanOrEqual(layout.viewport)
    const action = region.getByRole('button').first()
    await expect(action).toBeVisible()
    const bounds = await action.boundingBox()
    expect(bounds).not.toBeNull()
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width)
    await action.click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })
}

test.describe('empty liability register', () => {
  test.use({ storageState: storageStateFor('empty') })

  test('keeps the closed-liabilities filter reachable with no active loans', async ({
    page,
  }) => {
    await gotoApp(page, '/loans')
      const status = page.getByRole('radio', { name: 'All, including closed' })
      await status.focus()
      await status.press('Space')
    await expect(page).toHaveURL(/status=all/)
  })
})
