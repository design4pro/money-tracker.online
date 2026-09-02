import { expect, test } from '@playwright/test'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'
import type { Page } from '@playwright/test'

/**
 * `/budgets/$budgetId`: the axe gate `12-S4` sets, and the two tables that make this screen
 * readable without pixels.
 *
 * The route is reached by **clicking** rather than by a hard-coded id. A demo id in a spec is a
 * spec that starts failing the day `scripts/seed/seed.mjs` renames a row, for a reason that has
 * nothing to do with the screen under test.
 */

test.use({ storageState: storageStateFor('demo') })

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

/**
 * Opens the first budget on the list and waits for the detail screen to actually be the one on
 * screen.
 *
 * Waiting on the URL rather than on a meter is deliberate: the list has meters of its own, so an
 * assertion that one is visible is satisfied by the page the click is navigating *away* from, and
 * every assertion after it would run against the list.
 */
async function openFirstBudget(page: Page): Promise<void> {
  await gotoApp(page, '/budgets')

  const link = page.locator('a[href^="/budgets/"]').first()
  await expect(link).toBeVisible()
  const href = await link.getAttribute('href')
  await link.click()

  await page.waitForURL(`**${href}`)
  await expect(page.getByRole('table').first()).toBeVisible()
}

/** The rollover ledger, told apart from the timeline's data table by a column only it has. */
function rollverLedgerOf(page: Page) {
  return page.getByRole('table').filter({ hasText: 'Carried out' })
}

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`budget detail has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      await openFirstBudget(page)

      await expectNoSeriousViolations(
        page,
        `/budgets/$budgetId (${theme}, ${locale})`,
      )
    })
  }
}

test('the rollover ledger is a real table, with a caption and a header on both axes', async ({
  page,
}) => {
  await openFirstBudget(page)

  const ledger = rollverLedgerOf(page)
  await expect(ledger).toBeVisible()

  // Six columns: Period · Limit · Carried in · Spent · Carried out · Status.
  await expect(ledger.getByRole('columnheader')).toHaveCount(6)
  // One row header per period, so a cell is announced with the period it belongs to.
  expect(await ledger.getByRole('rowheader').count()).toBeGreaterThan(0)
  await expect(ledger.locator('caption')).toHaveCount(1)
})

test('the timeline ships its numbers as a table as well as as bars', async ({
  page,
}) => {
  await openFirstBudget(page)

  // `docs/ACCESSIBILITY.md`: every chart ships a visually-hidden data table. The detail screen
  // therefore carries at least two tables — the chart's and the ledger's.
  expect(await page.getByRole('table').count()).toBeGreaterThanOrEqual(2)
})

test('the actions menu is reachable from the keyboard and names its budget', async ({
  page,
}) => {
  await openFirstBudget(page)

  const actions = page.getByRole('button', { name: /Actions for/i }).first()
  await expect(actions).toBeVisible()
  await actions.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()

  // Escape closes it and puts focus back where it came from, which is the whole contract of a
  // menu trigger — `focus-restoration.spec.ts` holds the same line for dialogs.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(actions).toBeFocused()
})
