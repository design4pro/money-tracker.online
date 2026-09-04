import { expect, test } from '@playwright/test'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'
import type { Page } from '@playwright/test'

/**
 * The split editor in the browser: the axe gate `11-S1` sets, and the two claims the panel exists
 * to make.
 *
 * ## The gate
 *
 * Zero `serious`, zero `critical` on the transaction detail route with the editor populated, in
 * both themes and both locales — the same pair of axes `accessibility.spec.ts` argues for at
 * length, for the same two reasons: a dark theme is a different set of colour tokens so contrast is
 * a different question in each, and a locale changes `<html lang>`, the length of every label and
 * the accessible name of every control.
 *
 * `expectNoSeriousViolations` is imported from `support/budgets` rather than copied. The file is
 * named for the plan that first needed it; what it contains is the per-route axe run at the bar
 * every plan since has set, and a second copy of it here would be a second place for the tag list
 * to be widened by whoever is in a hurry.
 *
 * ## "Populated" needs no fixture
 *
 * The editor opens on **two rows with the whole amount on the first**, which is the state a person
 * meets it in and the state worth photographing: every control is rendered, the running total is a
 * real figure and the remainder is zero. The non-zero remainder — the state the panel is actually
 * for — is produced by typing, in the test below that checks it is announced as text.
 *
 * ## The demo workspace is read and never written
 *
 * Nothing here presses **Save the split**, so `scripts/seed/verify.mjs` still finds every counter it
 * asserts after a run. The two behavioural tests exercise the editor's own state and stop there.
 *
 * ## This spec is red until the panel is mounted
 *
 * `split-editor.tsx` is a self-contained panel; the transaction detail screen hosts it, and that
 * integration is a separate change (three stages want `$transactionId.tsx` this wave). Until it
 * lands, {@link openSplitEditor} fails with the sentence naming what is missing — which is the
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
interface SplitLabels {
  /** `splits.title` — the panel's accessible name, so also its region label. */
  readonly panel: string
  /** `splits.lines.label` — the list the rows live in. */
  readonly lines: string
  /** `splits.add` */
  readonly addLine: string
  /** `splits.row.amount` */
  readonly amount: string
  /** `splits.row.moveDown`, with `{position}` already substituted for line 1. */
  readonly moveFirstDown: string
  /** `splits.row.remove`, for line 1. */
  readonly removeFirst: string
  /** `splits.assignRemainder` */
  readonly assignRemainder: string
  /** A fragment of `splits.remaining` that survives whatever amount is in it. */
  readonly remainingFragment: RegExp
}

const LABELS: Readonly<Record<AppLocale, SplitLabels>> = {
  en: {
    panel: 'Split this transaction',
    lines: 'Split lines',
    addLine: 'Add a line',
    amount: 'Amount',
    moveFirstDown: 'Move line 1 down',
    removeFirst: 'Remove line 1',
    assignRemainder: 'Assign the remainder',
    remainingFragment: /left to assign/i,
  },
  pl: {
    panel: 'Podziel tę transakcję',
    lines: 'Wiersze podziału',
    addLine: 'Dodaj wiersz',
    amount: 'Kwota',
    moveFirstDown: 'Przenieś wiersz 1 w dół',
    removeFirst: 'Usuń wiersz 1',
    assignRemainder: 'Przypisz resztę',
    remainingFragment: /do przypisania/i,
  },
}

/**
 * Opens the first transaction in the ledger and returns its split editor.
 *
 * The row is reached by following the list's own link rather than by a seeded id: the demo
 * workspace's contents are the seed's business, and a spec that hard-codes an id fails for a reason
 * that has nothing to do with splits the first time the fixture changes.
 */
async function openSplitEditor(page: Page, labels: SplitLabels) {
  await gotoApp(page, '/transactions')

  const firstRow = page.locator('a[href^="/transactions/"]').first()
  await expect(firstRow).toBeVisible()
  await firstRow.click()
  await expect(page).toHaveURL(/\/transactions\/[^/]+$/)

  const editor = page.getByRole('region', { name: labels.panel })
  await expect(
    editor,
    // Not a diagnosis; see the note on the same assertion in `refunds.visual.spec.ts`. The editor
    // has been mounted since 11-S1 landed, so naming the mount as the cause is now always wrong.
    `No region named "${labels.panel}" on the transaction detail screen (the name is locale-dependent).`,
  ).toBeVisible()
  return editor
}

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`the split editor has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)

      const editor = await openSplitEditor(page, LABELS[locale])
      await expect(
        editor.getByRole('list', { name: LABELS[locale].lines }),
      ).toBeVisible()

      await expectNoSeriousViolations(
        page,
        `/transactions/$id with the split editor (${theme}, ${locale})`,
      )
    })
  }
}

test('what is still unassigned is a sentence, not a colour', async ({
  page,
}) => {
  const labels = LABELS.en
  const editor = await openSplitEditor(page, labels)

  const status = editor.getByRole('status')
  await expect(status).toBeVisible()

  // The editor opens balanced: the whole amount is on line 1, so nothing is outstanding.
  const balanced = await status.innerText()

  // Taking money off the first line has to produce a remainder somebody can read. This is the
  // failure the panel exists to prevent — an editor that says nothing until submit.
  await editor.getByRole('textbox', { name: labels.amount }).first().fill('1')
  await expect(status).toHaveText(labels.remainingFragment)
  expect(await status.innerText()).not.toBe(balanced)

  // And the button that does the arithmetic for them appears with it.
  await expect(
    editor.getByRole('button', { name: labels.assignRemainder }),
  ).toBeVisible()
})

test('adding, removing and reordering a line are all buttons with names', async ({
  page,
}) => {
  const labels = LABELS.en
  const editor = await openSplitEditor(page, labels)

  const rows = editor
    .getByRole('list', { name: labels.lines })
    .getByRole('listitem')
  await expect(rows).toHaveCount(2)

  // Two lines is the minimum a split can be, so removal is refused at two rather than silently
  // turning the split into something that is not one.
  await expect(
    editor.getByRole('button', { name: labels.removeFirst }),
  ).toBeDisabled()

  await editor.getByRole('button', { name: labels.addLine }).click()
  await expect(rows).toHaveCount(3)
  await expect(
    editor.getByRole('button', { name: labels.removeFirst }),
  ).toBeEnabled()

  // Reordering is a button and not a drag handle, so it is operable from the keyboard by
  // construction rather than by a second implementation.
  const moveDown = editor.getByRole('button', { name: labels.moveFirstDown })
  await moveDown.focus()
  await expect(moveDown).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(rows).toHaveCount(3)
})
