import path from 'node:path'
import { mkdir } from 'node:fs/promises'

import {
  DELIBERATE_LOADER_FAILURE,
  DELIBERATE_SERVER_FAILURE,
  expect,
  test,
} from './support/console'

import { LABELS, gotoApp, useLocale, useTheme } from './support/app'
import { expectNoWcagViolations } from './support/axe-scan'
import { storageStateFor } from './support/session'
import { failServerFns } from './support/states'

import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'

import type { AppLocale, AppTheme } from './support/app'

/**
 * A refused save shows the catalogue sentence of its failure, and nothing the error said (#718).
 *
 * The create-account dialog stands for the ~25 after-action sites that moved onto `FailurePanel`:
 * the same `failureOf` in the `catch`, the same panel in the dialog body. The stub of
 * `failServerFns` answers with a plain 500 whose body is `deliberate failure from
 * e2e/support/states.ts`, so what reaches the client is an error that is not an envelope; the panel
 * must read it as the `internal` failure, and that stub text must appear nowhere on the page.
 *
 * Frames are taken only when `FAILURE_EVIDENCE_DIR` names a directory outside the repository
 * (ADR 0016: a PNG never lands in it), so CI never writes one.
 */

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']
const CATALOGUE = { en, pl } as const

/** The text of `INTERNAL_SERVER_ERROR` in `e2e/support/states.ts`, which must never be shown. */
const STUB_TEXT = 'deliberate failure'

function evidenceDirectory(): string | undefined {
  const directory = process.env.FAILURE_EVIDENCE_DIR
  if (directory === undefined || directory === '') return undefined
  const resolved = path.resolve(directory)
  const inside = path.relative(process.cwd(), resolved)
  if (inside === '' || !inside.startsWith('..')) {
    throw new Error(
      `FAILURE_EVIDENCE_DIR=${directory} is inside the repository; frames go outside it`,
    )
  }
  return resolved
}

test.describe('a refused save', () => {
  test.use({ storageState: storageStateFor('demo') })

  test('Accounts Retry reruns the failed loader without a page reload', async ({
    page,
    context,
    expectConsole,
  }) => {
    expectConsole(DELIBERATE_LOADER_FAILURE)
    await useLocale(context, 'en')
    await gotoApp(page, '/dashboard')
    const failing = await failServerFns(page)
    try {
      await page
        .getByRole('link', { name: 'Accounts', exact: true })
        .first()
        .click()
      const retry = page.getByRole('button', { name: en['action.retry'] })
      await expect(retry).toBeVisible()
      await failing.release()
      const request = page.waitForRequest((request) =>
        request.url().includes('/_serverFn/'),
      )
      await retry.click()
      await request
      await expect(retry).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: LABELS.en.newAccount }),
      ).toBeVisible()
      await expect(page).toHaveURL(/\/accounts\?status=active$/)
    } finally {
      await failing.release()
    }
  })

  for (const theme of THEMES) {
    for (const locale of LOCALES) {
      test(`shows the sentence of its kind and never the error text - ${theme}, ${locale}`, async ({
        page,
        context,
        expectConsole,
      }) => {
        expectConsole(DELIBERATE_SERVER_FAILURE)
        await useLocale(context, locale)
        await useTheme(page, theme)
        const labels = LABELS[locale]

        await gotoApp(page, '/accounts')
        await page.getByRole('button', { name: labels.newAccount }).click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await dialog
          .getByRole('textbox', { name: labels.accountName })
          .fill('Evidence account')

        // After the page and the dialog are up: only the save is refused.
        const failing = await failServerFns(page)
        try {
          await dialog
            .getByRole('button', { name: labels.create, exact: true })
            .click()

          const panel = dialog.getByRole('alert')
          await expect(panel).toContainText(
            CATALOGUE[locale]['empty.error.title'],
          )
          await expect(panel).toContainText(
            CATALOGUE[locale]['failure.internal'],
          )
          await expect(dialog.locator('details')).toHaveCount(0)
          await expect(page.locator('body')).not.toContainText(STUB_TEXT)
          // Focus moved to the panel's heading: the reader hears the alert and is where it is.
          await expect(
            panel.getByRole('heading', {
              name: CATALOGUE[locale]['empty.error.title'],
            }),
          ).toBeFocused()
          await expectNoWcagViolations(
            page,
            `the refused save (${theme}, ${locale})`,
          )

          const directory = evidenceDirectory()
          if (directory !== undefined) {
            await mkdir(directory, { recursive: true })
            await dialog.screenshot({
              path: path.join(directory, `refused-save-${theme}-${locale}.png`),
            })
          }
        } finally {
          await failing.release()
        }
      })
    }
  }
})
