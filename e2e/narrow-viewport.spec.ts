import { expect, test } from './support/console'

import { gotoApp, uniqueToken, useLocale } from './support/app'
import { storageStateFor } from './support/session'

import type { Locator, Page } from '@playwright/test'

/**
 * What a screen must still say at 360px.
 *
 * ## The fault this file exists to catch
 *
 * A flex row hands its shrinkage to whichever item can take it, and the only item that can is the
 * text node: a badge is `shrink-0`, a button is `shrink-0`, a `ResizableTableContainer` divides
 * the width it is given between its columns however narrow that is. So the element carrying the
 * screen's subject is the one that disappears while the chrome around it keeps full size — child
 * category names rendered as `C.` beside a `MONEY OUT` badge repeated down every row, a page
 * heading with two action buttons painted across it, a four-column table clipped at `EXPENS…`.
 * Every assertion below is that inversion, stated as something that can go red.
 *
 * ## Why this is measured rather than photographed
 *
 * ADR 0016 retired screenshot baselines: what a screen *looks* like is judged by a human against
 * the blind A/B pair. What can be asserted mechanically is narrower and more durable — whether a
 * text node was cut off, whether two boxes overlap, whether a table scrolls or clips — and none of
 * those needs a reference image to be true. A frame is still taken by hand for review; this file
 * is the part that stays green afterwards.
 *
 * ## 360, not 393
 *
 * `playwright.config.ts` runs `mobile-safari` at the iPhone 15's 393px and `mobile-chromium` at the
 * Pixel 7's 412px. 360px is the narrow end of the Android field and the width the round of
 * 2026-09-03 was judged at, and the 33px below the narrower of them
 * is exactly the margin these faults live in. So this file sets its own viewport.
 *
 * ## Polish, because it is the longer catalogue
 *
 * Every label here breaks first in Polish, and the round that found the faults was photographed in
 * it. The strings are quoted rather than imported, for the `import.meta.glob` reason
 * `support/app.ts` sets out: the catalogue loader is a Vite primitive Playwright's module runner
 * does not have, and importing it takes the suite down at collection time.
 */

test.use({
  storageState: storageStateFor('demo'),
  viewport: { width: 360, height: 800 },
})

const PL = {
  categoriesHeading: 'Kategorie',
  categoriesTree: 'Kategorie w kolejności wyświetlania',
  recurringHeading: 'Cykliczne',
  recurringNewSeries: 'Nowa seria',
  recurringFindPatterns: 'Znajdź wzorce w transakcjach',
  groupsHeading: 'Grupy wydatków',
  groupsTable: 'Grupy wydatków',
  membersHeading: 'Osoby',
  membersTable: 'W tym domu',
  importHeading: 'Import',
  importTable: 'Importy, od najnowszego',
} as const

/**
 * Whether an element's own text was cut off by its box.
 *
 * `scrollWidth > clientWidth` is what `text-overflow: ellipsis` leaves behind: the glyphs are
 * still laid out, the box is simply too small to show them. One pixel of slack absorbs the
 * sub-pixel rounding a fractional layout leaves on an integer property.
 */
async function isClipped(locator: Locator): Promise<boolean> {
  return locator.evaluate(
    (element) => element.scrollWidth - element.clientWidth > 1,
  )
}

/**
 * How much of an element's text its box actually shows, 0 to 1.
 *
 * A long name truncating at all is not the defect — a phone is 360px wide and something has to
 * give. The defect is *which* element gave: a name shown at 30% of itself beside a badge shown at
 * 100% of itself. So the assertions below are about the share, not about the ellipsis.
 */
async function visibleShare(locator: Locator): Promise<number> {
  return locator.evaluate((element) =>
    element.scrollWidth === 0 ? 0 : element.clientWidth / element.scrollWidth,
  )
}

/**
 * The share below which a name has stopped being a name.
 *
 * Measured on the seeded demo workspace at 360px in Polish: with the badge painted, the worst row
 * showed 30% of `Zakupy spożywcze` and four more sat between 43% and 47%; with the badge yielding,
 * the worst row shows 90% and every other row shows all of itself. Anything in between is the
 * fault coming back.
 */
const READABLE_SHARE = 0.75

/** Do these two boxes share a pixel? A control painted over a heading is this and nothing else. */
async function overlaps(a: Locator, b: Locator): Promise<boolean> {
  const [boxA, boxB] = await Promise.all([a.boundingBox(), b.boundingBox()])
  if (boxA === null || boxB === null) return false
  return (
    boxA.x < boxB.x + boxB.width &&
    boxB.x < boxA.x + boxA.width &&
    boxA.y < boxB.y + boxB.height &&
    boxB.y < boxA.y + boxA.height
  )
}

test.describe('a 360px screen still shows its own subject', () => {
  test('every category name is readable beside its badge', async ({ page }) => {
    await useLocale(page.context(), 'pl')
    await gotoApp(page, '/categories')
    await expect(
      page.getByRole('heading', { name: PL.categoriesHeading, level: 1 }),
    ).toBeVisible()

    const rows = page
      .getByRole('grid', { name: PL.categoriesTree })
      .getByRole('row')
    const count = await rows.count()
    expect(
      count,
      'the seeded demo workspace has categories to render',
    ).toBeGreaterThan(0)

    // The name is the only truncating span on the row: the drag handle, the two glyphs, the
    // colour dot and the overflow trigger carry no text of their own.
    for (let index = 0; index < count; index += 1) {
      const name = rows.nth(index).locator('span.truncate').first()
      const text = await name.textContent()
      // Polled rather than measured once: the tree mounts its drag-and-drop hooks after
      // hydration, and a width read in that frame is a measurement of a moving target — which
      // shows up as a row reporting a zero-width name that is plainly painted on the screenshot.
      await expect
        .poll(() => visibleShare(name), {
          message: `category row ${index} ("${text ?? ''}") gave its width away to the chrome beside it`,
        })
        .toBeGreaterThanOrEqual(READABLE_SHARE)
    }
  })

  test('the recurring header keeps its heading to itself', async ({ page }) => {
    await useLocale(page.context(), 'pl')
    await gotoApp(page, '/recurring')

    const heading = page.getByRole('heading', {
      name: PL.recurringHeading,
      level: 1,
    })
    // Playwright calls an element with an empty box hidden, which is precisely the fault: two
    // `shrink-0` buttons on the heading's own row squeezed it until it had no box at all, and the
    // page painted a lone `R` under them.
    await expect(
      heading,
      'the recurring heading has a box of its own at 360px',
    ).toBeVisible()

    for (const label of [PL.recurringFindPatterns, PL.recurringNewSeries]) {
      const action = page.getByRole('button', { name: label })
      expect(
        await overlaps(heading, action),
        `"${label}" is painted across the page heading at 360px`,
      ).toBe(false)
    }

    // The subtitle broke one word per line while the actions held it in a ~110px column. Its box
    // being most of the page says the same thing without depending on where the words fall.
    const subtitle = heading.locator('xpath=following-sibling::p[1]')
    const box = await subtitle.boundingBox()
    expect(box, 'the recurring subtitle is rendered').not.toBeNull()
    expect(
      box?.width ?? 0,
      'the subtitle is squeezed into a column too narrow to read',
    ).toBeGreaterThan(240)
  })

  /**
   * Every table that states column floors, not only the one the issue named.
   *
   * A floor is a promise about one column, so the way it fails is per column and per locale: the
   * groups table's action heading is `Akcje` and fits in the menu's own width, the members table's
   * is `Działania` and does not. Checking only the screen the report was written about would have
   * shipped the second one clipped.
   */
  for (const surface of [
    {
      route: '/transactions/groups',
      heading: PL.groupsHeading,
      table: PL.groupsTable,
      // The seed owns whether this workspace has groups, and the designed empty state is a
      // shipped state too — `transaction-groups.visual.spec.ts` makes the same allowance.
      skippableWhenEmpty: true,
    },
    {
      route: '/settings/members',
      heading: PL.membersHeading,
      table: PL.membersTable,
      skippableWhenEmpty: false,
    },
    {
      route: '/import',
      heading: PL.importHeading,
      table: PL.importTable,
      skippableWhenEmpty: true,
    },
  ]) {
    test(`${surface.route} scrolls rather than clipping its headings`, async ({
      page,
    }) => {
      await useLocale(page.context(), 'pl')
      await gotoApp(page, surface.route)
      await expect(
        page.getByRole('heading', { name: surface.heading, level: 1 }),
      ).toBeVisible()

      const table = page.getByRole('grid', { name: surface.table })
      if ((await table.count()) === 0) {
        test.skip(
          surface.skippableWhenEmpty,
          `the demo workspace has nothing to table on ${surface.route}`,
        )
        return
      }

      const headers = table.getByRole('columnheader')
      const headerCount = await headers.count()
      for (let index = 0; index < headerCount; index += 1) {
        const label = headers.nth(index).locator('span').first()
        expect(
          await isClipped(label),
          `"${(await label.textContent()) ?? ''}" was clipped instead of the table scrolling`,
        ).toBe(false)
      }

      // A table that refuses to shrink below its columns' floors is wider than the phone, and the
      // container it sits in is what scrolls. Both halves matter: overflow with no scroll port is
      // only a differently shaped clip.
      const scrolls = await table.evaluate((element) => {
        const container = element.parentElement
        if (container === null) return null
        return container.scrollWidth > container.clientWidth
      })
      expect(scrolls, 'the grid sits in a container').not.toBeNull()
      expect(
        scrolls,
        `the ${surface.route} table was squeezed into 360px instead of scrolling`,
      ).toBe(true)
    })
  }
})

/**
 * The listbox panel of a `Select` or a `ComboBox`: never narrower than its trigger, never wider
 * than `min(viewport - 24px, 32rem)`, and an option reads in full.
 *
 * The popover used to be pinned to the trigger's width, so the dashboard period selector's Polish
 * options ("Poprzedni miesiąc", "Ostatnie 12 miesięcy") ended in an ellipsis at 360px (#559). The
 * panel is now at least as wide as the trigger, grows to its longest option, is capped at the
 * viewport minus React Aria's 12px container padding on each side and at an absolute 32rem, and an
 * option past the cap wraps instead of ending in an ellipsis (`DESIGN.md` -> Select and ComboBox
 * popover, #580). jsdom has no layout, so this is measured in a browser.
 *
 * The width is asserted as a range and never as a constant: a `ComboBox` panel follows its filtered
 * list, so it may shrink while typing and grow on Backspace.
 */
const EDGE_PADDING = 12
const POPOVER_CAP_REM = 32

type PopoverKind = 'Select' | 'ComboBox'

/** The open panel of one kind, with the bounds it must stay inside, in CSS pixels. */
async function measurePanel(page: Page, kind: PopoverKind) {
  const popover = page.locator(`[data-trigger="${kind}"]`)
  await expect(popover).toBeVisible()
  return popover.evaluate((element) => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
    return {
      width: element.getBoundingClientRect().width,
      // React Aria publishes the trigger's width on the popover element itself.
      triggerWidth: parseFloat(
        getComputedStyle(element).getPropertyValue('--trigger-width'),
      ),
      viewport: window.innerWidth,
      rem,
    }
  })
}

async function expectPanelWithinBounds(
  page: Page,
  kind: PopoverKind,
  context: string,
): Promise<void> {
  // React Aria mounts the panel before it has measured the trigger: for a frame it is 0px wide and
  // `--trigger-width` is not yet set. Only a laid-out panel is a measurement.
  await expect
    .poll(
      async () => {
        const measured = await measurePanel(page, kind)
        return measured.width > 0 && Number.isFinite(measured.triggerWidth)
      },
      { message: `${context}: the panel was never laid out` },
    )
    .toBe(true)
  const panel = await measurePanel(page, kind)
  // The trigger's width is the floor and wins over the cap: a trigger wider than 32rem keeps its
  // own width. Two CSS pixels of slack covers subpixel layout (326.25 vs 328 on chromium).
  const cap = Math.max(
    panel.triggerWidth,
    Math.min(panel.viewport - 2 * EDGE_PADDING, POPOVER_CAP_REM * panel.rem),
  )
  expect(
    panel.width,
    `${context}: the panel is narrower than its trigger`,
  ).toBeGreaterThanOrEqual(panel.triggerWidth - 2)
  expect(
    panel.width,
    `${context}: the panel is wider than min(viewport - 24px, 32rem)`,
  ).toBeLessThanOrEqual(cap + 1)
}

/**
 * Focuses a field after scrolling it clear of the sticky action bar, and waits for the page to
 * stop moving.
 *
 * At 360px the form's footer covers the lower fields, the focus keeps scrolling the page for a few
 * frames, and React Aria closes a popover whose trigger scrolls — so the field has to be at rest
 * before it is opened.
 */
async function centreInViewport(field: Locator): Promise<void> {
  const page = field.page()
  await field.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await field.focus()
  let previous = -1
  await expect
    .poll(async () => {
      const top = await page.evaluate(() => window.scrollY)
      const settled = top === previous
      previous = top
      return settled
    })
    .toBe(true)
}

/** The label span of an option: the one that used to carry `truncate`. */
function optionLabel(option: Locator): Locator {
  return option.locator('span.flex-1')
}

/** Whether an option's label runs over more than one line. */
async function wraps(label: Locator): Promise<boolean> {
  return label.evaluate((element) => {
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight)
    return element.getBoundingClientRect().height > lineHeight * 1.5
  })
}

for (const scenario of [
  { locale: 'pl', width: 360, label: 'Okres' },
  { locale: 'pl', width: 1280, label: 'Okres' },
  { locale: 'en', width: 360, label: 'Period' },
  { locale: 'en', width: 1280, label: 'Period' },
] as const) {
  test(`the period listbox reads in full in ${scenario.locale} at ${scenario.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: scenario.width, height: 800 })
    await useLocale(page.context(), scenario.locale)
    await gotoApp(page, '/dashboard')

    const trigger = page.getByRole('button', { name: scenario.label })
    await trigger.click()
    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()

    const options = listbox.getByRole('option')
    const count = await options.count()
    expect(count, 'the period selector has options').toBeGreaterThan(0)
    for (let index = 0; index < count; index += 1) {
      const label = optionLabel(options.nth(index))
      const text = (await label.textContent()) ?? ''
      expect(await isClipped(label), `option "${text}" was clipped`).toBe(false)
      // The worst fixed label has to fit one line under the bound; wrapping is for user-named
      // options. When this goes red, 32rem is the number to revisit.
      expect(await wraps(label), `option "${text}" wrapped`).toBe(false)
    }

    await expectPanelWithinBounds(
      page,
      'Select',
      `period listbox, ${scenario.locale} ${scenario.width}px`,
    )

    // Selection and focus return are the part of a Select a width rule must not disturb.
    await page.keyboard.press('Escape')
    await expect(listbox).toBeHidden()
    await expect(trigger).toBeFocused()
  })
}

for (const width of [360, 1280]) {
  test(`a ComboBox panel stays inside its bounds while filtering at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await useLocale(page.context(), 'en')
    await gotoApp(page, '/transactions/new')

    const combobox = page.getByRole('combobox', { name: 'Category' })
    await centreInViewport(combobox)
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('listbox')).toBeVisible()
    await expectPanelWithinBounds(page, 'ComboBox', `unfiltered, ${width}px`)

    // Narrowing to nothing and widening again: the panel follows the list, so only the range is
    // asserted. "No matches" is the state that used to collapse to the trigger's width.
    for (const key of ['g', 'r', 'o', 'z', 'z', 'z']) {
      await page.keyboard.type(key)
      await expectPanelWithinBounds(
        page,
        'ComboBox',
        `after typing "${key}", ${width}px`,
      )
    }
    for (let erased = 0; erased < 6; erased += 1) {
      await page.keyboard.press('Backspace')
      await expectPanelWithinBounds(
        page,
        'ComboBox',
        `after Backspace ${erased + 1}, ${width}px`,
      )
    }
  })

  test(`a Select inside a dialog stays inside its bounds at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await useLocale(page.context(), 'en')
    await gotoApp(page, '/accounts')
    await page.getByRole('button', { name: 'New account' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // The trigger renders its value first and the label after it ("PLN · ... Currency").
    await dialog.getByRole('button', { name: /\bCurrency$/ }).click()
    await expect(page.getByRole('listbox')).toBeVisible()

    await expectPanelWithinBounds(
      page,
      'Select',
      `currency in a dialog, ${width}px`,
    )
  })

  test(`a very long option wraps inside the bound at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await useLocale(page.context(), 'en')

    // A payee name is user-typed and unbounded, which is what a fixed label never is. The long
    // unbroken word is the second half of the rule: it has to break rather than push the panel.
    // Four of them, because a listbox is a column flex container with a max height: one row never
    // overflows it, and it is the overflow that squeezes a row that is allowed to shrink.
    const token = uniqueToken('Wrap')
    await gotoApp(page, '/payees')
    for (const suffix of ['a', 'b', 'c', 'd']) {
      const name = `${token} ${suffix} ${'Przedsiebiorstwo Wielobranzowe '.repeat(4)}${'x'.repeat(40)}`
      await page.getByRole('button', { name: 'Add a payee' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      // Enter submits rather than a click: the success toast of the previous payee sits over the
      // dialog's footer button.
      const field = dialog.getByRole('textbox', { name: 'Name' })
      await field.fill(name)
      await field.press('Enter')
      await expect(dialog).toBeHidden()
    }

    await gotoApp(page, '/transactions/new')
    const combobox = page.getByRole('combobox', { name: 'Paid to' })
    await centreInViewport(combobox)
    await page.keyboard.type(token)

    const options = page.getByRole('option', { name: new RegExp(token) })
    await expect(options).toHaveCount(4)
    for (let index = 0; index < 4; index += 1) {
      const option = options.nth(index)
      const label = optionLabel(option)
      expect(
        await isClipped(label),
        `option ${index} was clipped instead of wrapping`,
      ).toBe(false)
      expect(await wraps(label), `option ${index} stayed on one line`).toBe(
        true,
      )
      // The row grows with its label: a row squeezed to its minimum height lets the next row paint
      // over the wrapped lines.
      const [rowBox, labelBox] = await Promise.all([
        option.boundingBox(),
        label.boundingBox(),
      ])
      expect(rowBox, `option ${index} has a box`).not.toBeNull()
      expect(labelBox, `option ${index} has a label box`).not.toBeNull()
      expect(
        rowBox?.height ?? 0,
        `option ${index}: the wrapped label spills out of its row`,
      ).toBeGreaterThanOrEqual(labelBox?.height ?? Infinity)
    }
    await expectPanelWithinBounds(page, 'ComboBox', `long option, ${width}px`)
  })
}
