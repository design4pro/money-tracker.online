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
  const remove = page.getByRole('menuitem', {
    name: say('en', 'accounts.group.delete.action'),
  })
  // A page that has only just loaded can swallow its first press on the trigger, so the press is
  // retried until the menu is there; a press on an open menu never happens, the retry only runs
  // when the menu did not open.
  await expect(async () => {
    await openActions(page, name)
    await expect(remove).toBeVisible({ timeout: 2000 })
  }).toPass()
  await remove.click()
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
      const accountRow = page.locator('[data-key^="member:"]').first()
      const actions = accountRow.getByRole('button')
      await page.setViewportSize({ width: 360, height: 800 })
      const hitArea = await actions.evaluate((element) => {
        const style = getComputedStyle(element, '::after')
        return {
          width: Number.parseFloat(style.width),
          height: Number.parseFloat(style.height),
        }
      })
      expect(hitArea.width).toBeGreaterThanOrEqual(44)
      expect(hitArea.height).toBeGreaterThanOrEqual(44)
      await actions.click()
      await page
        .getByRole('menuitem', { name: say(locale, 'action.moveTo') })
        .click()
      await expect(page.getByRole('menu').last()).toBeVisible()
      const box = await page.getByRole('menu').last().boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(360)
      await expectNoSeriousViolations(
        page,
        `/accounts/groups account move menu (${theme}, ${locale})`,
      )
    })
  }
}

test('create, nest, move out and delete leave the console silent and the workspace as it was', async ({
  page,
}) => {
  const parent = uniqueToken('Joint')
  const child = uniqueToken('Trips')
  // The only way in is the link under the accounts subtitle.
  await gotoApp(page, '/accounts')
  await page
    .getByRole('link', { name: say('en', 'accounts.groups.manage') })
    .click()
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: say('en', 'accounts.groups.title'),
    }),
  ).toBeVisible()

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
  // Long names (the field allows 100 characters) are what push a handle or a menu off a 360 px row.
  const parent = `${uniqueToken('Joint')} ${'wide '.repeat(14)}`.trim()
  const child = `${uniqueToken('Trips')} ${'wide '.repeat(14)}`.trim()
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

    // The "Move to..." submenu opens under the menu on a phone: beside it, it ran off the screen.
    await openActions(page, child)
    await page
      .getByRole('menuitem', {
        name: new RegExp(`^${say('en', 'action.moveTo')}`),
      })
      .click()
    const submenu = page.getByRole('menu').last()
    await expect(
      submenu.getByRole('menuitem', {
        name: say('en', 'accounts.group.parent.none'),
      }),
    ).toBeVisible()
    const menuBox = await submenu.boundingBox()
    expect(menuBox).not.toBeNull()
    expect(menuBox!.x).toBeGreaterThanOrEqual(0)
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(360)
    // One Escape closes the submenu, the second the menu under it.
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 })
    await removeIfPresent(page, child)
    await removeIfPresent(page, parent)
  }
})

test('a group deleted in another window reads as "list changed" and the list reloads', async ({
  page,
  browser,
  expectConsole,
}) => {
  // The refusal is a not-found, and the failure boundary answers one with its own status (`404`),
  // so the browser reports the response once, as it does for any non-2xx. It is the behaviour under test.
  expectConsole([
    {
      why: 'the browser reporting the 404 the server answers a write on a deleted group with',
      match:
        /^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/,
    },
  ])
  const name = uniqueToken('Gone')
  await gotoApp(page, '/accounts/groups')

  try {
    await createGroup(page, name)

    // The other window removes it; this one still shows it.
    // A context of its own: a second tab in this one sits behind the first, unfocused, and a
    // React Aria menu does not stay open in a window that has no focus.
    const elsewhere = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      storageState: storageStateFor('demo'),
    })
    try {
      const other = await elsewhere.newPage()
      await gotoApp(other, '/accounts/groups')
      await removeIfPresent(other, name)
    } finally {
      await elsewhere.close()
    }
    await expect(groupRow(page, name)).toBeVisible()

    // The refusal crosses the real failure boundary: only its kind selects the sentence.
    await openActions(page, name)
    await page
      .getByRole('menuitem', { name: say('en', 'action.moveUp') })
      .click()
    await expect(
      page
        .getByRole('alert')
        .getByText(say('en', 'accounts.group.refused.notFound')),
    ).toBeVisible()
    await expect(groupRow(page, name)).toHaveCount(0)
  } finally {
    await removeIfPresent(page, name)
  }
})

test('the reason on a disabled menu item is not dimmed with its label', async ({
  page,
}) => {
  const name = uniqueToken('Solo')
  await gotoApp(page, '/accounts/groups')

  try {
    await createGroup(page, name)
    await openActions(page, name)
    // A group just created sits last in its run, so "Move down" is disabled and says why.
    const item = page.getByRole('menuitem', {
      name: say('en', 'action.moveDown'),
    })
    await expect(item).toHaveAttribute('aria-disabled', 'true')
    const reason = item.getByText(say('en', 'accounts.group.disabled.last'))
    await expect(reason).toBeVisible()
    // The row is not faded, so the reason keeps its text colour's full contrast (1.4.3).
    const rowOpacity = await item.evaluate(
      (element) => getComputedStyle(element).opacity,
    )
    expect(rowOpacity).toBe('1')
    await page.keyboard.press('Escape')
  } finally {
    await removeIfPresent(page, name)
  }
})
