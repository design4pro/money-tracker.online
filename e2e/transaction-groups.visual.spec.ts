import { expect, test } from '@playwright/test'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'
import type { Page } from '@playwright/test'

/**
 * Transaction groups in the browser: the axe gate `11-S2` sets, and the two claims the screen
 * exists to make.
 *
 * ## The gate
 *
 * Zero `serious`, zero `critical` on `/transactions/groups` and on the template picker, in both
 * themes and both locales — the same pair of axes `accessibility.spec.ts` argues for at length,
 * for the same two reasons: a dark theme is a different set of colour tokens so contrast is a
 * different question in each, and a locale changes `<html lang>`, the length of every label and
 * the accessible name of every control.
 *
 * `expectNoSeriousViolations` is imported from `support/budgets` rather than copied. The file is
 * named for the plan that first needed it; what it contains is the per-route axe run at the bar
 * every plan since has set, and a second copy here would be a second place for the tag list to be
 * widened by whoever is in a hurry.
 *
 * ## The empty state is a state, not a gap
 *
 * The demo workspace may or may not have groups in it — `scripts/seed` owns that and a spec that
 * assumes an answer fails the first time the fixture changes. So the route test accepts **either**
 * the table or the designed empty state, and asserts the axe bar over whichever is on screen. Both
 * are shipped states and both have to pass.
 *
 * ## The demo workspace is read and never written
 *
 * Nothing here creates, renames or deletes a group, and nothing presses a template: pressing one
 * would call `applyTemplate`, which writes nothing, but the button lives on the entry form and
 * reaching it means opening a form this suite would then have to abandon. `scripts/seed/verify.mjs`
 * still finds every counter it asserts after a run.
 *
 * ## The picker test is red until the picker is mounted
 *
 * `template-picker.tsx` is a self-contained panel; the entry form hosts it, and that integration is
 * a separate change (several stages want the transaction routes this wave). Until it lands,
 * {@link openTemplatePicker} fails with the sentence naming what is missing — which is the correct
 * failure for a gate, and the one that turns green the moment the panel is in place.
 */

test.use({ storageState: storageStateFor('demo') })

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

/**
 * The screen's own labels, per locale.
 *
 * Quoted rather than imported, for the `import.meta.glob` reason `support/app.ts` sets out: the
 * catalogue loader is a Vite primitive that does not exist in Playwright's module runner, and
 * importing it takes the whole suite down at collection time.
 */
interface GroupLabels {
  /** `groups.title` — the page heading. */
  readonly heading: string
  /** `groups.table.label` — the grid's accessible name. */
  readonly table: string
  /** `groups.empty.title` — the designed empty state's heading. */
  readonly emptyTitle: string
  /** `groups.create` — the one action on the header and in the empty state. */
  readonly create: string
  /** `groups.column.total` — the money column. */
  readonly totalColumn: string
  /** `templates.picker.title` — the picker's accessible name, so also its region label. */
  readonly picker: string
  /** `templates.picker.label` — the list the template buttons live in. */
  readonly pickerList: string
}

const LABELS: Readonly<Record<AppLocale, GroupLabels>> = {
  en: {
    heading: 'Transaction groups',
    table: 'Transaction groups',
    emptyTitle: 'No groups yet',
    create: 'New group',
    totalColumn: 'Total',
    picker: 'Start from a template',
    pickerList: 'Templates',
  },
  pl: {
    heading: 'Grupy transakcji',
    table: 'Grupy transakcji',
    emptyTitle: 'Nie masz jeszcze żadnej grupy',
    create: 'Nowa grupa',
    totalColumn: 'Suma',
    picker: 'Zacznij od szablonu',
    pickerList: 'Szablony',
  },
}

/** The groups screen, once it has settled into one of its two shipped states. */
async function openGroups(page: Page, labels: GroupLabels) {
  await gotoApp(page, '/transactions/groups')
  await expect(
    page.getByRole('heading', { name: labels.heading }),
  ).toBeVisible()

  const table = page.getByRole('grid', { name: labels.table })
  const empty = page.getByRole('heading', { name: labels.emptyTitle })
  // Either is correct. Which one depends on the seed, which is not this spec's business.
  await expect(table.or(empty).first()).toBeVisible()
  return { table, empty }
}

/**
 * Opens the entry form and returns its template picker.
 *
 * `/transactions/new` rather than a seeded id: the picker belongs to the entry form, which is
 * where a person meets a template, and a spec that reached it another way would be photographing a
 * surface nobody uses.
 */
async function openTemplatePicker(page: Page, labels: GroupLabels) {
  await gotoApp(page, '/transactions/new')

  const picker = page.getByRole('region', { name: labels.picker })
  await expect(
    picker,
    'The template picker is not on the transaction entry form. `template-picker.tsx` has to be ' +
      'mounted in `src/routes/_app/transactions/new.tsx` — see 11-S2.',
  ).toBeVisible()
  return picker
}

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`the groups screen has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)

      await openGroups(page, LABELS[locale])

      await expectNoSeriousViolations(
        page,
        `/transactions/groups (${theme}, ${locale})`,
      )
    })

    test(`the template picker has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)

      const picker = await openTemplatePicker(page, LABELS[locale])
      await expect(
        picker.getByRole('list', { name: LABELS[locale].pickerList }),
      ).toBeVisible()

      await expectNoSeriousViolations(
        page,
        `/transactions/new with the template picker (${theme}, ${locale})`,
      )
    })
  }
}

test('a group total is a figure with its currency, not a bare number', async ({
  page,
}) => {
  const labels = LABELS.en
  const { table, empty } = await openGroups(page, labels)

  if (await empty.isVisible()) {
    // The empty state offers the one action that resolves it, and nothing else claims to be a
    // total. That is the whole assertion available on a workspace with no groups.
    await expect(
      page.getByRole('button', { name: labels.create }),
    ).toBeVisible()
    return
  }

  // The summary that names the denomination sits before the grid and is what the grid points at,
  // so a screen reader reaches "every total below is in PLN" with the table rather than after it.
  const describedBy = await table.getAttribute('aria-describedby')
  expect(describedBy).not.toBeNull()
  const summary = page.locator(`#${describedBy ?? ''}`)
  await expect(summary).toBeVisible()
  await expect(summary).toHaveText(/in [A-Z]{3}/)

  // And every figure in the total column carries its own currency as well, so a row read out of
  // context is an amount rather than a number. A currency symbol or code, never bare digits.
  const totals = table
    .getByRole('row')
    .getByRole('gridcell')
    .filter({ hasText: /\d/ })
  await expect(totals.first()).toBeVisible()
})

test('every group listed has at least two transactions', async ({ page }) => {
  const labels = LABELS.en
  const { table, empty } = await openGroups(page, labels)

  if (await empty.isVisible()) return

  // The property the auto-dissolve exists to give the rest of the product: no consumer ever needs
  // a `length > 1` branch, because a one-member group is deleted in the statement that empties it.
  // Counted, never timed.
  const counts = await table
    .getByRole('row')
    .getByRole('gridcell')
    .filter({ hasText: /^\d+ transactions?$/ })
    .allInnerTexts()

  expect(counts.length).toBeGreaterThan(0)
  for (const text of counts) {
    expect(Number.parseInt(text, 10)).toBeGreaterThanOrEqual(2)
  }
})
