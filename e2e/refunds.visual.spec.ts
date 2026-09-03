import { expect, test } from '@playwright/test'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'
import type { Page } from '@playwright/test'

/**
 * The refund panel in the browser: the axe gate `10-S2` sets, and the two claims the panel exists
 * to make.
 *
 * ## The gate
 *
 * Zero `serious`, zero `critical` on the transaction detail route with the panel rendered and with
 * the link dialog open, in both themes and both locales — the pair of axes `accessibility.spec.ts`
 * argues for at length, for the same two reasons: a dark theme is a different set of colour tokens
 * so contrast is a different question in each, and a locale changes `<html lang>`, the length of
 * every label and the accessible name of every control.
 *
 * `expectNoSeriousViolations` is imported from `support/budgets` rather than copied, for the reason
 * `splits.visual.spec.ts` gives: the file is named for the plan that first needed it, and a second
 * copy here would be a second place for the tag list to be widened by whoever is in a hurry.
 *
 * ## The dialog is part of the gate, not an extra
 *
 * A modal is where focus management, the `inert` behind it and the accessible name of a radio group
 * all go wrong at once, and the link dialog is also where the **over-refund refusal** is shown —
 * the error this stage exists for. So the dialog is opened inside the axe run rather than tested
 * separately.
 *
 * ## The demo workspace is read and never written
 *
 * Nothing here presses **Link the refund**, so `scripts/seed/verify.mjs` still finds every counter
 * it asserts after a run. The dialog is opened and dismissed; the link that would change a row is
 * exercised by `repos/__tests__/refunds.test.ts` against a real database instead.
 *
 * ## This spec is red until the panel is mounted
 *
 * `refund-panel.tsx` is a self-contained panel; the transaction detail screen hosts it, and that
 * integration is a separate change (three stages want `$transactionId.tsx` this wave). Until it
 * lands, {@link openRefundPanel} fails with the sentence naming what is missing — which is the
 * correct failure for a gate, and the one that turns green the moment the panel is in place.
 */

test.use({ storageState: storageStateFor('demo') })

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

/**
 * The panel's own labels, per locale.
 *
 * Quoted rather than imported, for the `import.meta.glob` reason `support/app.ts` sets out: the
 * catalogue loader is a Vite primitive that does not exist in Playwright's module runner, and
 * importing it takes the whole suite down at collection time.
 */
interface RefundLabels {
  /** `refunds.title` — the panel's accessible name, so also its region label. */
  readonly panel: string
  /** `refunds.link` — the action that opens the dialog. */
  readonly link: string
  /** `refunds.dialog.title` */
  readonly dialogTitle: string
  /** `refunds.dialog.field` — the accessible name of the suggestion group. */
  readonly field: string
  /** `refunds.dialog.external` — the option that is always offered. */
  readonly external: string
  /** `refunds.dialog.cancel` */
  readonly cancel: string
  /** A fragment of `refunds.effective` or `refunds.empty`: whichever the row is in, it is a sentence. */
  readonly statusFragment: RegExp
}

const LABELS: Readonly<Record<AppLocale, RefundLabels>> = {
  en: {
    panel: 'Refunds',
    link: 'Record this as a refund',
    dialogTitle: 'What does this transaction refund?',
    field: 'What this transaction refunds',
    external: 'Something outside this workspace',
    cancel: 'Cancel',
    statusFragment: /No refunds linked|effective/i,
  },
  pl: {
    panel: 'Zwroty',
    link: 'Zapisz to jako zwrot',
    dialogTitle: 'Czego dotyczy ta transakcja?',
    field: 'Czego dotyczy ten zwrot',
    external: 'Czegoś spoza tego obszaru roboczego',
    cancel: 'Anuluj',
    statusFragment: /Nie powiązano żadnego zwrotu|ostatecznie/i,
  },
}

/**
 * Opens the first transaction in the ledger and returns its refund panel.
 *
 * The row is reached by following the list's own link rather than by a seeded id: the demo
 * workspace's contents are the seed's business, and a spec that hard-codes an id fails for a reason
 * that has nothing to do with refunds the first time the fixture changes.
 */
async function openRefundPanel(page: Page, labels: RefundLabels) {
  await gotoApp(page, '/transactions')

  const firstRow = page.locator('a[href^="/transactions/"]').first()
  await expect(firstRow).toBeVisible()
  await firstRow.click()
  await expect(page).toHaveURL(/\/transactions\/[^/]+$/)

  const panel = page.getByRole('region', { name: labels.panel })
  await expect(
    panel,
    // Not a diagnosis. This message used to say the panel was unmounted and name the file to
    // mount it in; it has been mounted since 10-S2 landed, so the message outlived its own cause
    // and now sends a reader to repair what is not broken. A failed `toBeVisible` cannot know
    // why - the row may not have opened, the panel may not have rendered, the accessible name
    // may not be the one this locale expects - so it reports what it looked for instead.
    `No region named "${labels.panel}" on the transaction detail screen (the name is locale-dependent).`,
  ).toBeVisible()
  return panel
}

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`the refund panel has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)

      const labels = LABELS[locale]
      const panel = await openRefundPanel(page, labels)

      // The panel resolves to a sentence either way: the effective amount when something came
      // back, "no refunds linked" when nothing did. It is never a bare figure and never a colour.
      await expect(panel.getByRole('status')).toHaveText(labels.statusFragment)

      await expectNoSeriousViolations(
        page,
        `/transactions/$id with the refund panel (${theme}, ${locale})`,
      )

      await panel.getByRole('button', { name: labels.link }).click()
      const dialog = page.getByRole('dialog', { name: labels.dialogTitle })
      await expect(dialog).toBeVisible()
      await expect(
        dialog.getByRole('radiogroup', { name: labels.field }),
      ).toBeVisible()

      await expectNoSeriousViolations(
        page,
        `/transactions/$id with the link dialog open (${theme}, ${locale})`,
      )

      await dialog.getByRole('button', { name: labels.cancel }).click()
      await expect(dialog).toBeHidden()
    })
  }
}

test('every suggestion says why it is on the list', async ({ page }) => {
  const labels = LABELS.en
  const panel = await openRefundPanel(page, labels)

  await panel.getByRole('button', { name: labels.link }).click()
  const dialog = page.getByRole('dialog', { name: labels.dialogTitle })

  // The ranking is stated as text on the group, because an order is not a reason and a reader
  // arriving at the third option has no way to see it is third.
  const group = dialog.getByRole('radiogroup', { name: labels.field })
  await expect(group).toContainText(/closest in amount/i)

  // "Outside this workspace" is always offered — a refund of something bought before the workspace
  // existed is still money arriving — and it carries its own explanation rather than being the
  // option somebody lands on by pressing the button without choosing.
  const external = dialog.getByRole('radio', { name: labels.external })
  await expect(external).toBeVisible()
  await expect(dialog).toContainText(
    /counted as ordinary income|ordinary income/i,
  )

  await dialog.getByRole('button', { name: labels.cancel }).click()
  await expect(dialog).toBeHidden()
})
