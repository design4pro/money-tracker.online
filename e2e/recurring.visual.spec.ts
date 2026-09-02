import { expect, test } from '@playwright/test'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'

/**
 * `/recurring` and one series' detail in the browser: the axe gate plan `13` sets, plus the claims
 * the two screens are *for*.
 *
 * The demo workspace is read and never written, so `scripts/seed/verify.mjs` still finds every
 * counter it asserts after a run. It carries three series - Netflix, Tauron and a salary - chosen
 * so the period table shows all four of its statuses, which is what makes this a populated screen
 * rather than an empty state.
 *
 * **Every navigation goes to `?status=all`.** The default filter is `active`, and a spec pinned to
 * the default would be asserting rows on a screen that had honestly become a filtered empty state
 * the day the fixture completed a series.
 *
 * The axe helper is imported from `support/budgets` rather than copied. It is the plan-level gate
 * - zero `serious`, zero `critical` - with nothing budget-specific in it but its file name, and a
 * second copy here would be a second place to quietly widen an exclusion list.
 *
 * There is deliberately **no assertion that `/recurring` is in the navigation**: this stage does
 * not own `components/app/nav/destinations.ts` and did not add the row. See the handover note.
 */

test.use({ storageState: storageStateFor('demo') })

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`recurring has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      await gotoApp(page, '/recurring?status=all')

      await expect(page.locator('a[href^="/recurring/"]').first()).toBeVisible()
      await expectNoSeriousViolations(page, `/recurring (${theme}, ${locale})`)
    })

    test(`a series detail has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      await gotoApp(page, '/recurring/demo-rec-1')

      await expect(page.getByRole('heading', { name: 'Netflix' })).toBeVisible()
      await expectNoSeriousViolations(
        page,
        `/recurring/demo-rec-1 (${theme}, ${locale})`,
      )
    })
  }
}

test('a series row is a link to its own detail screen', async ({ page }) => {
  await gotoApp(page, '/recurring?status=all')

  const first = page.locator('a[href^="/recurring/demo-rec"]').first()
  await expect(first).toBeVisible()
  const href = await first.getAttribute('href')
  expect(href ?? '').toMatch(/^\/recurring\/demo-rec-\d+$/)

  await first.click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(page.url()).toContain(href ?? '')
})

test('what is due is said in words, not carried by a colour', async ({
  page,
}) => {
  await gotoApp(page, '/recurring?status=all')

  // The due-soon table prints a status word in its own cell on every row. Which word depends on
  // where the fixture's dates fall relative to the day the suite runs, so the assertion is that
  // one of the four is there - a row carrying its state only as a tint would match none of them
  // and leave a greyscale reader with nothing.
  const table = page
    .getByRole('region', { name: 'Due soon' })
    .getByRole('table')
  await expect(table).toBeVisible()
  const rows = await table.getByRole('row').allTextContents()
  expect(rows.length).toBeGreaterThan(1)
  for (const row of rows.slice(1)) {
    expect(row).toMatch(/Upcoming|Overdue|Paid|Skipped/)
  }

  // And every series card says where its next period stands as a sentence, not as a bare date the
  // reader has to compare against today in their head.
  const cards = await page
    .getByRole('main')
    .getByRole('listitem')
    .allTextContents()
  expect(cards.length).toBeGreaterThan(0)
  for (const card of cards) {
    expect(card).toMatch(/Due |overdue|Nothing outstanding/)
  }
})

test('the period history is a real table a keyboard can reach', async ({
  page,
}) => {
  await gotoApp(page, '/recurring/demo-rec-1')

  const table = page.getByRole('table').first()
  await expect(table).toBeVisible()
  // Every row is headed by its due date: three identical "Mark paid" rows are otherwise three
  // identical announcements.
  expect(await page.getByRole('rowheader').count()).toBeGreaterThan(0)

  // The scroll container is focusable and named, or its off-screen columns are unreachable
  // without a pointer (WCAG 2.1.1, axe `scrollable-region-focusable`).
  const region = page.getByRole('region').first()
  await expect(region).toHaveAttribute('tabindex', '0')
})

test('every period row action names the date it acts on', async ({ page }) => {
  await gotoApp(page, '/recurring/demo-rec-1')

  const markPaid = page.getByRole('button', { name: /^Mark the period due/ })
  expect(await markPaid.count()).toBeGreaterThan(0)
  // Two rows, two different names: the accessible name carries the row's date.
  const names = await markPaid.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''),
  )
  expect(new Set(names).size).toBe(names.length)
})
