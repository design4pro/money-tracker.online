import { expect, test } from './support/console'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'
import type { Page } from '@playwright/test'

/**
 * `/goals/$goalId`: the axe gate `15` sets, the chart's data table, and the one claim this screen
 * exists to make honestly — a projected date never appears without the confidence behind it.
 *
 * The route is reached by **clicking** rather than by a hard-coded id, for the reason
 * `budget-detail.visual.spec.ts` gives: a demo id in a spec is a spec that starts failing the day
 * `scripts/seed/seed.mjs` renames a row, for a reason that has nothing to do with the screen under
 * test. The list is opened at `?status=all` so the click target does not depend on how the
 * fixture's arithmetic came out — see `goals.visual.spec.ts`.
 */

test.use({ storageState: storageStateFor('demo') })

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

/**
 * Opens the first goal and waits for the detail screen to actually be the one on screen.
 *
 * **The wait is on the goal's own name in the `<h1>`, not on the URL and not on a meter.** The
 * router changes the address the moment the link is pressed and keeps the list mounted while the
 * loader runs, so a spec that waits for the URL is back before the screen is; and the list has
 * meters and level-1 headings of its own, so neither of those tells the two pages apart either.
 * Every assertion after such a wait would quietly run against the list — which is exactly how this
 * helper failed the first time it was written.
 */
async function openFirstGoal(page: Page): Promise<string> {
  await gotoApp(page, '/goals?status=all')

  const link = page.locator('a[href^="/goals/"]').first()
  await expect(link).toBeVisible()
  const name = ((await link.textContent()) ?? '').trim()
  await link.click()

  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  return name
}

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`goal detail has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      await openFirstGoal(page)

      await expectNoSeriousViolations(
        page,
        `/goals/$goalId (${theme}, ${locale})`,
      )
    })
  }
}

test('a projected date never appears without the confidence behind it', async ({
  page,
}) => {
  await openFirstGoal(page)

  const projection = page.getByRole('region', { name: 'Projected completion' })
  await expect(projection).toBeVisible()

  const text = (await projection.textContent()) ?? ''
  const isDated = /On course to get there by|At this pace, not before/.test(
    text,
  )

  if (isDated) {
    // The three things a date is never allowed to arrive without: the word, the evidence it was
    // computed from, and the sentence saying it is a projection rather than a promise.
    expect(text).toMatch(/How much to trust this/)
    expect(text).toMatch(/Rough guess|Fair estimate|Steady pattern/)
    expect(text).toMatch(/Based on a typical .+ a month\./)
    expect(text).toMatch(/from \d+ months? of contributions/)
    expect(text).toMatch(/A projection, not a promise/)
  } else {
    // The only other two honest answers, each said as a reason rather than as a shrug.
    expect(text).toMatch(
      /There is nothing left to project|Not enough history to project/,
    )
    // And neither of them is allowed to borrow a date's confidence wording.
    expect(text).not.toMatch(/How much to trust this/)
  }
})

test('the contribution history ships its numbers as a table as well as as bars', async ({
  page,
}) => {
  await openFirstGoal(page)

  // `docs/ACCESSIBILITY.md`: every chart ships a visually-hidden data table. The bars are the
  // evidence the projection's median was taken over, so the table is the only way a reader who
  // cannot see them can check the projection against what it was computed from.
  expect(await page.getByRole('table').count()).toBeGreaterThanOrEqual(1)
})

test('the actions menu is reachable from the keyboard and names its goal', async ({
  page,
}) => {
  await openFirstGoal(page)

  const actions = page.getByRole('button', { name: /Actions for/i }).first()
  await expect(actions).toBeVisible()
  await actions.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()

  // Escape closes it and puts focus back where it came from, which is the whole contract of a menu
  // trigger — `focus-restoration.spec.ts` holds the same line for dialogs.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(actions).toBeFocused()
})

test('the contribution dialog offers transactions rather than an amount field', async ({
  page,
}) => {
  await openFirstGoal(page)

  await page.getByRole('button', { name: 'Count a transaction' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // The whole point of the flow: a contribution is a link to a transaction that already happened,
  // so there is nothing here to type an amount into. A dialog that grew one would mean goals had
  // started inventing money.
  await expect(dialog.getByRole('spinbutton')).toHaveCount(0)
  await expect(dialog.getByRole('textbox')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})
