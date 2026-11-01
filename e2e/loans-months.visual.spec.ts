import { DELIBERATE_SERVER_FAILURE, expect, test } from './support/console'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'
import { failServerFns, holdEveryServerFn } from './support/states'

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
  await page
    .getByRole('radiogroup', { name: 'Book' })
    .getByText('Business', { exact: true })
    .click()
  await expect(page).toHaveURL(/book=business/)
  await expect(page.getByRole('radio', { name: 'Business' })).toBeChecked()
  await expect(page.getByRole('table').first()).toBeVisible()
})

test('keeps horizontal scrolling inside the keyboard-accessible month grid', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await gotoApp(page, '/loans/months')

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  const scroller = page.getByRole('region', {
    name: 'Month overview',
    exact: true,
  })
  await scroller.focus()
  await expect(scroller).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0)
})

test('keeps the loading view within the mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await gotoApp(page, '/loans')
  const held = await holdEveryServerFn(page)
  try {
    await page
      .getByRole('link', { name: 'Month overview', exact: true })
      .click()
    await expect(
      page.getByText('Loading the month overview…', { exact: true }),
    ).toBeAttached()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  } finally {
    await held.release()
  }
})

test('retries the failed calendar read after the service recovers', async ({
  page,
  expectConsole,
}) => {
  await gotoApp(page, '/loans/months')
  expectConsole([
    ...DELIBERATE_SERVER_FAILURE,
    {
      why: 'the production router logs the exact failure this test injects',
      match: /^deliberate failure from e2e\/support\/states\.ts$/,
    },
  ])
  const failing = await failServerFns(page)
  try {
    await page
      .getByRole('radiogroup', { name: 'Book' })
      .getByText('Business', { exact: true })
      .click()
    await expect(
      page.getByRole('heading', {
        name: 'The month overview could not be loaded',
      }),
    ).toBeVisible()
  } finally {
    await failing.release()
  }
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Month overview', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Business' })).toBeChecked()
})

test('gives both calendar navigation links a full touch target', async ({
  page,
}) => {
  await gotoApp(page, '/loans')
  const overview = page.getByRole('link', {
    name: 'Month overview',
    exact: true,
  })
  expect(
    await overview.evaluate(
      (element) => element.getBoundingClientRect().height,
    ),
  ).toBeGreaterThanOrEqual(44)
  await overview.click()
  const back = page.getByRole('link', { name: 'All liabilities', exact: true })
  await expect(back).toBeVisible()
  expect(
    await back.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44)
  await back.click()
  await expect(page).toHaveURL(/\/loans(?:\?|$)/)
})
