import { expect, test } from './support/console'

import { gotoApp, uniqueToken } from './support/app'
import { storageStateFor } from './support/session'

import type { Page } from '@playwright/test'

/**
 * Keyboard-only traversal of the two surfaces the product is used through: the ledger and the
 * entry form.
 *
 * ## Why this is an e2e spec and not a jsdom one
 *
 * `:focus-visible`, the roving `tabindex` and the sequential focus order are browser behaviour.
 * jsdom has no notion of a tab order at all — `userEvent.tab()` walks a hand-rolled approximation
 * of it — so a component suite can prove a key handler was called and nothing about where a
 * reader actually ends up. Every claim below is about where focus *is*, so it can only be made
 * here.
 *
 * ## What "reach every action" means
 *
 * `src/components/app/transactions/transaction-list.tsx` states the contract: the grid is **one**
 * tab stop, arrow keys move a roving cell inside it, and every row action is on a key —
 * `Space` selects, `Enter` opens, `e` edits, `d` duplicates, `Delete` deletes — so that a keyboard
 * reader never has to find the overflow button. Each of those is asserted, and the delete path is
 * exercised as far as its confirmation dialog and then cancelled: this suite reads the demo
 * workspace and never writes to it.
 */

/** A description of `document.activeElement` rich enough to assert against. */
async function focusReport(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null
    if (element === null) {
      return {
        tag: 'none',
        type: '',
        name: '',
        isGridCell: false,
        role: '',
        row: '',
        column: '',
      }
    }
    const labelled =
      element.id === ''
        ? null
        : document.querySelector(`label[for="${element.id}"]`)
    const name =
      element.getAttribute('aria-label') ??
      labelled?.textContent ??
      element.textContent
    return {
      tag: element.tagName,
      type: element.getAttribute('type') ?? '',
      name: name.replace(/\s+/g, ' ').replace(/\*$/, '').trim(),
      isGridCell: element.dataset.gridCell === 'true',
      role: element.getAttribute('role') ?? '',
      row:
        element.closest('[aria-rowindex]')?.getAttribute('aria-rowindex') ?? '',
      column: element.getAttribute('aria-colindex') ?? '',
    }
  })
}

/**
 * Walks the tab order from the skip link, recording every stop, until `stop` says to halt.
 *
 * The journey starts at "Skip to main content" because that is where a keyboard reader starts:
 * the whole point of the skip link is that the sidebar is not tabbed through on every page.
 */
async function tabThroughMain(
  page: Page,
  limit: number,
): Promise<Array<Awaited<ReturnType<typeof focusReport>>>> {
  await page.getByRole('link', { name: 'Skip to main content' }).focus()
  await page.keyboard.press('Enter')

  const stops: Array<Awaited<ReturnType<typeof focusReport>>> = []
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press('Tab')
    stops.push(await focusReport(page))
  }
  return stops
}

test.describe('the ledger, from the keyboard', () => {
  test.use({ storageState: storageStateFor('demo') })

  test.skip(
    ({ isMobile }) => isMobile === true,
    'A keyboard-only contract. The mobile project has no hardware keyboard.',
  )

  test('the grid is one tab stop, and no row menu is in the tab order', async ({
    page,
  }) => {
    await gotoApp(page, '/transactions')
    await expect(page.getByRole('grid')).toBeVisible()

    // Nothing has been asked for, so nothing is open. A menu that is in the document before it is
    // opened is a menu whose items are in the tab order of every row on the page.
    await expect(page.getByRole('menu')).toHaveCount(0)

    const stops = await tabThroughMain(page, 30)
    const menuStops = stops.filter((stop) => stop.role === 'menuitem')
    expect(
      menuStops,
      'a row action menu must not contribute tab stops: the grid promises exactly one',
    ).toHaveLength(0)

    const firstCell = stops.findIndex((stop) => stop.isGridCell)
    expect(
      firstCell,
      'tabbing through the filters must reach the grid',
    ).toBeGreaterThanOrEqual(0)

    const cellStops = stops.filter((stop) => stop.isGridCell)
    expect(
      cellStops,
      'the grid is a single tab stop, not one per cell',
    ).toHaveLength(1)
  })

  test('arrow keys move the roving cell, and every row action is on a key', async ({
    page,
  }) => {
    await gotoApp(page, '/transactions')
    const grid = page.getByRole('grid')
    await expect(grid).toBeVisible()

    // The roving stop starts on the header's description cell. It is focused directly rather than
    // tabbed to, because *which* cell currently holds the tab stop is the previous test's subject
    // and this one is about where the arrows go from a known cell.
    const descriptionHeader = grid.getByRole('columnheader').nth(2)
    await descriptionHeader.focus()
    expect((await focusReport(page)).isGridCell).toBe(true)

    await page.keyboard.press('ArrowDown')
    const firstRow = await focusReport(page)
    expect(firstRow.isGridCell).toBe(true)
    expect(
      firstRow.row,
      'the header is grid row 1, so the first transaction is row 2',
    ).toBe('2')

    await page.keyboard.press('ArrowDown')
    expect((await focusReport(page)).row).toBe('3')

    await page.keyboard.press('ArrowUp')
    expect((await focusReport(page)).row).toBe('2')

    const startColumn = Number((await focusReport(page)).column)
    await page.keyboard.press('ArrowRight')
    expect(Number((await focusReport(page)).column)).toBe(startColumn + 1)
    await page.keyboard.press('ArrowLeft')
    expect(Number((await focusReport(page)).column)).toBe(startColumn)

    /* ---- Space selects, and says so ------------------------------------- */

    await page.keyboard.press(' ')
    const bulkBar = page.getByRole('toolbar', {
      name: 'Actions for the selected entries',
    })
    await expect(bulkBar).toBeVisible()

    await page.keyboard.press(' ')
    await expect(bulkBar).toBeHidden()

    /* ---- Delete opens a confirmation rather than deleting ---------------- */

    await page.keyboard.press('Delete')
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(confirm).toBeHidden()

    /* ---- d duplicates, e edits, Enter opens ------------------------------ */

    await descriptionHeader.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('d')
    await expect(page).toHaveURL(/\/transactions\/new\?from=/)

    await gotoApp(page, '/transactions')
    await grid.getByRole('columnheader').nth(2).focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('e')
    await expect(page).toHaveURL(/\/transactions\/[^/?]+\?mode=edit/)

    await gotoApp(page, '/transactions')
    await grid.getByRole('columnheader').nth(2).focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/transactions\/[^/?]+$/)
  })
})

test.describe('the entry form, from the keyboard', () => {
  // Its own workspace: this describe writes rows, and the demo fixture's counters are asserted by
  // `scripts/seed/verify.mjs`.
  test.use({ storageState: storageStateFor('tenant-a') })

  test.skip(
    ({ isMobile }) => isMobile === true,
    'A keyboard-only contract. The mobile project has no hardware keyboard.',
  )

  test('every control is reachable, and the form submits without a mouse', async ({
    page,
  }) => {
    await gotoApp(page, '/transactions/new')

    // The amount is the first control and takes focus on arrival, because every entry starts with
    // a number. Anything else here would cost a keystroke twenty times a sitting.
    const amount = page.getByRole('textbox', { name: 'Amount' })
    await expect(amount).toBeFocused()

    const stops = await tabThroughMain(page, 18)
    const kinds = new Set(stops.map((stop) => `${stop.tag}:${stop.role}`))
    const names = stops.map((stop) => stop.name)

    // Every control the form ships, reached by Tab alone from the top of the main landmark: the
    // direction radio group (one stop, the checked radio), the amount, the three date segments and
    // the calendar button, the account, the payment method, the note, the planned checkbox and the
    // three actions. Nothing is mouse-only and nothing is skipped.
    expect(kinds.has('SPAN:spinbutton'), 'the date segments').toBe(true)
    expect(kinds.has('TEXTAREA:'), 'the note').toBe(true)
    expect(kinds.has('INPUT:'), 'the amount and the planned checkbox').toBe(
      true,
    )

    for (const label of ['month,', 'day,', 'year,', 'Open calendar']) {
      expect(names, `${label} must be a tab stop`).toContain(label)
    }
    for (const label of ['Cancel', 'Save and add another', 'Save']) {
      expect(names, `${label} must be a tab stop`).toContain(label)
    }
    // A radio group is a roving tab stop of its own: only the checked radio is tabbable, so the
    // whole "money in or out" question costs one Tab rather than two.
    const radioStops = stops.filter(
      (stop) => stop.tag === 'INPUT' && stop.type === 'radio',
    )
    expect(
      radioStops,
      'the direction radio group contributes exactly one stop',
    ).toHaveLength(1)

    /* ---- Submitting, and where focus goes afterwards --------------------- */

    const note = `Keyboard ${uniqueToken('kbd')}`
    await amount.focus()
    await page.keyboard.type('31.50')
    await page.getByRole('textbox', { name: 'Note' }).fill(note)

    // The repeat accelerator, bound on the form wrapper so it fires from the note box too.
    await page.keyboard.press('Control+Enter')

    // Focus lands back on the amount, which is the only thing left to type for the next receipt.
    await expect(amount).toBeFocused()
    await expect(page).toHaveURL(/\/transactions\/new/)

    // And the entry reached the ledger.
    await gotoApp(page, '/transactions')
    await expect(
      page.getByRole('link', { name: note, exact: true }),
    ).toBeVisible()
  })

  test('save and add another clears the amount it just saved', async ({
    page,
  }) => {
    await gotoApp(page, '/transactions/new')
    const amount = page.getByRole('textbox', { name: 'Amount' })
    await expect(amount).toBeFocused()

    await page.keyboard.type('12.34')
    await page.keyboard.press('Control+Enter')
    await expect(amount).toBeFocused()

    // `transaction-form.tsx` states the contract: "clears the amount, the payee and the note, then
    // returns focus to the amount", so that the next entry is "a number and a key". A field that
    // still shows the previous amount while the form holds `null` will refuse the next Enter with
    // "enter an amount" beside a box that visibly contains one.
    await expect(amount).toHaveValue('')
    await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('')
  })

  test('saving does not disable the field the caret is sitting in', async ({
    page,
  }) => {
    // The amount holds focus at the moment every save starts — it is the first control, it takes
    // focus on arrival, and `Ctrl`/`⌘ + Enter` puts the caret straight back into it. Disabling it
    // while it is focused makes the browser fire `blur` in the middle of React's commit, and React
    // Aria's number field commits its typed text from that handler with `flushSync` — which React
    // reports as "flushSync was called from inside a lifecycle method". Nothing visible breaks, so
    // the console is the only place it is ever said, and the focus the reader loses to `<body>` for
    // the length of the round trip is the part that actually costs them something.
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })

    await gotoApp(page, '/transactions/new')
    const amount = page.getByRole('textbox', { name: 'Amount' })
    await expect(amount).toBeFocused()

    await page.keyboard.type('9.99')
    await page.keyboard.press('Control+Enter')
    await expect(amount).toHaveValue('')

    expect(consoleErrors, 'a save must not write to the console').toEqual([])
  })
})
