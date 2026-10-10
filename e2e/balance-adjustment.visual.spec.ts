import { expect, test } from './support/console'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'
import type { Page } from '@playwright/test'

/**
 * The balance-correction dialog in the browser: the axe gate `06-S3` phase C sets, and the claim
 * the dialog exists to make - the delta it names is the delta it writes, for any booking date.
 *
 * ## The gate
 *
 * Zero `serious`, zero `critical` with the dialog open and the preview settled, in both themes and
 * both locales, for the reasons `refunds.visual.spec.ts` gives: a dark theme is a different set
 * of colour tokens and a locale changes `<html lang>` and every accessible name.
 *
 * ## The demo workspace is read and never written
 *
 * Nothing here presses **Record the correction**, so `scripts/seed/verify.mjs` still finds every
 * counter it asserts. The write is exercised against a real database by
 * `repos/__tests__/accounts.test.ts` and `money-invariants.test.ts`.
 */

test.use({ storageState: storageStateFor('demo') })

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

/** Quoted from the catalogue rather than imported, for the `import.meta.glob` reason in `support/app.ts`. */
const LABELS: Readonly<
  Record<
    AppLocale,
    {
      readonly actions: RegExp
      readonly adjust: string
      readonly record: string
      readonly loading: RegExp
    }
  >
> = {
  en: {
    actions: /^Actions for /,
    adjust: 'Correct the balance',
    record: 'Record the correction',
    loading: /^Reading the balance on/,
  },
  pl: {
    actions: /^Działania dla konta /,
    adjust: 'Wyrównaj stan konta',
    record: 'Zapisz korektę',
    loading: /^Odczytujemy stan konta/,
  },
}

async function openDialog(page: Page, locale: AppLocale) {
  const labels = LABELS[locale]
  await gotoApp(page, '/accounts')
  await page.getByRole('button', { name: labels.actions }).first().click()
  await page.getByRole('menuitem', { name: labels.adjust }).click()
  const dialog = page.getByRole('dialog', { name: labels.adjust })
  await expect(dialog).toBeVisible()
  return dialog
}

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`the correction dialog has no serious or critical violations - ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      const labels = LABELS[locale]

      const dialog = await openDialog(page, locale)
      // Settled: the balance for today has been read, so the button is enabled and the status
      // region no longer says it is reading.
      await expect(dialog.getByRole('status')).not.toHaveText(labels.loading)
      await expect(
        dialog.getByRole('button', { name: labels.record }),
      ).toBeEnabled()

      await expectNoSeriousViolations(
        page,
        `/accounts with the correction dialog open (${theme}, ${locale})`,
      )
    })
  }
}

test('a past date previews a computed delta, not a promise to compute one later', async ({
  page,
}) => {
  const labels = LABELS.en
  const dialog = await openDialog(page, 'en')
  await expect(dialog.getByRole('status')).not.toHaveText(labels.loading)

  await dialog.getByRole('spinbutton', { name: /^day/i }).first().focus()
  await page.keyboard.press('ArrowDown')

  await expect(dialog.getByRole('status')).not.toHaveText(labels.loading)
  await expect(
    dialog.getByRole('button', { name: labels.record }),
  ).toBeEnabled()
  await expect(dialog.getByRole('status')).toHaveText(
    /Nothing\.|Money in of|An expense of/,
  )
})
