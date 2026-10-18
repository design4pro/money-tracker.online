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
