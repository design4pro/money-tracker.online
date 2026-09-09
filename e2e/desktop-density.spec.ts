import { expect, test } from './support/console'

import { gotoApp, useLocale } from './support/app'
import { storageStateFor } from './support/session'

import type { Locator, Page } from '@playwright/test'
import type { AppLocale } from './support/app'

/**
 * What a screen must not do with 1440px.
 *
 * ## The fault this file exists to catch
 *
 * The inverse of `narrow-viewport.spec.ts`. There the defect is a row too small for its content;
 * here it is a row too large for it — a name and a handful of short facts ending at x≈455 with a
 * `border-subtle` rule drawn to x≈1360, which is a promise of a column that is not there. Seven
 * critics holding eight PNGs and no contact between them converged on it across six of seven
 * surfaces (`docs/rounds/2026-09-03-blind-comparison.md`, finding 1), and issue #18 carries the
 * measurements.
 *
 * ## The three shapes of the assertion
 *
 * `.ai/specs/2026-09-09-desktop-layout-density.md` decides per surface between capping the measure
 * and earning the width, and states each decision as something a browser can check at 1440×900:
 *
 * - **cap** — the named block's rendered width is ≤ 912px (the 896px band plus 16px of tolerance).
 * - **pair** — two cards sit on one row: equal `y`, differing `x`, each ≤ 620px.
 * - **earn** — the named band carries a rendered node within 32px of each of its two ends.
 *
 * ## Why measured rather than photographed
 *
 * ADR 0016 retired screenshot baselines: what a screen *looks* like is judged by a human against
 * the blind A/B pair, and frames are still taken by hand for review. What can be asserted
 * mechanically is narrower and more durable — a width, two box positions, a computed line-height —
 * and none of it needs a reference image to be true.
 *
 * ## Both locales, because `pl` is the longer catalogue
 *
 * A band tuned on English and broken in Polish is a failure this repository has recorded once
 * already, so every capped block is read in both. Strings are quoted rather than imported, for the
 * `import.meta.glob` reason `support/app.ts` sets out.
 */

test.use({
  storageState: storageStateFor('demo'),
  viewport: { width: 1440, height: 900 },
})

const LOCALES: readonly AppLocale[] = ['en', 'pl']

/* -------------------------------------------------------------------------- */
/* Phase 1 — the eight page subtitles                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every `_app` page whose `<h1>` is followed by a subtitle paragraph.
 *
 * Eight, not the seven surfaces issue #18 names: `DESIGN.md` → Layout claims product-wide that "no
 * running text is uncapped", so capping a subset would leave the design document false in between.
 */
const SUBTITLE_ROUTES = [
  '/categories',
  '/transactions/groups',
  '/accounts',
  '/budgets',
  '/recurring',
  '/payees',
  '/goals',
  '/transactions/rules',
] as const

/**
 * The two subtitles long enough that 65ch cannot hold them in either locale.
 *
 * `rules.subtitle` is 147 characters in `en` and 162 in `pl`; `groups.subtitle` is 134 and 166.
 * Both are more than twice the cap, so wrapping is not a judgement about how wide a `ch` is on the
 * machine running this — it is arithmetic. The shorter offenders (`categories`, `payees`) sit close
 * enough to the cap that asserting on their line count would be asserting about a font metric.
 */
const MUST_WRAP: ReadonlyArray<string> = [
  '/transactions/groups',
  '/transactions/rules',
]

for (const locale of LOCALES) {
  for (const route of SUBTITLE_ROUTES) {
    test(`the page subtitle on ${route} is capped without moving off the body leading — ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await gotoApp(page, route)

      const subtitle = page.locator('h1 + p').first()
      await expect(subtitle).toBeVisible()

      const measured = await subtitle.evaluate((element) => {
        const style = getComputedStyle(element)
        const root = getComputedStyle(document.documentElement)
        return {
          maxWidth: style.maxWidth,
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
          fontSize: Number.parseFloat(style.fontSize),
          lineHeight: Number.parseFloat(style.lineHeight),
          bodyLeading: Number.parseFloat(
            root.getPropertyValue('--text-body--line-height'),
          ),
          readingLeading: Number.parseFloat(
            root.getPropertyValue('--leading-reading'),
          ),
        }
      })

      // The cap is real, and the paragraph sits inside it.
      expect(measured.maxWidth).not.toBe('none')
      expect(measured.width).toBeLessThanOrEqual(
        Number.parseFloat(measured.maxWidth) + 1,
      )

      // `max-w-prose` caps width and nothing else. `prose-measure` would also set the reading
      // leading, which moves the block off the 2.5rem pitch `DESIGN.md` → The On-Pitch Rule
      // governs — so the leading here must still be the body's.
      expect(measured.lineHeight).toBeCloseTo(
        measured.fontSize * measured.bodyLeading,
        0,
      )
      expect(measured.bodyLeading).not.toBeCloseTo(measured.readingLeading, 2)

      // The two longest of the four subtitles that broke the 80-character ceiling of WCAG 1.4.8
      // now wrap, which is the visible half of this change and the half a reader notices.
      if (MUST_WRAP.includes(route)) {
        expect(measured.height).toBeGreaterThan(measured.lineHeight * 1.5)
      }
    })
  }
}

/* -------------------------------------------------------------------------- */
/* Phase 2 — the two capped blocks                                             */
/* -------------------------------------------------------------------------- */

/**
 * The list band, 896px, plus 16px of tolerance.
 *
 * The tolerance absorbs a scrollbar and sub-pixel rounding, not a second opinion about the band: a
 * block that took the whole well would measure ~1156px here, so nothing near the boundary is
 * ambiguous.
 */
const LIST_BAND_MAX = 912

/** The rendered width, refusing to measure something that is not on the page. */
async function widthOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('element is not rendered')
  return box.width
}

/**
 * Nothing in the capped block lost text to the cap.
 *
 * Only the elements carrying `truncate` can: everything else in a row is a fixed-size glyph or a
 * `shrink-0` badge. A category named at the length the seed data uses has to survive 896px, or the
 * band is too narrow rather than the layout too wide.
 */
async function clippedTextIn(block: Locator): Promise<ReadonlyArray<string>> {
  return block.evaluate((root) =>
    [...root.querySelectorAll('.truncate')]
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => element.textContent),
  )
}

/**
 * The whole cap contract for one block, at both widths.
 *
 * The page `<header>` is the reference width, not the viewport: it is the one block on these
 * screens meant to span the content column - title on one side, primary action on the other - so
 * its width is the width the capped block would have taken had nothing capped it. Comparing
 * against it rather than against 1440 keeps this true whatever the rail, the gutters and a
 * scrollbar cost on the machine running it.
 *
 * The 360px half is the other half of the promise: a phone never reaches the band, so a cap that
 * changes anything there is a regression rather than this change.
 */
async function expectCappedAtDesktopOnly(page: Page, block: Locator) {
  const band = page.locator('main header').first()
  await expect(block).toBeVisible()

  const wideBlock = await widthOf(block)
  const wideBand = await widthOf(band)

  // Capped, and the cap is doing something: the column it sits in is wider than it is.
  expect(wideBlock).toBeLessThanOrEqual(LIST_BAND_MAX)
  expect(wideBlock).toBeLessThan(wideBand - 1)

  await page.setViewportSize({ width: 360, height: 800 })
  await expect(block).toBeVisible()
  expect(await widthOf(block)).toBeCloseTo(await widthOf(band), 0)
}

for (const locale of LOCALES) {
  test(`the category tree takes the list band and not the whole well — ${locale}`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale)
    await gotoApp(page, '/categories')

    const tree = page.getByRole('grid').first()
    await expect(tree).toBeVisible()
    expect(await clippedTextIn(tree)).toEqual([])

    await expectCappedAtDesktopOnly(page, tree)
  })

  test(`the groups table takes the list band and not the whole well — ${locale}`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale)
    await gotoApp(page, '/transactions/groups')

    // The `TableContainer` carries the cap, not the grid inside it: the grid is allowed to outgrow
    // its container and scroll, which is exactly what four `minWidth` columns do at 360px.
    const container = page.getByRole('grid').first().locator('xpath=..')
    await expect(container).toBeVisible()

    // Four columns, still four columns. The spec's answer to "why not earn the width here" is that
    // the table already has its headers and issue #18 forbids inventing a fifth to fill the void.
    await expect(page.getByRole('columnheader')).toHaveCount(4)

    await expectCappedAtDesktopOnly(page, container)
  })
}

/* -------------------------------------------------------------------------- */
/* Phase 3 — `/recurring` earns its width with two panes                       */
/* -------------------------------------------------------------------------- */

/** The `Due soon` rail's grid track, 20rem, as `/recurring` states it from `lg` up. */
const RAIL_TRACK = 320

/**
 * The rendered box, refusing to measure something that is not on the page.
 *
 * `boundingBox` rather than a computed style, because what is being asserted here is where two
 * blocks sit relative to each other, which is the thing a reader sees.
 */
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('element is not rendered')
  return box
}

for (const locale of LOCALES) {
  test(`/recurring puts the series list and the rail on one row, and stacks them in DOM order below lg — ${locale}`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale)
    await gotoApp(page, '/recurring')

    // The one grid on this screen, and its two panes. `.first()` is the outer grid: the series
    // cards inside it come later in document order.
    const grid = page.locator('main div.grid').first()
    const panes = grid.locator('> *')
    await expect(panes).toHaveCount(2)

    const series = panes.nth(0)
    const rail = panes.nth(1)

    // Neither pane is placed by hand. `order`, `grid-row` and `grid-column` would each let the
    // visual order drift from the DOM order the screen reader follows, which is what WCAG 1.3.2
    // forbids and what this layout deliberately does not use.
    for (const pane of [series, rail]) {
      const placement = await pane.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          order: style.order,
          gridRow: style.gridRow,
          gridColumn: style.gridColumn,
        }
      })
      // Matched rather than compared: engines disagree on whether the resolved shorthand reads
      // `auto` or `auto / auto`, and the fact being asserted is that neither end was set.
      expect(placement.order).toBe('0')
      expect(placement.gridRow).toMatch(/^auto\b/)
      expect(placement.gridColumn).toMatch(/^auto\b/)
    }

    // 1440: one row. Same top edge, the rail to the end side, and the series pane inside the band.
    const wideSeries = await boxOf(series)
    const wideRail = await boxOf(rail)
    expect(wideSeries.y).toBeCloseTo(wideRail.y, 0)
    expect(wideRail.x).toBeGreaterThan(wideSeries.x + wideSeries.width - 1)
    expect(wideSeries.width).toBeLessThanOrEqual(LIST_BAND_MAX)

    // 1023 and 360: stacked, and stacked the way the DOM reads - `Due soon` below the list. This
    // is the phase's deliberate reorder, so it is asserted rather than left to a frame.
    for (const width of [1023, 360]) {
      await page.setViewportSize({ width, height: 900 })
      const stackedSeries = await boxOf(series)
      const stackedRail = await boxOf(rail)
      expect(stackedRail.x).toBeCloseTo(stackedSeries.x, 0)
      expect(stackedRail.y).toBeGreaterThan(
        stackedSeries.y + stackedSeries.height - 1,
      )
    }
  })

  test(`the /recurring rail keeps its column when nothing is due — ${locale}`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale)
    await gotoApp(page, '/recurring')

    const rail = page.locator('main div.grid').first().locator('> *').nth(1)
    await expect(rail).toBeVisible()

    // The rail's track is `20rem`, stated by the grid template rather than negotiated with what
    // the rail happens to hold. That is the whole of "keep the column when nothing is due": an
    // `auto` or `max-content` track would collapse toward the empty sentence and take the layout
    // with it, and this number is what would change if somebody wrote one.
    expect(await widthOf(rail)).toBeCloseTo(RAIL_TRACK, 0)

    // And the same, with the rail actually emptied. There is no seeded workspace holding series
    // with nothing outstanding, and writing recurring rows straight into D1 to make one would be a
    // lot of fixture for a claim about a grid track - so the content is removed in the page and
    // the track re-measured, which is the same variable isolated.
    await rail.evaluate((element) => {
      element.replaceChildren()
    })
    expect(await widthOf(rail)).toBeCloseTo(RAIL_TRACK, 0)
  })
}

/* -------------------------------------------------------------------------- */
/* Phase 4 — `/budgets` pairs                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Half the well, plus room to spare.
 *
 * Two cards in 1156px with a 16px gutter are ~570px each. 620 is that with enough slack that the
 * assertion is about "half the row", not about the exact gutter — a card that took the whole row
 * would measure ~1156px, so nothing sits near the boundary.
 */
const PAIRED_CARD_MAX = 620

for (const locale of LOCALES) {
  test(`/budgets puts two cards on one row from lg and one card per row below it — ${locale}`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale)
    await gotoApp(page, '/budgets')

    const cards = page.locator('main ul > li')
    // Three, because pairing is only observable with a third card to wrap onto the second row.
    expect(await cards.count()).toBeGreaterThanOrEqual(3)

    const first = await boxOf(cards.nth(0))
    const second = await boxOf(cards.nth(1))
    const third = await boxOf(cards.nth(2))

    // The pair: one row, two columns, neither of them the whole well.
    expect(first.y).toBeCloseTo(second.y, 0)
    expect(second.x).toBeGreaterThan(first.x + first.width - 1)
    expect(first.width).toBeLessThanOrEqual(PAIRED_CARD_MAX)
    expect(second.width).toBeLessThanOrEqual(PAIRED_CARD_MAX)

    // And the third wraps rather than shrinking the row to fit it.
    expect(third.x).toBeCloseTo(first.x, 0)
    expect(third.y).toBeGreaterThan(first.y + first.height - 1)

    // Below `lg` it is one column again, in DOM order.
    await page.setViewportSize({ width: 1023, height: 900 })
    const stackedFirst = await boxOf(cards.nth(0))
    const stackedSecond = await boxOf(cards.nth(1))
    expect(stackedSecond.x).toBeCloseTo(stackedFirst.x, 0)
    expect(stackedSecond.y).toBeGreaterThan(
      stackedFirst.y + stackedFirst.height - 1,
    )
  })

  test(`the filtered-empty budgets panel keeps the list band — ${locale}`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale)
    // The seeded workspace has nothing archived, so this filter is the empty branch of the same
    // screen the test above measures full.
    await gotoApp(page, '/budgets?status=archived')

    // The panel is the `<h2>`'s own card: the heading and the sentence under it are its only
    // children, so the parent element is the block whose width is in question.
    const panel = page.getByRole('heading', { level: 2 }).locator('xpath=..')

    // A filter that finds nothing must not also change how wide the page is - the panel takes the
    // band the list it replaces would have taken.
    await expectCappedAtDesktopOnly(page, panel)
  })
}
