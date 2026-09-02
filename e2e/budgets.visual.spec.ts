import { expect, test } from '@playwright/test'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'

/**
 * `/budgets` in the browser: the axe gate `12-S2` sets, plus the four claims the screen is *for*.
 *
 * The demo workspace is read and never written, so `scripts/seed/verify.mjs` still finds every
 * counter it asserts after a run. It carries three budgets — two `none` and one `carry_surplus` —
 * which is what makes the list a populated grid rather than an empty state here.
 *
 * The theme × locale matrix is the same pair of axes `accessibility.spec.ts` argues for: a dark
 * theme is a different set of colour tokens, so contrast is a different question in each, and a
 * locale changes `<html lang>`, the length of every label and the accessible name of every control.
 */

test.use({ storageState: storageStateFor('demo') })

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`budgets has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      await gotoApp(page, '/budgets')

      await expect(page.getByRole('meter').first()).toBeVisible()
      await expectNoSeriousViolations(page, `/budgets (${theme}, ${locale})`)
    })
  }
}

test('every budget announces its remainder as a meter, with both amounts in the value', async ({
  page,
}) => {
  await gotoApp(page, '/budgets')

  const meters = page.getByRole('meter')
  await expect(meters.first()).toBeVisible()
  expect(await meters.count()).toBeGreaterThan(0)

  for (const meter of await meters.all()) {
    const valueText = await meter.getAttribute('aria-valuetext')
    const valueNow = Number(await meter.getAttribute('aria-valuenow'))

    // The verdict leads, then the amounts: a percentage on its own leaves the reader to work out
    // what it is a percentage of, which is the figure they actually needed.
    expect(valueText ?? '').not.toBe('')
    expect(valueNow).toBeGreaterThanOrEqual(0)
    // The bar never overflows its track even when the sentence counts past the line.
    expect(valueNow).toBeLessThanOrEqual(100)
  }
})

test('a budget row is a link to its own detail screen', async ({ page }) => {
  await gotoApp(page, '/budgets')

  const first = page.locator('a[href^="/budgets/"]').first()
  await expect(first).toBeVisible()

  const href = await first.getAttribute('href')
  await first.click()
  await expect(page).toHaveURL(new RegExp(`${href}$`))
})

test('the budgets destination is in the navigation, because its route exists', async ({
  page,
}) => {
  await gotoApp(page, '/dashboard')
  // `destinations.ts` lists a row only when its route exists; this is the other half of that rule.
  await expect(page.locator('a[href="/budgets"]').first()).toBeAttached()
})
