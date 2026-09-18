import { expect, test } from './support/console'

import { gotoApp, uniqueToken, useLocale } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { d1Query, sqlText } from './support/d1'
import { storageStateFor } from './support/session'

import type { Page } from '@playwright/test'

/**
 * The import flow in a real browser, as far as `19-S2` goes and not one step further.
 *
 * ## What only an end-to-end run can say
 *
 * - A **windows-1250, `;`-delimited** file with Polish diacritics is read as text rather than as
 *   replacement characters. The encoding is decided from the bytes, and only a real upload carries
 *   real bytes.
 * - The **DMY/MDY question blocks**. Every sampled date below has a day and a month of 12 or lower,
 *   so the file genuinely cannot say which it means, and the mapping refuses to be confirmed until
 *   a person answers. That is the assertion the stage turns on: a silent default here misdates up
 *   to twelve rows in every thirty-one, and nobody notices for months.
 * - A **reload keeps the flow**. The header row is re-read from the stored file rather than held in
 *   the tab, and only a browser can prove that the second read happens at all.
 * - The **preview writes nothing**. This test stops at the summary. Writing the rows is `19-S3`,
 *   and its test is `19-S3`'s to write - which is also what makes this spec safe to run against the
 *   shared demo workspace every other suite reads.
 *
 * ## Three things this test has to do to stay honest
 *
 * The column names carry a per-run token, because confirming a mapping **saves it as a preset** and
 * a preset matching the header row pre-fills the next file - date format included. That is the
 * product working as designed, and it would quietly delete the blocking question this test exists
 * to prove, on every run after the first.
 *
 * Each attempt deletes the batch it created, because reading a file is metered. The demo workspace
 * is on a plan with `importsPerMonth: 2`, and the seed's own completed batch already counts in the
 * current month, so a second batch left behind by a failed attempt made every retry fail on the
 * quota rather than on anything it was testing (#295), and a persistent local database hit the same
 * wall one run later (#228). Nothing references the row except `import_row_errors`, which cascades,
 * and the test writes no transactions.
 *
 * The labels are quoted rather than imported for the reason `support/app.ts` gives: the catalogue
 * loader is built on `import.meta.glob`, which Playwright's module runner does not have. The
 * strings here are values from `src/lib/i18n/messages/en.ts`.
 */

test.use({ storageState: storageStateFor('demo') })

/**
 * windows-1250, byte for byte.
 *
 * Written as code points mapped into the encoding rather than as a UTF-8 string, because the
 * encoding *is* the fixture: `Ż`, `ł`, `ą` and `ó` are single bytes here (0xAF, 0xB3, 0xB9, 0xF3)
 * that are not valid UTF-8, which is exactly what the sniffer has to notice. A file written in
 * UTF-8 would test nothing this product gets wrong in the field.
 */
const CP1250 = new Map<string, number>([
  ['ą', 0xb9],
  ['ć', 0xe6],
  ['ę', 0xea],
  ['ł', 0xb3],
  ['ń', 0xf1],
  ['ó', 0xf3],
  ['ś', 0x9c],
  ['ź', 0x9f],
  ['ż', 0xbf],
  ['Ż', 0xaf],
  ['Ł', 0xa3],
])

function windows1250(text: string): Buffer {
  return Buffer.from(
    [...text].map(
      (character) => CP1250.get(character) ?? character.charCodeAt(0),
    ),
  )
}

/**
 * Three rows a Polish bank could have written, and every date is ambiguous on purpose.
 *
 * `03/04`, `05/06` and `07/08` all have both components at 12 or lower, so no sample settles day
 * first against month first. The amounts use a decimal comma, which is the mapping step's default.
 */
function statement(columns: ReadonlyArray<string>): string {
  return [
    columns.join(';'),
    '03/04/2026;Żabka nano 4471;-45,00',
    '05/06/2026;Kawiarnia Łąka;-12,50',
    '07/08/2026;Wypłata za czerwiec;1500,00',
    '',
  ].join('\r\n')
}

/** The Select whose accessible name contains `label`, as React Aria renders one. */
function picker(page: Page, label: string) {
  return page.getByRole('button', { name: new RegExp(label, 'u') })
}

/**
 * Chooses `option` in the Select named `label`, or its first option when none is named, and waits
 * until the choice has landed.
 *
 * Both waits are load-bearing on mobile WebKit (#295). A tap on an option while the popover is
 * still running its `pop-in` animation does not commit: the listbox stays open over the page, and
 * the *next* picker's click is the one that fails, intercepted by it for the whole action timeout.
 * So the option is clicked only once React Aria has dropped `data-entering`, and the helper
 * returns only once the listbox is gone and the button reads the chosen value.
 */
async function choose(page: Page, label: string, option?: string | RegExp) {
  await picker(page, label).click()
  await expect(page.locator('[data-entering]')).toHaveCount(0)
  await (
    option === undefined
      ? page.getByRole('option')
      : page.getByRole('option', { name: option, exact: false })
  )
    .first()
    .click()
  await expect(page.getByRole('listbox')).toBeHidden()
  if (option !== undefined) {
    await expect(picker(page, label)).toContainText(option)
  }
}

test.describe('import: map a statement and preview it', () => {
  /** The batch this attempt's upload created, if it got that far. */
  let batchId: string | undefined

  test.beforeEach(async ({ context }) => {
    await useLocale(context, 'en')
  })

  test.afterEach(async () => {
    if (batchId === undefined) return
    await d1Query(`delete from import_batches where id = ${sqlText(batchId)}`)
    batchId = undefined
  })

  test('reads a windows-1250 file, blocks on DMY/MDY, and previews without writing', async ({
    page,
  }) => {
    const token = uniqueToken('kol')
    const columns = [`Data ${token}`, `Opis ${token}`, `Kwota ${token}`]

    await gotoApp(page, '/import')

    await expect(
      page.getByRole('heading', { name: 'From your bank or a spreadsheet' }),
    ).toBeVisible()

    // The account the rows would land in. Any account of the demo workspace will do: this test
    // asserts nothing about balances, because nothing is written.
    await choose(page, 'Import into')

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: 'wyciag.csv',
        mimeType: 'text/csv',
        buffer: windows1250(statement(columns)),
      })

    await page.getByRole('button', { name: 'Read this file' }).click()
    await expect(page).toHaveURL(/\/import\/[^/?]+/u)
    batchId = new URL(page.url()).pathname.split('/').at(-1)

    // Step one of four, and the stepper says how long the flow is before anybody is inside it.
    await expect(
      page.getByRole('navigation', { name: 'Import steps' }).first(),
    ).toBeVisible()
    await expect(page.getByText('3 rows were read')).toBeVisible()

    await expectNoSeriousViolations(page, 'import upload step')

    await page.getByRole('link', { name: 'Next: Map the columns' }).click()

    // The diacritics survived the decode. Had the encoding been guessed as UTF-8, this cell would
    // read `Ĺ»abka` or carry replacement characters.
    await expect(page.getByText('Żabka nano 4471')).toBeVisible()

    // A reload, which is where this flow used to end: the tab that parsed the file is gone, so the
    // columns are re-read from the stored object. The account is the one thing that cannot come
    // back with them - no batch column holds it before a mapping is confirmed - so the step asks.
    await page.reload()
    // The one assertion here that outlives the suite's five-second budget, and the only one given a
    // longer one. It waits on a named, bounded piece of work - a cold R2 fetch and a second parse of
    // the whole file - and the step says `Reading the stored file again…` on screen while it runs.
    // Measured on CI run 33744603513: 4.36s and 4.62s where it passed, and a failure at 5.15s that
    // was the five-second budget expiring rather than the file being unreadable. Twelve is that
    // measurement with room, not an accommodation of a slow runner: a budget large enough to swallow
    // the test's own 30s ceiling would fail as a bare `Test timeout` naming nothing, which is the
    // barrier this file just finished removing.
    await expect(page.getByText('Żabka nano 4471')).toBeVisible({
      timeout: 12_000,
    })
    await choose(page, 'Import into')

    await choose(page, `What the column .${columns[0]}. holds`, 'Date')
    await choose(page, `What the column .${columns[1]}. holds`, 'Description')
    await choose(
      page,
      `What the column .${columns[2]}. holds`,
      /Amount, with its own sign/,
    )

    // The blocking question: in place, above the button it blocks, and not dismissible.
    const question = page.getByText('Which way round are these dates?')
    await expect(question).toBeVisible()

    // Trying to continue without answering keeps the person on the mapping step and says why.
    await page
      .getByRole('button', { name: 'Save the mapping and preview' })
      .click()
    await expect(
      page
        .getByText('Choose how this file writes its dates before continuing.')
        .first(),
    ).toBeVisible()
    await expect(question).toBeVisible()

    // The radio's own input is visually hidden under its label, the way every React Aria control is
    // built, so the click goes where a person's click goes: on the words.
    await page
      .getByText(/Day first/)
      .first()
      .click()
    await expect(page.getByRole('radio', { name: /Day first/ })).toBeChecked()

    await expectNoSeriousViolations(page, 'import mapping step')

    await page
      .getByRole('button', { name: 'Save the mapping and preview' })
      .click()

    // Step three: what the file would do, and the figures that would be written.
    await expect(
      page.getByRole('heading', { name: 'Review', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('grid', { name: /rows this file would create/ }),
    ).toBeVisible()

    // The summary, which is the number a person decides on: three rows read, three to create.
    const figure = (label: string) =>
      page
        .locator('dl div')
        .filter({ hasText: new RegExp(`^${label}`, 'u') })
        .first()
    await expect(figure('Rows read')).toContainText('3')
    await expect(figure('To create')).toContainText('3')

    // The net, not a heap of magnitudes: -45,00 and -12,50 leave, 1500,00 arrives, and the balance
    // moves by 1442,50. Summing the stored `amount_minor` alone would say 1557,50 here, which is a
    // figure no account will ever move by.
    await expect(figure('Change to the balance')).toContainText('1,442.50')

    // The dates were read day first, which is what the answer above chose: `03/04/2026` is the
    // third of April. Had the flow defaulted to month first, this row would say March.
    const zabka = page
      .getByRole('row')
      .filter({ hasText: 'Żabka nano 4471' })
      .first()
    await expect(zabka).toContainText('Apr')

    await expectNoSeriousViolations(page, 'import preview step')

    // Nothing was written and nothing here offers to: the fourth step is the seam `19-S3` fills.
    await page.getByRole('link', { name: 'Next: Import' }).click()
    await expect(page.getByText('Nothing has been written yet.')).toBeVisible()
  })
})
