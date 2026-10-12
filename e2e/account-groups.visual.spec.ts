import { expect, test } from './support/console'

import { gotoApp, uniqueToken, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'

import type { AppLocale, AppTheme } from './support/app'
import type { Locator, Page } from '@playwright/test'

/**
 * The account groups screen in the browser (`/accounts/groups`): the axe gate, the write paths,
 * and the one claim a unit test cannot make - the controls on an indented sub-group are a real
 * 44 px target at 360 px.
 *
 * ## The gate
 *
 * Zero `serious`, zero `critical` with the tree rendered, in both themes and both locales, for the
 * reasons `balance-adjustment.visual.spec.ts` gives: a dark theme is a different set of colour
 * tokens and a locale changes `<html lang>` and every accessible name. The console fixture turns
 * any red console output, through create, move and delete, into a failure.
 *
 * ## The demo workspace is written and restored
 *
 * `scripts/seed/verify.mjs` counts the demo groups, so every test here that creates a group
 * removes it again - in a `finally`, so a failed assertion still cleans up - and finds it by a
 * token no earlier run can have produced.
 *
 * No frame is written: this spec asserts, it does not photograph. The visual capture for a review
 * goes to `.ai/qa/artifacts_<run>/` through `scripts/visual/capture.mjs`, never into the repository.
 */

test.use({ storageState: storageStateFor('demo') })

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

const CATALOGUE = { en, pl } as const

/** A catalogue sentence with its `{placeholders}` filled; the keys used here are never plural. */
function say(
  locale: AppLocale,
  key: keyof typeof en,
  params: Readonly<Record<string, string | number>> = {},
): string {
  const value = CATALOGUE[locale][key]
  if (typeof value !== 'string') {
    throw new Error(`${key} is a plural entry, not a sentence`)
  }
  return value.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]))
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The row of a group, by the start of its accessible name (`Name, group, …` / `Name, inside …`). */
function groupRow(page: Page, name: string): Locator {
  return page.getByRole('row', { name: new RegExp(`^${escape(name)}, `) })
}

async function openActions(page: Page, name: string): Promise<void> {
  await page
    .getByRole('button', { name: new RegExp(`^Actions for ${escape(name)}`) })
    .click()
}

async function createGroup(page: Page, name: string): Promise<void> {
  await page
    .getByRole('button', { name: say('en', 'accounts.group.create') })
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByRole('textbox', { name: say('en', 'accounts.group.field.name') })
    .fill(name)
  await dialog.getByRole('button', { name: say('en', 'action.create') }).click()
  await expect(dialog).toBeHidden()
  await expect(groupRow(page, name)).toBeVisible()
}

async function createSubGroup(
  page: Page,
  parent: string,
  name: string,
): Promise<void> {
  await openActions(page, parent)
  await page
    .getByRole('menuitem', { name: say('en', 'accounts.group.addChild') })
    .click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByRole('textbox', { name: say('en', 'accounts.group.field.name') })
    .fill(name)
  await dialog.getByRole('button', { name: say('en', 'action.create') }).click()
  await expect(dialog).toBeHidden()
  await expect(groupRow(page, name)).toBeVisible()
}

/** Deletes a group through its menu when it is still there; a no-op otherwise. */
async function removeIfPresent(page: Page, name: string): Promise<void> {
  if ((await groupRow(page, name).count()) === 0) return
  await openActions(page, name)
  await page
    .getByRole('menuitem', { name: say('en', 'accounts.group.delete.action') })
    .click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: say('en', 'accounts.group.delete.action') })
    .click()
  await expect(groupRow(page, name)).toHaveCount(0)
}

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`the groups screen has no serious or critical violations - ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      await gotoApp(page, '/accounts/groups')
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: say(locale, 'accounts.groups.title'),
        }),
      ).toBeVisible()
      await expect(page.getByRole('grid').first()).toBeVisible()

      await expectNoSeriousViolations(
        page,
        `/accounts/groups (${theme}, ${locale})`,
      )
    })
  }
}

test('create, nest, move out and delete leave the console silent and the workspace as it was', async ({
  page,
}) => {
  const parent = uniqueToken('Joint')
  const child = uniqueToken('Trips')
  await gotoApp(page, '/accounts/groups')

  try {
    await createGroup(page, parent)
    await createSubGroup(page, parent, child)
    await expect(
      page.getByRole('row', {
        name: new RegExp(`^${escape(child)}, inside ${escape(parent)}`),
      }),
    ).toBeVisible()

    // Out of the parent by the menu - the same move a drag to the top level produces.
    await openActions(page, child)
    await page
      .getByRole('menuitem', { name: say('en', 'action.moveTo') })
      .click()
    await page
      .getByRole('menuitem', { name: say('en', 'accounts.group.parent.none') })
      .click()
    await expect(groupRow(page, child)).toContainText(child)
    await expect(
      page.getByRole('row', { name: new RegExp(`^${escape(child)}, group`) }),
    ).toBeVisible()
    // Said politely, once the write has landed.
    await expect(
      page.getByRole('status').filter({ hasText: child }),
    ).toBeVisible()
  } finally {
    await removeIfPresent(page, child)
    await removeIfPresent(page, parent)
  }
})

test('the controls on an indented sub-group are a 44 px target at 360 px, and nothing scrolls sideways', async ({
  page,
}) => {
  const parent = uniqueToken('Joint')
  const child = uniqueToken('Trips')
  await gotoApp(page, '/accounts/groups')

  try {
    await createGroup(page, parent)
    await createSubGroup(page, parent, child)
    await page.setViewportSize({ width: 360, height: 740 })

    const row = page.getByRole('row', {
      name: new RegExp(`^${escape(child)}, inside ${escape(parent)}`),
    })
    const handle = row.getByRole('button', {
      name: new RegExp(`^Drag ${escape(child)}`),
    })
    const actions = row.getByRole('button', {
      name: new RegExp(`^Actions for ${escape(child)}`),
    })

    for (const control of [handle, actions]) {
      // The hit area is grown to 44 px by a pseudo-element (`target-min`), so it is the pseudo-
      // element that is measured, in both axes, and the control itself must still be on screen.
      const hitArea = await control.evaluate((element) => {
        const style = getComputedStyle(element, '::after')
        return {
          width: Number.parseFloat(style.width),
          height: Number.parseFloat(style.height),
        }
      })
      expect(hitArea.width).toBeGreaterThanOrEqual(44)
      expect(hitArea.height).toBeGreaterThanOrEqual(44)

      const box = await control.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(360)
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 })
    await removeIfPresent(page, child)
    await removeIfPresent(page, parent)
  }
})
