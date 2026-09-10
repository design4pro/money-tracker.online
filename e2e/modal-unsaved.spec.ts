import { expect, test } from './support/console'

import { gotoApp, useLocale } from './support/app'
import { storageStateFor } from './support/session'

import type { Page } from '@playwright/test'

/**
 * A dialog with work in it asks before it throws the work away. An empty one just closes.
 *
 * ## Why this is an e2e file and not a component test
 *
 * `form-modal.test.tsx` already proves the mechanism on a harness. What it cannot prove is the
 * claim the design rests on: that **dirtiness is known** for the fields this product actually uses.
 * The rejected alternative — listening for `input` and `change` on the panel — passes every unit
 * test and then loses a user's work in the browser, because a React Aria `Select` renders its
 * listbox in a portal **outside** the panel and commits through `state.setSelectedKey` rather than
 * by dispatching a DOM event. The `currency alone` case below is that exact scenario, and it is the
 * reason this file exists.
 *
 * ## What is asserted
 *
 * 1. Pristine closes. That is the half the blanket `isDismissable={false}` got wrong: a dialog
 *    opened by mistake was as unclosable as a half-filled one, with the scrim and Escape both dead.
 * 2. Dirty asks, and the form behind the question keeps every value.
 * 3. Keep editing returns to the form; Discard changes closes it.
 * 4. A control that **commits** — the filter panel's Apply — closes without a question, because
 *    asking "discard your changes?" about work that was just applied has no true answer.
 *
 * `useLocale(context, 'en')` on every case: the assertions read copy, and `dialog.unsaved.*` ships
 * in both catalogues.
 */

test.use({ storageState: storageStateFor('demo') })

const UNSAVED_TITLE = 'Unsaved changes'
const KEEP_EDITING = 'Keep editing'
const DISCARD = 'Discard changes'

/** The alert is a nested overlay, so the form's own `role="dialog"` stays in the tree behind it. */
function alert(page: Page) {
  return page.getByRole('alertdialog', { name: UNSAVED_TITLE })
}

/**
 * Presses Escape and settles.
 *
 * Escape rather than a click on the scrim because it is the one gesture available at every viewport
 * this file runs at, and both end in the same overlay `close()` — which is the code path under test.
 */
async function pressEscape(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
}

test.describe('a form dialog', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('closes on Escape while it is still empty', async ({
    page,
    context,
  }) => {
    await useLocale(context, 'en')
    await gotoApp(page, '/accounts')
    await page.getByRole('button', { name: 'New account' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await pressEscape(page)

    await expect(alert(page)).toBeHidden()
    await expect(dialog).toBeHidden()
  })

  test('asks before discarding a typed name, and keeps it while it asks', async ({
    page,
    context,
  }) => {
    await useLocale(context, 'en')
    await gotoApp(page, '/accounts')
    await page.getByRole('button', { name: 'New account' }).click()

    const name = page.getByRole('textbox', { name: 'Account name' })
    await name.fill('Holiday fund')

    await pressEscape(page)

    await expect(alert(page)).toBeVisible()
    // The form is still mounted behind the question, so nothing it holds has been thrown away
    // while the question is open. A guard that discarded first would have nothing to keep.
    await expect(name).toHaveValue('Holiday fund')

    await page.getByRole('button', { name: KEEP_EDITING }).click()

    await expect(alert(page)).toBeHidden()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(name).toHaveValue('Holiday fund')
  })

  test('discard changes closes the form', async ({ page, context }) => {
    await useLocale(context, 'en')
    await gotoApp(page, '/accounts')
    await page.getByRole('button', { name: 'New account' }).click()

    await page
      .getByRole('textbox', { name: 'Account name' })
      .fill('Holiday fund')
    await pressEscape(page)
    await expect(alert(page)).toBeVisible()

    await page.getByRole('button', { name: DISCARD }).click()

    await expect(alert(page)).toBeHidden()
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('notices a currency chosen from the portalled listbox and nothing else', async ({
    page,
    context,
  }) => {
    await useLocale(context, 'en')
    await gotoApp(page, '/accounts')
    await page.getByRole('button', { name: 'New account' }).click()

    // The whole point of the case: a `Select` commits in a popover rendered outside the panel and
    // fires no `change` at the DOM. Nothing is typed anywhere.
    //
    // The trigger's accessible name is the *value* followed by the label — "PLN · Polish złoty
    // Currency" — so the label is matched at the end and the value read off the same string.
    const currency = page.getByRole('button', { name: /Currency$/ })
    const before = (await currency.textContent()) ?? ''
    await currency.click()

    const options = page.getByRole('option')
    await expect(options.first()).toBeVisible()
    const offered = await options.allTextContents()
    const other = offered.find((text) => !before.startsWith(text))
    expect(
      other,
      'The demo workspace offers a single currency, so this case cannot tell a guard that watches the Select from one that watches nothing.',
    ).toBeDefined()

    await page.getByRole('option', { name: other, exact: true }).click()
    await expect(currency).not.toHaveText(before)

    // The header's X rather than Escape: React Aria's `Select` swallows the first Escape after its
    // listbox has been open, and this case is about what the guard *knows*, not about which gesture
    // reaches it. The gestures are the subject of the cases above.
    await page.getByRole('button', { name: 'Close' }).click()

    await expect(
      alert(page),
      'A currency change is a change. A guard that reads it as pristine discards it on the next scrim press.',
    ).toBeVisible()
  })
})

test.describe('the transactions filter panel', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  async function openPanel(page: Page): Promise<void> {
    await page.getByRole('button', { name: /^Filters/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  }

  /**
   * The direction radio, which is a draft field.
   *
   * Deliberately not one of the panel's search boxes: those filter the option list a picker offers
   * and never reach `panelDraft`, so typing in one is not an edit and must not raise the guard.
   */
  function direction(page: Page, name: string) {
    return page.getByRole('dialog').getByRole('radio', { name, exact: true })
  }

  /**
   * Moves the direction radio off "All" with the keyboard.
   *
   * `check()` clicks the `<input>`, and React Aria's is visually hidden underneath the drawn
   * control, so the press lands on the decorative span every time. Arrowing through the group is
   * both the real keyboard path and the one that does not depend on where a box is painted.
   */
  async function chooseIncome(page: Page): Promise<void> {
    await direction(page, 'All').focus()
    await page.keyboard.press('ArrowRight')
    await expect(direction(page, 'Income')).toBeChecked()
  }

  test('closes on Escape while its draft matches the view', async ({
    page,
    context,
  }) => {
    await useLocale(context, 'en')
    await gotoApp(page, '/transactions')
    await openPanel(page)

    await pressEscape(page)

    await expect(alert(page)).toBeHidden()
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('asks once the draft has moved, and returns to it on keep editing', async ({
    page,
    context,
  }) => {
    await useLocale(context, 'en')
    await gotoApp(page, '/transactions')
    await openPanel(page)

    await chooseIncome(page)

    await pressEscape(page)

    await expect(alert(page)).toBeVisible()
    await page.getByRole('button', { name: KEEP_EDITING }).click()

    await expect(alert(page)).toBeHidden()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(direction(page, 'Income')).toBeChecked()
  })

  test('applying the draft closes without a question', async ({
    page,
    context,
  }) => {
    await useLocale(context, 'en')
    await gotoApp(page, '/transactions')
    await openPanel(page)

    await chooseIncome(page)

    // Apply commits the draft, so it closes through the panel's own open state rather than through
    // the guarded `close`. Anything else would ask about work it had just written.
    await page.getByRole('button', { name: 'Apply', exact: true }).click()

    await expect(alert(page)).toBeHidden()
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('closes without a question after a filter was ticked and unticked again', async ({
    page,
    context,
  }) => {
    await useLocale(context, 'en')
    await gotoApp(page, '/transactions')
    await openPanel(page)

    // A checkbox group replaces its whole value on every toggle, so unticking the last option
    // writes an empty list where the view it opened from has no such narrowing at all. Nothing
    // was left to discard, so nothing may be asked about.
    //
    // Scoped to the payment-method group and driven from the keyboard for the same two reasons
    // `chooseIncome` is: an account may well be called "Cash" too, and React Aria's input is
    // visually hidden under the drawn box, so a click lands on the decorative span.
    const cash = page
      .getByRole('dialog')
      .getByRole('group', { name: 'Payment method' })
      .getByRole('checkbox', { name: 'Cash', exact: true })

    await cash.focus()
    await page.keyboard.press('Space')
    await expect(cash).toBeChecked()
    await page.keyboard.press('Space')
    await expect(cash).not.toBeChecked()

    await pressEscape(page)

    await expect(alert(page)).toBeHidden()
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('reopening after a discarded edit starts from the applied view', async ({
    page,
    context,
  }) => {
    await useLocale(context, 'en')
    await gotoApp(page, '/transactions')
    await openPanel(page)

    await chooseIncome(page)
    await pressEscape(page)
    await page.getByRole('button', { name: DISCARD }).click()
    await expect(page.getByRole('dialog')).toBeHidden()

    await openPanel(page)

    // The baseline is re-taken at each open — the panel outlives its own opens, so a snapshot from
    // first render would call this second one dirty and ask about an edit that was discarded.
    await expect(direction(page, 'All')).toBeChecked()

    await pressEscape(page)
    await expect(alert(page)).toBeHidden()
    await expect(page.getByRole('dialog')).toBeHidden()
  })
})
