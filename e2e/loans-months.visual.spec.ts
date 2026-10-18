import { expect, test } from './support/console'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'

/**
 * `/loans/months`: axe plus the claims the screen is for — a year×month grid and a chart
 * whose text equivalent is a real table. Demo seed only; no owner figures.
 */

test.use({ storageState: storageStateFor('demo') })

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`month overview has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      await gotoApp(page, '/loans/months')

      await expect(page.getByRole('table').first()).toBeVisible()
      await expectNoSeriousViolations(
        page,
        `/loans/months (${theme}, ${locale})`,
      )
    })
  }
}

test('the grid starts at 2025 and the chart has a text table', async ({
  page,
}) => {
  await gotoApp(page, '/loans/months')

  const grid = page.getByRole('table', {
    name: /Paid and remaining instalments by month and year/i,
  })
  await expect(grid).toBeVisible()
  await expect(grid.getByRole('rowheader', { name: '2025' })).toBeVisible()
  await expect(grid.getByRole('rowheader', { name: '2026' })).toBeVisible()
  await expect(page.getByText('Overdue').first()).toBeVisible()

  const chart = page.getByRole('table', { name: /Obligations in 2026/i })
  await expect(chart).toBeAttached()
})

test('Wszystko / Firma / Prywatne is a book filter, not a second register', async ({
  page,
}) => {
  await gotoApp(page, '/loans/months')
  await page.getByRole('radio', { name: 'Business' }).click()
  await expect(page).toHaveURL(/book=business/)
  await expect(page.getByRole('table').first()).toBeVisible()
})
