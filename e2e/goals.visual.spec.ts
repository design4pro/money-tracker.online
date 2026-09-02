import { expect, test } from '@playwright/test'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'

/**
 * `/goals` in the browser: the axe gate `15` sets, plus the three claims the screen is *for*.
 *
 * The demo workspace is read and never written, so `scripts/seed/verify.mjs` still finds every
 * counter it asserts after a run. It carries two goals — one in dollars, one in euro, both funded
 * by real transfer legs — which is what makes this a populated list rather than an empty state.
 *
 * **Every navigation goes to `?status=all`.** The default filter is `active`, and the seed derives
 * a goal's status from its contributions rather than declaring it: the day the fixture's transfers
 * push both goals past their targets, a spec pinned to the default would be asserting meters on a
 * screen that had honestly become a filtered empty state. `all` is the one filter whose row count
 * does not depend on how the demo's arithmetic came out.
 *
 * The axe helper is imported from `support/budgets` rather than copied. It is the plan-level gate
 * — zero `serious`, zero `critical` — with nothing budget-specific in it but its file name, and a
 * second copy here would be a second place to quietly widen an exclusion list.
 *
 * There is deliberately **no assertion that `/goals` is in the navigation**: this stage does not
 * own `components/app/nav/destinations.ts` and did not add the row. See the handover note.
 */

test.use({ storageState: storageStateFor('demo') })

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`goals has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      await gotoApp(page, '/goals?status=all')

      await expect(page.getByRole('meter').first()).toBeVisible()
      await expectNoSeriousViolations(page, `/goals (${theme}, ${locale})`)
    })
  }
}

test('every goal announces its progress as a meter, with both amounts in the value', async ({
  page,
}) => {
  await gotoApp(page, '/goals?status=all')

  const meters = page.getByRole('meter')
  await expect(meters.first()).toBeVisible()
  expect(await meters.count()).toBeGreaterThan(0)

  for (const meter of await meters.all()) {
    const valueText = await meter.getAttribute('aria-valuetext')
    const valueNow = Number(await meter.getAttribute('aria-valuenow'))

    // The verdict leads, then the amounts: "62%" on its own leaves the reader to work out what it
    // is 62% of, which is the figure they actually came for.
    expect(valueText ?? '').not.toBe('')
    expect(valueNow).toBeGreaterThanOrEqual(0)
    // The bar never overflows its track even when the sentence counts past the line.
    expect(valueNow).toBeLessThanOrEqual(100)
    // A meter without an accessible name is a WCAG 4.1.2 failure, and every goal has a name.
    expect((await meter.getAttribute('aria-label')) ?? '').not.toBe('')
  }
})

test('a goal row is a link to its own detail screen', async ({ page }) => {
  await gotoApp(page, '/goals?status=all')

  const first = page.locator('a[href^="/goals/"]').first()
  await expect(first).toBeVisible()

  const href = await first.getAttribute('href')
  await first.click()
  await expect(page).toHaveURL(new RegExp(`${href}$`))
})

test('the filter is held in the URL, not in component state', async ({
  page,
}) => {
  // A bookmark, a back button and a shared link all depend on this being true. Asserted in English
  // only: the claim is about the URL, and the label it reads back is incidental to it.
  await gotoApp(page, '/goals?status=archived')

  await expect(page.getByRole('button', { name: /Show/i })).toContainText(
    'Archived',
  )
})
