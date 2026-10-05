import { expect, test } from './support/console'

import { gotoApp, uniqueToken } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { d1Query, organizationIdFor, sqlText } from './support/d1'
import {
  RECURRING_FIXTURE_AMOUNT_MINOR,
  deleteRecurringFixture,
  installRecurringFixture,
} from './support/fixtures'
import { TENANT_A, storageStateFor } from './support/session'

import type { Page } from '@playwright/test'

/**
 * Settling a recurring period from where it is read, and the way out of an empty picker.
 *
 * The write flows run as the fixture tenant and not the demo workspace (which is read
 * and never written - `scripts/seed/verify.mjs` asserts its counters). Each test takes its own
 * periods, a month or more from every other test's, because the mark-paid picker looks a fortnight
 * either side of a due date and two tests sharing a window would see each other's payments.
 *
 * The write flows run on the desktop project only. Two projects settling the same dates in one
 * workspace at the same time is a race the dates cannot avoid, and what the phone layout adds - the
 * table scrolling in its own region - is read-only and covered by the last two tests, which run
 * everywhere.
 */

/** The route the person is on, as a path with its query string. */
function here(page: Page): string {
  const url = new URL(page.url())
  return `${url.pathname}${url.search}`
}

async function installFor(token: string, periods: ReadonlyArray<string>) {
  const organizationId = await organizationIdFor(TENANT_A.email)
  expect(organizationId, 'the fixture tenant has a workspace').not.toBeNull()
  return installRecurringFixture(organizationId as string, token, periods)
}

test.describe('write flows', () => {
  test.use({ storageState: storageStateFor('tenant-a') })

  test.skip(
    ({ browserName, isMobile }) => browserName !== 'chromium' || isMobile,
    'two projects would settle the same dates in one workspace at once',
  )

  test('skips a period and opens mark paid from the list, never visiting the series', async ({
    page,
  }) => {
    const periods = ['2026-08-25', '2026-09-10']
    const fixture = await installFor(uniqueToken('skip'), periods)
    try {
      await gotoApp(page, '/recurring')

      // The series also has a row in the series table; only a period's row has the actions.
      const row = (name: string) =>
        page
          .getByRole('row')
          .filter({ hasText: name })
          .filter({
            has: page.getByRole('button', { name: /^Mark paid, period due/ }),
          })
      await expect(row(fixture.seriesName)).toHaveCount(2)

      // Skip the first period from its own row.
      await row(fixture.seriesName)
        .first()
        .getByRole('button', { name: /^Skip, period due/ })
        .click()
      await expect(row(fixture.seriesName)).toHaveCount(1)

      // Mark paid opens the dialog on the other one, and the picker has nothing to offer.
      await row(fixture.seriesName)
        .getByRole('button', { name: /^Mark paid, period due/ })
        .click()
      const dialog = page.getByRole('dialog')
      await expect(
        dialog.getByRole('heading', { name: 'Mark this period paid' }),
      ).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: 'Record the payment' }),
      ).toBeVisible()
      await expectNoSeriousViolations(
        page,
        '/recurring, empty mark-paid picker',
      )

      // Never left the list: the series detail route was not visited.
      expect(here(page)).toMatch(/^\/recurring(\?|$)/)
    } finally {
      await deleteRecurringFixture(fixture, periods)
    }
  })

  test('empty picker, entry form, save, picker reopened on the list, then link', async ({
    page,
  }) => {
    const periods = ['2026-06-01']
    const fixture = await installFor(uniqueToken('list'), periods)
    try {
      await gotoApp(page, '/recurring')
      const row = page.getByRole('row').filter({ hasText: fixture.seriesName })
      await row.getByRole('button', { name: /^Mark paid, period due/ }).click()

      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Record the payment' }).click()

      // The entry form arrives started from the period: the amount is the series' own, in minor
      // units of a currency with no decimals - 1,500 yen, never 15.00 and never 150,000.
      await expect(page).toHaveURL(/\/transactions\/new\?/)
      const amount = page.getByRole('textbox', { name: 'Amount' })
      await expect(amount).toBeVisible()
      await expect(amount).toHaveValue(/^1\D?500$/)
      await page.getByRole('button', { name: 'Save', exact: true }).click()

      // Back on the list, with the picker reopened on the same period and the new payment in it.
      await expect(page).toHaveURL(/\/recurring\?/)
      const reopened = page.getByRole('dialog')
      await expect(
        reopened.getByRole('heading', { name: 'Mark this period paid' }),
      ).toBeVisible()
      await reopened.locator('label').first().click()
      await reopened.getByRole('button', { name: 'Link it' }).click()

      await expect(reopened).toBeHidden()
      await expect(row).toHaveCount(0)

      // The payment is stored in the currency's own minor units, and the period points at it.
      const [settled] = await d1Query(
        `select p.status as status, t.amount_minor as amount, t.booked_on as booked ` +
          `from recurring_periods p join transactions t on t.id = p.settled_transaction_id ` +
          `where p.series_id = ${sqlText(fixture.seriesId)}`,
      )
      expect(settled).toEqual({
        status: 'paid',
        amount: RECURRING_FIXTURE_AMOUNT_MINOR,
        booked: '2026-06-01',
      })
      // The address was cleaned: a reload does not reopen the dialog.
      expect(here(page)).not.toContain('markPaid')
    } finally {
      await deleteRecurringFixture(fixture, periods)
    }
  })

  test('the same route out from the series detail comes back to the series', async ({
    page,
  }) => {
    const periods = ['2026-04-01']
    const fixture = await installFor(uniqueToken('detail'), periods)
    try {
      await gotoApp(page, `/recurring/${fixture.seriesId}`)
      await page.getByRole('button', { name: /^Mark paid, period due/ }).click()
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Record the payment' })
        .click()

      await expect(page).toHaveURL(/\/transactions\/new\?/)
      await page.getByRole('button', { name: 'Save', exact: true }).click()

      await expect(page).toHaveURL(
        new RegExp(`/recurring/${fixture.seriesId}\\?markPaid=2026-04-01`),
      )
      const dialog = page.getByRole('dialog')
      await expect(
        dialog.getByRole('heading', { name: 'Mark this period paid' }),
      ).toBeVisible()
      await dialog.locator('label').first().click()
      await dialog.getByRole('button', { name: 'Link it' }).click()

      await expect(dialog).toBeHidden()
      await expect(page.getByRole('cell', { name: 'Paid' })).toBeVisible()
    } finally {
      await deleteRecurringFixture(fixture, periods)
    }
  })

  test('the planned screen lists an unsettled period as an expectation and skips it', async ({
    page,
  }) => {
    const periods = ['2026-01-01']
    const fixture = await installFor(uniqueToken('plannedskip'), periods)
    try {
      await gotoApp(page, '/transactions/planned')

      const group = page.getByRole('region', {
        name: /^Expected in the next \d+ days$/,
      })
      await expect(group).toBeVisible()
      await expect(
        group.getByText(
          'Not yet money. Expected payments are never added to the totals.',
        ),
      ).toBeVisible()
      const row = group.getByRole('row').filter({ hasText: fixture.seriesName })
      // Long past, so it is overdue; the status is a word, and the row cannot be selected.
      await expect(row.getByText('Overdue')).toBeVisible()
      await expect(row.getByRole('checkbox')).toHaveCount(0)
      await expectNoSeriousViolations(page, '/transactions/planned, expected')

      await row.getByRole('button', { name: /^Skip, period due/ }).click()
      await expect(row).toHaveCount(0)
      // Focus is not left on <body>: it moved to a row of the group or to its heading.
      await expect(page.locator('body')).not.toBeFocused()
    } finally {
      await deleteRecurringFixture(fixture, periods)
    }
  })

  test('the planned screen: mark paid, entry form, save, picker reopened here, then link', async ({
    page,
  }) => {
    const periods = ['2026-02-01']
    const fixture = await installFor(uniqueToken('plannedpay'), periods)
    try {
      await gotoApp(page, '/transactions/planned')
      const row = page
        .getByRole('region', { name: /^Expected in the next \d+ days$/ })
        .getByRole('row')
        .filter({ hasText: fixture.seriesName })
      await row.getByRole('button', { name: /^Mark paid, period due/ }).click()

      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Record the payment' }).click()

      await expect(page).toHaveURL(/\/transactions\/new\?/)
      await page.getByRole('button', { name: 'Save', exact: true }).click()

      // Back on the planned screen, with the picker reopened on the same period.
      await expect(page).toHaveURL(/\/transactions\/planned\?/)
      const reopened = page.getByRole('dialog')
      await expect(
        reopened.getByRole('heading', { name: 'Mark this period paid' }),
      ).toBeVisible()
      await reopened.locator('label').first().click()
      await reopened.getByRole('button', { name: 'Link it' }).click()

      await expect(reopened).toBeHidden()
      await expect(row).toHaveCount(0)
      // The address was cleaned: a reload does not reopen the dialog.
      expect(here(page)).not.toContain('markPaid')
    } finally {
      await deleteRecurringFixture(fixture, periods)
    }
  })

  test('a return target that names no unsettled period reopens nothing', async ({
    page,
  }) => {
    await gotoApp(
      page,
      '/recurring?markPaid=2001-01-01&series=not-a-series-of-this-workspace',
    )
    await expect(
      page.getByRole('heading', { level: 1, name: 'Recurring' }),
    ).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})

test.describe('read-only, on the demo workspace', () => {
  test.use({ storageState: storageStateFor('demo') })

  test('the transactions screen switches between recorded and planned and keeps its filters', async ({
    page,
  }) => {
    await gotoApp(page, '/transactions?q=rent')

    const group = page.getByRole('radiogroup', {
      name: 'Which entries to show',
    })
    await expect(group.getByRole('radio', { name: 'Recorded' })).toBeChecked()
    await expectNoSeriousViolations(page, '/transactions')

    await group.getByText('Planned').click()
    await expect(page).toHaveURL(/\/transactions\/planned\?q=rent/)
    const planned = page.getByRole('radiogroup', {
      name: 'Which entries to show',
    })
    await expect(planned.getByRole('radio', { name: 'Planned' })).toBeChecked()
    await expectNoSeriousViolations(page, '/transactions/planned')

    await planned.getByText('Recorded').click()
    await expect(page).toHaveURL(/\/transactions\?q=rent/)
  })

  test('the due-soon table offers both actions on every row and is axe-clean', async ({
    page,
  }) => {
    await gotoApp(page, '/recurring?status=all')

    const table = page
      .getByRole('region', { name: 'Due soon' })
      .getByRole('table')
    await expect(table).toBeVisible()
    await expect(
      table.getByRole('columnheader', { name: 'Status' }),
    ).toBeVisible()

    const dataRows = table.getByRole('row').filter({
      has: page.getByRole('button', { name: /^Mark paid, period due/ }),
    })
    const count = await dataRows.count()
    expect(count).toBeGreaterThan(0)
    for (let index = 0; index < count; index += 1) {
      const row = dataRows.nth(index)
      await expect(
        row.getByRole('button', { name: /^Skip, period due/ }),
      ).toBeVisible()
      await expect(
        row.getByRole('button', { name: /^Undo, period due/ }),
      ).toHaveCount(0)
    }
    await expectNoSeriousViolations(page, '/recurring (due soon with actions)')
  })
})
