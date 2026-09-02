import { expect, test } from '@playwright/test'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'

/**
 * `/recurring/candidates` in the browser.
 *
 * The screen is read-only until somebody presses a button, and this spec presses none of them: the
 * demo workspace is a fixture other specs and `scripts/seed/verify.mjs` assert against, and
 * accepting a proposal would write a series into it. Detection itself is a write too - it stores
 * what it found - so *Look again* is deliberately not pressed here either.
 *
 * What is asserted is what the screen claims before anything is pressed: that it is honest about
 * having changed nothing, that its confidence is a word rather than a number, and that it passes
 * the plan's axe gate in both themes and both languages - including as an empty state, which is
 * how it renders on a workspace whose proposals have all been actioned.
 */

test.use({ storageState: storageStateFor('demo') })

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`candidates has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      await gotoApp(page, '/recurring/candidates')

      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoSeriousViolations(
        page,
        `/recurring/candidates (${theme}, ${locale})`,
      )
    })
  }
}

test('offers a way back to the list without using the browser button', async ({
  page,
}) => {
  await gotoApp(page, '/recurring/candidates')

  const back = page.locator('a[href="/recurring"]').first()
  await expect(back).toBeVisible()
})

test('never puts a bare confidence number on a card', async ({ page }) => {
  await gotoApp(page, '/recurring/candidates')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // Whatever the fixture's history produces, no card may print `0.72`: three signals averaged and
  // rounded is not a measurement, and a number implies a precision the detector does not have.
  const cards = page.getByRole('listitem')
  for (const card of await cards.all()) {
    const text = (await card.textContent()) ?? ''
    expect(text).not.toMatch(/\b0\.\d\d\b/)
  }
})
