import { expect, test } from './support/console'

import { gotoApp, useLocale } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import type { Locator, Page } from '@playwright/test'
import type { AppLocale } from './support/app'

/**
 * The recurring period actions at 360px: reachable without scrolling a region sideways.
 *
 * ## The fault this file exists to catch
 *
 * Both period tables (_Due soon_ on `/recurring` and the period grid on `/recurring/$seriesId`)
 * are real tables inside a focusable scroll region, and their actions are the last column. At 360px
 * that column sits beyond the visible edge until the region is scrolled. WCAG 1.4.10 passes through
 * the data-table exception, but the one thing a row is for should not hide behind a sideways
 * scroll, so below `sm` each row stacks into a block that ends with its actions (#543).
 *
 * ## What is asserted, and what is deliberately not
 *
 * - the region does not overflow (`scrollWidth <= clientWidth`) and every action sits inside the
 *   viewport, so no sideways scroll is needed to press it;
 * - the table roles survive the `display` change, read through the browser's own role queries
 *   rather than the markup;
 * - each stacked cell prints a column label that is `aria-hidden`, so a screen reader hears the
 *   column header once.
 *
 * Nothing here is a screenshot (ADR 0016). The layout at `sm` and above is guarded by
 * `desktop-density.spec.ts`, which this change leaves green.
 *
 * Strings are quoted rather than imported, for the `import.meta.glob` reason `support/app.ts` sets
 * out.
 */

test.use({
  storageState: storageStateFor('demo'),
  viewport: { width: 360, height: 800 },
})

const COPY: Record<
  AppLocale,
  { dueSoon: string; history: string; status: string; due: string }
> = {
  en: {
    dueSoon: 'Due soon',
    history: 'Period history',
    status: 'Status',
    due: 'Due',
  },
  pl: {
    dueSoon: 'Wkrótce',
    history: 'Historia okresów',
    status: 'Stan',
    due: 'Termin',
  },
}

const LOCALES: readonly AppLocale[] = ['en', 'pl']

/** The visible actions of a region: every button that is not the page chrome. */
function actionsIn(region: Locator): Locator {
  return region.getByRole('row').getByRole('button')
}

async function expectNoSidewaysScroll(region: Locator) {
  const overflow = await region.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }))
  expect(
    overflow.scrollWidth,
    'the region does not scroll sideways at 360px',
  ).toBeLessThanOrEqual(overflow.clientWidth)
}

/** Every body row is a block as wide as the table, which is what "stacked" means. */
async function expectRowsStacked(region: Locator) {
  const rows = await region.locator('tbody tr').evaluateAll((elements) =>
    elements.map((element) => ({
      display: getComputedStyle(element).display,
      width: element.getBoundingClientRect().width,
      tableWidth:
        element.closest('table')?.getBoundingClientRect().width ?? Infinity,
    })),
  )
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) {
    expect(row.display).toBe('block')
    expect(row.width).toBeGreaterThanOrEqual(row.tableWidth - 1)
  }
}

async function expectInsideViewport(page: Page, buttons: Locator) {
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  const width = viewport?.width ?? 0

  const count = await buttons.count()
  expect(count, 'the region has actions to reach').toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index)
    await expect(button).toBeVisible()
    const box = await button.boundingBox()
    expect(box, `action ${index} is rendered`).not.toBeNull()
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
  }
}

/** The roles the stacked layout must keep, read from the browser's own accessibility queries. */
async function expectTableRoles(region: Locator, copy: (typeof COPY)['en']) {
  const table = region.getByRole('table')
  await expect(table).toHaveCount(1)
  await expect(table.getByRole('rowgroup')).toHaveCount(2)
  await expect(
    table.getByRole('columnheader', { name: copy.status }),
  ).toHaveCount(1)
  await expect(table.getByRole('columnheader', { name: copy.due })).toHaveCount(
    1,
  )
  expect(await table.getByRole('rowheader').count()).toBeGreaterThan(0)
  expect(await table.getByRole('cell').count()).toBeGreaterThan(0)

  // The column label printed in a stacked cell is for sight only.
  const labels = region.locator('td [aria-hidden="true"]')
  expect(await labels.count()).toBeGreaterThan(0)
  await expect(labels.filter({ hasText: copy.status }).first()).toBeVisible()
}

for (const locale of LOCALES) {
  const copy = COPY[locale]

  test.describe(`at 360px, ${locale}`, () => {
    test.beforeEach(async ({ context }) => {
      await useLocale(context, locale)
    })

    test('Due soon on /recurring stacks its rows and reaches every action without scrolling', async ({
      page,
    }) => {
      await gotoApp(page, '/recurring?status=all')

      const region = page.getByRole('region', { name: copy.dueSoon })
      await expect(region).toBeVisible()

      await expectNoSidewaysScroll(region)
      await expectRowsStacked(region)
      await expectInsideViewport(page, actionsIn(region))
      await expectTableRoles(region, copy)
      await expectNoSeriousViolations(page, '/recurring (stacked due soon)')

      // Reachable by keyboard alone: Tab from the first row's series link lands on its action.
      await region.getByRole('row').getByRole('link').first().focus()
      await page.keyboard.press('Tab')
      await expect(actionsIn(region).first()).toBeFocused()
    })

    test('the period grid on /recurring/$seriesId stacks its rows and reaches every action without scrolling', async ({
      page,
    }) => {
      await gotoApp(page, '/recurring?status=all')
      const seriesLink = page
        .getByRole('region', { name: copy.dueSoon })
        .getByRole('row')
        .getByRole('link')
        .first()
      await seriesLink.click()
      await page.waitForURL(/\/recurring\/[^/?]+/)

      const region = page.getByRole('region', { name: copy.history })
      await expect(region).toBeVisible()

      await expectNoSidewaysScroll(region)
      await expectRowsStacked(region)
      await expectInsideViewport(page, actionsIn(region))
      await expectTableRoles(region, copy)
      await expectNoSeriousViolations(
        page,
        '/recurring/$seriesId (stacked grid)',
      )
    })
  })
}
