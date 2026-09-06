import { expect, test } from './support/console'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'
import type { Page } from '@playwright/test'

/**
 * The three rule routes in a real browser: the axe gate `14-S2` sets, and the two claims the
 * feature exists to make.
 *
 * ## The gate
 *
 * Zero `serious`, zero `critical` on `/transactions/rules`, `/transactions/rules/new` and
 * `/transactions/rules/$ruleId`, in both themes and both locales — the same pair of axes every
 * plan since `10-S1` has argued for, for the same two reasons: a dark theme is a different set of
 * colour tokens so contrast is a different question in each, and a locale changes `<html lang>`,
 * the length of every label and the accessible name of every control.
 *
 * `expectNoSeriousViolations` is imported from `support/budgets` rather than copied. The file is
 * named for the plan that first needed it; what it holds is the per-route axe run at the bar every
 * plan since has set.
 *
 * ## The demo workspace is read and never written
 *
 * Nothing here presses **Save the rule**, flips a rule's switch, confirms a delete or completes a
 * reorder — `scripts/seed/verify.mjs` asserts `rules: 2` after a run, and a spec that created or
 * removed one would fail the seed check rather than this file. The reorder path is verified by
 * opening the menu and reading what it offers, which is the property that matters — *the keyboard
 * can do what the pointer can* — without performing the write.
 *
 * The **preview** is the exception that is not one: `previewRule` is a read that never writes, so
 * the editor cases below let it run and assert on what it says.
 *
 * ## The seeded rules carry provisional JSON
 *
 * `scripts/seed/seed.mjs` says so itself: its two rules were shaped before `14-S1` existed and do
 * not parse against `ruleConditionSchema` (`{ field: 'payee', operator: 'is_any_of' }` and
 * `{ field: 'direction', operator: 'is' }` are both refusals). `readConditions` answers `[]` for a
 * blob it cannot parse — deliberately, so an unreadable rule matches nothing rather than
 * everything — so the seeded rows render with the *no conditions yet* sentence. Nothing here
 * asserts a rendered sentence on a seeded row for that reason; the sentence is pinned per clause,
 * in both locales, by `-lib/__tests__/sentence.test.ts`.
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
interface RuleLabels {
  /** `rules.title` */
  readonly title: string
  /** `rules.list.label` */
  readonly list: string
  /** `rules.new` */
  readonly newRule: string
  /** `rules.editor.new.title` */
  readonly newTitle: string
  /** `rules.editor.sentence.label` */
  readonly sentenceLabel: string
  /** `rules.preview.title` */
  readonly preview: string
  /** `rules.condition.field` */
  readonly field: string
  /** `rules.condition.keywords` */
  readonly keywords: string
  /** `rules.editor.addCondition` */
  readonly addCondition: string
  /** `rules.editor.addRange` */
  readonly addRange: string
  /** `rules.field.direction` */
  readonly directionOption: string
  /** `action.moveUp` */
  readonly moveUp: string
  /** `rules.move.bottom` */
  readonly moveBottom: string
  /** A fragment of `rules.preview.counts` that survives whatever numbers are in it. */
  readonly countsFragment: RegExp
  /** A fragment of `rules.preview.empty`. */
  readonly emptyFragment: RegExp
}

const LABELS: Readonly<Record<AppLocale, RuleLabels>> = {
  en: {
    title: 'Rules',
    list: 'Rules, in the order they run',
    newRule: 'New rule',
    newTitle: 'New rule',
    sentenceLabel: 'What this rule does',
    preview: 'Preview',
    field: 'Field',
    keywords: 'Keywords',
    addCondition: 'Add a condition',
    addRange: 'Add an amount range',
    directionOption: 'Direction',
    moveUp: 'Move up',
    moveBottom: 'Move to the bottom',
    countsFragment: /of the last .* entries match/i,
    emptyFragment: /no matches in the last/i,
  },
  pl: {
    title: 'Zasady',
    list: 'Zasady w kolejności działania',
    newRule: 'Nowa zasada',
    newTitle: 'Nowa zasada',
    sentenceLabel: 'Co robi ta zasada',
    preview: 'Podgląd',
    field: 'Pole',
    keywords: 'Słowa kluczowe',
    addCondition: 'Dodaj warunek',
    addRange: 'Dodaj przedział kwoty',
    directionOption: 'Kierunek',
    moveUp: 'Przenieś wyżej',
    moveBottom: 'Przenieś na dół',
    countsFragment: /z ostatnich .* wpisów/i,
    emptyFragment: /brak dopasowań/i,
  },
}

/** Opens the first seeded rule by following the list's own menu, never by a hard-coded id. */
async function openFirstRule(page: Page, labels: RuleLabels) {
  await gotoApp(page, '/transactions/rules')
  const rows = page.getByRole('grid', { name: labels.list }).getByRole('row')
  await expect(rows.first()).toBeVisible()
  await rows
    .first()
    .getByRole('button', { name: /^(Actions|Działania)/ })
    .click()
  await page.getByRole('menuitem').first().click()
  await expect(page).toHaveURL(/\/transactions\/rules\/[^/]+$/)
}

/* -------------------------------------------------------------------------- */
/* The axe gate, on all three routes                                          */
/* -------------------------------------------------------------------------- */

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`the rule list has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      await gotoApp(page, '/transactions/rules')

      await expect(
        page.getByRole('heading', { level: 1, name: LABELS[locale].title }),
      ).toBeVisible()

      await expectNoSeriousViolations(
        page,
        `/transactions/rules (${theme}, ${locale})`,
      )
    })

    test(`the rule editor has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      await gotoApp(page, '/transactions/rules/new')

      const labels = LABELS[locale]
      await expect(
        page.getByRole('heading', { level: 1, name: labels.newTitle }),
      ).toBeVisible()
      // Four conditions, so the axe run covers a populated editor rather than one blank row: the
      // range button adds two at once and the plain button adds a fourth.
      await page.getByRole('button', { name: labels.addRange }).click()
      await page.getByRole('button', { name: labels.addCondition }).click()

      await expectNoSeriousViolations(
        page,
        `/transactions/rules/new (${theme}, ${locale})`,
      )
    })

    test(`an open rule has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      await openFirstRule(page, LABELS[locale])

      await expect(
        page
          .getByRole('region', { name: LABELS[locale].preview })
          .or(page.getByRole('heading', { name: LABELS[locale].preview })),
      ).toBeVisible()

      await expectNoSeriousViolations(
        page,
        `/transactions/rules/$ruleId (${theme}, ${locale})`,
      )
    })
  }
}

/* -------------------------------------------------------------------------- */
/* The two claims                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Picks the first option of a `ComboBox` from the keyboard.
 *
 * `ArrowDown` then `Enter` rather than a click into a popover: the demo workspace's category names
 * are the seed's business and not this file's, so the spec must not name one, and the keyboard path
 * is the one worth exercising anyway.
 */
async function pickFirstOption(page: Page, name: string | RegExp) {
  const combo = page.getByRole('combobox', { name })
  await combo.click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(combo).not.toHaveValue('')
}

/** The preview's own live region: the paragraph directly under its heading. */
function previewStatus(page: Page, labels: RuleLabels) {
  return page
    .getByRole('heading', { name: labels.preview })
    .locator('xpath=following-sibling::p[1]')
}

test('the preview states both counts, never a bare number of matches', async ({
  page,
}) => {
  const labels = LABELS.en
  await gotoApp(page, '/transactions/rules/new')

  // `direction` matches most of a ledger, so this is the state worth asserting on: a rule with
  // matches, and a count that says what those matches are out of.
  await page.getByRole('button', { name: labels.field }).click()
  await page.getByRole('option', { name: labels.directionOption }).click()

  const status = previewStatus(page, labels)
  // The action has no category yet, so until it has one the panel names the missing half rather
  // than showing a spinner or a zero.
  await expect(status).toBeVisible()

  await pickFirstOption(page, 'Category')

  await expect(status).toHaveText(labels.countsFragment, { timeout: 15_000 })

  // Both halves, explicitly. A denominator with no numerator would satisfy a looser regex, and
  // "12 entries match" is exactly the sentence this stage exists to not ship.
  const text = await status.innerText()
  // `\u00A0` is written as an escape rather than typed: a Polish thousands separator is a
  // non-breaking space, and a literal one in source is invisible to the next reader.
  expect(text.match(/\d[\d\s\u00A0,.]*/gu)?.length ?? 0).toBeGreaterThanOrEqual(
    2,
  )
})

test('a rule that matches nothing says so, in the same sentence shape', async ({
  page,
}) => {
  const labels = LABELS.en
  await gotoApp(page, '/transactions/rules/new')

  await page
    .getByRole('textbox', { name: labels.keywords })
    .fill('zzzz-nothing-matches-this-zzzz')
  await pickFirstOption(page, 'Category')

  await expect(previewStatus(page, labels)).toHaveText(labels.emptyFragment, {
    timeout: 15_000,
  })
})

test('the rule reads back as a sentence above the controls', async ({
  page,
}) => {
  const labels = LABELS.en
  await gotoApp(page, '/transactions/rules/new')

  const sentence = page
    .getByRole('heading', { name: labels.sentenceLabel })
    .locator('xpath=following-sibling::p[1]')

  // A blank rule names the half that is missing rather than reading as a rule that does nothing.
  await expect(sentence).toHaveText(/add a condition/i)

  await page.getByRole('textbox', { name: labels.keywords }).fill('Żabka')
  await expect(sentence).toHaveText(/add an action/i)

  await pickFirstOption(page, 'Category')

  await expect(sentence).toHaveText(
    /^When the note contains “Żabka”, set the category to .+\.$/u,
  )
})

test('every reorder the pointer can do is also a menu item, reachable by keyboard', async ({
  page,
}) => {
  const labels = LABELS.en
  await gotoApp(page, '/transactions/rules')

  const rows = page.getByRole('grid', { name: labels.list }).getByRole('row')
  await expect(rows.first()).toBeVisible()

  const menuButton = rows.first().getByRole('button', { name: /^Actions for / })

  // Opened from the keyboard rather than clicked: the whole point of the non-drag path is that it
  // works without a pointer, and a test that clicks it proves nothing about that.
  await menuButton.focus()
  await expect(menuButton).toBeFocused()
  await page.keyboard.press('Enter')

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()

  // Four ordering items beside edit and delete, and the two that would change nothing on the first
  // row are disabled rather than enabled and silently doing nothing.
  await expect(
    menu.getByRole('menuitem', { name: labels.moveUp }),
  ).toBeDisabled()
  await expect(
    menu.getByRole('menuitem', { name: labels.moveBottom }),
  ).toBeEnabled()

  // Nothing is activated: the demo workspace's rule order is part of the seed's contract, and
  // `scripts/seed/verify.mjs` reads it back.
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})
