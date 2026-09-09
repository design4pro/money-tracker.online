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

  test(`/recurring reads as one outline with no heading level skipped — ${locale}`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale)
    await gotoApp(page, '/recurring')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // Moving `Due soon` after the series list moved its `h2` after the cards' headings, and the
    // outline a screen reader announces followed: `h1` then a series name, two levels down with
    // nothing in between. The cards were never subsections of `Due soon` — they only read that
    // way while it happened to come first — so the levels are asserted here rather than left to
    // axe, whose `heading-order` rule is `best-practice` and excluded in `accessibility.spec.ts`.
    const levels = await page
      .locator('main :is(h1, h2, h3, h4, h5, h6)')
      .evaluateAll((elements) =>
        elements.map((element) => Number(element.tagName.slice(1))),
      )

    expect(levels.length).toBeGreaterThan(1)
    expect(levels[0]).toBe(1)
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index] - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1)
    }
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

/* -------------------------------------------------------------------------- */
/* Phase 5 — `/dashboard` panels end where their content ends                   */
/* -------------------------------------------------------------------------- */

for (const locale of LOCALES) {
  test(`the dashboard panels are not stretched to the tallest in their row — ${locale}`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale)
    await gotoApp(page, '/dashboard')

    const panels = page
      .getByRole('list', { name: /.+/ })
      .first()
      .locator('> li')
    expect(await panels.count()).toBeGreaterThanOrEqual(5)

    // The three panels of the second row at `xl`: a spending chart, an accounts list and a recent
    // list, each holding a different amount. Stretched, all three measured the tallest.
    const boxes = await Promise.all([
      boxOf(panels.nth(2)),
      boxOf(panels.nth(3)),
      boxOf(panels.nth(4)),
    ])
    const row = boxes.filter((box) => Math.abs(box.y - boxes[0].y) < 1)
    // Sanity: they are on one row, or this test is measuring something else.
    expect(row.length).toBe(3)

    const heights = new Set(row.map((box) => Math.round(box.height)))
    expect(heights.size).toBeGreaterThan(1)

    // Below `lg` the grid is one column, so `items-start` has nothing to do and the panels stack in
    // DOM order exactly as before.
    await page.setViewportSize({ width: 360, height: 800 })
    const stackedFirst = await boxOf(panels.nth(0))
    const stackedSecond = await boxOf(panels.nth(1))
    expect(stackedSecond.x).toBeCloseTo(stackedFirst.x, 0)
    expect(stackedSecond.y).toBeGreaterThan(
      stackedFirst.y + stackedFirst.height - 1,
    )
  })
}

/**
 * How close to an end of the band a node has to be to count as carrying it.
 *
 * 32px is the gap the shell already uses between two adjacent controls, so a node inside it is
 * flush with the end by the page's own vocabulary rather than by an arbitrary tolerance.
 */
const BAND_END_SLACK = 32

for (const locale of LOCALES) {
  test(`the dashboard header band carries a node at each of its ends — ${locale}`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale)
    await gotoApp(page, '/dashboard')

    // An assertion on behaviour that already passes, and that is the point: issue #18 measured an
    // empty ~1000px header strip here on 2026-09-03, the passbook work (`cf483b7`, `11e8848`)
    // closed it, and this spec's Non-goals say so. Without a case, that claim rots the first time
    // somebody empties the band again.
    const band = page.locator('main header > div').first()
    const bandBox = await boxOf(band)

    const ends = await band.evaluate((root) => {
      const own = root.getBoundingClientRect()
      const boxes = [...root.querySelectorAll('*')]
        .map((element) => element.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0)
      return {
        start: Math.min(...boxes.map((box) => box.left)) - own.left,
        end: own.right - Math.max(...boxes.map((box) => box.right)),
      }
    })

    // The band is worth asserting about only while it is wide enough to be empty.
    expect(bandBox.width).toBeGreaterThan(900)
    expect(ends.start).toBeLessThanOrEqual(BAND_END_SLACK)
    expect(ends.end).toBeLessThanOrEqual(BAND_END_SLACK)
  })
}

/* -------------------------------------------------------------------------- */
/* Phase 6 — the two toolbars earn their width                                 */
/* -------------------------------------------------------------------------- */

/**
 * Why the narrowing state is reached by URL rather than by archiving something.
 *
 * The counterweight is drawn only while the filter hides rows, and the seeded workspace has
 * nothing archived — so the state has to come from somewhere. Archiving an account through the UI
 * would reach it, and would also mutate a workspace the rest of this suite reads concurrently.
 * `?status=archived` reaches the same branch without writing anything: nothing matches, so every
 * one of the workspace's accounts is hidden, which is the widest the gap between shown and total
 * can be.
 */
const NARROWED = '/accounts?status=archived'

/**
 * One caption line plus the gap above it, at 360px.
 *
 * `text-caption` sets a 20px line box and the band's `gap-y-2` is 8px, so a count that wraps onto
 * its own row costs 28px. 40 leaves room for a second wrapped line in a longer locale without
 * admitting a node that took a block of its own.
 */
const CAPTION_LINE_BUDGET = 40

for (const locale of LOCALES) {
  test(`the /accounts filter band carries a counterweight only while it narrows — ${locale}`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale)
    await gotoApp(page, NARROWED)

    // The band is the row the segmented control sits on: the control at its start, the count at
    // its end. `main div` would match the page column, so the control's own parent is the anchor.
    const band = page.getByRole('radiogroup').first().locator('xpath=..')
    const bandBox = await boxOf(band)
    expect(bandBox.width).toBeGreaterThan(900)

    const count = band.locator('p')
    await expect(count).toBeVisible()
    const countBox = await boxOf(count)
    expect(
      bandBox.x + bandBox.width - (countBox.x + countBox.width),
    ).toBeLessThanOrEqual(BAND_END_SLACK)

    // `all` hides nothing, so "12 of 12" would be a sentence that says nothing and takes a line to
    // say it. It is not drawn at all.
    await gotoApp(page, '/accounts?status=all')
    const wideBand = page.getByRole('radiogroup').first().locator('xpath=..')
    await expect(wideBand).toBeVisible()
    await expect(wideBand.locator('p')).toHaveCount(0)
  })

  test(`the /accounts filter rule still reaches the end of the band — ${locale}`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale)
    await gotoApp(page, '/accounts')

    const control = page.getByRole('radiogroup').first()
    const band = control.locator('xpath=..')
    await expect(band).toBeVisible()

    // Putting a counterweight at the band's end made the segmented control a flex item, and a
    // flex item is as wide as its content — which took the control's own `border-b` with it,
    // from the band's full width down to the width of three words. The hairline is load-bearing:
    // the first account group below sets `first:border-t-0` precisely because it sits on this
    // rule rather than drawing a second one under it. So the rule belongs to the band now, and
    // the control must not draw a shorter copy of it.
    const bandRule = await band.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).borderBottomWidth),
    )
    const controlRule = await control.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).borderBottomWidth),
    )
    expect(bandRule).toBeGreaterThan(0)
    expect(controlRule).toBe(0)

    // And it reaches where the list below it reaches, which is the promise the group depends on.
    const bandBox = await boxOf(band)
    const listBox = await boxOf(page.locator('main ul.rounded-xl').first())
    expect(bandBox.x).toBeCloseTo(listBox.x, 0)
    expect(bandBox.width).toBeCloseTo(listBox.width, 0)
  })

  test(`the /accounts counterweight costs a phone one line and no more — ${locale}`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale)
    await page.setViewportSize({ width: 360, height: 800 })

    // This is one of the two phases that changes a narrow viewport, and the node it adds lands
    // directly above the list. `accounts/index.tsx` records what happened last time a row grew
    // here, so what this phase owes the phone is a bound on how much it grew by — measured as the
    // difference between the band with the count and the same band without it, in the same run.
    await gotoApp(page, '/accounts?status=all')
    const quiet = await boxOf(
      page.getByRole('radiogroup').first().locator('xpath=..'),
    )

    await gotoApp(page, NARROWED)
    const band = page.getByRole('radiogroup').first().locator('xpath=..')
    await expect(band.locator('p')).toBeVisible()
    const loaded = await boxOf(band)

    // One wrapped caption line and the 8px that separates it from the control above — never a
    // block of its own, and never a second copy of the control's own height.
    expect(loaded.height - quiet.height).toBeLessThanOrEqual(
      CAPTION_LINE_BUDGET,
    )
    expect(loaded.height).toBeGreaterThan(quiet.height)
  })
}

/**
 * How far a control may sit from the edge it is measured against.
 *
 * The bar's own gutter is `gap-2`, 8px. 16 is that with a pixel of slack, and it is nowhere near
 * the ~600px canyon the spec was written to rule out.
 */
const TOOLBAR_GUTTER_MAX = 16

/**
 * Why this test caps nothing.
 *
 * The spec's third Phase 6 item asks for a bounded width on the search field from `md` up, so the
 * icon controls close up beside it "into one start cluster". Measured before writing the change,
 * the field is already 274px (`en`) / 282px (`pl`) inside a 1156px bar at 1440×900, and every
 * control after it sits at the bar's own 8px gutter — the toolbar has since grown a date filter,
 * a sort select and a sort-direction button, and it is packed edge to edge. A `md:max-w-md` cap is
 * 448px, so it would not bind at any viewport and the diff would change no rendered pixel.
 *
 * This is the same call the spec itself makes about the dashboard header band: "A phase that
 * 'fixed' it would be a diff with no defect behind it." So the Step ships its assertion and not
 * its edit — which is worth more than the edit would have been, because the property the spec
 * cares about (one cluster, not a field and a canyon) was true only by accident of how many
 * controls the bar happens to hold, and is now something a browser checks in both locales.
 */
for (const locale of LOCALES) {
  test(`the /transactions toolbar reads as one cluster rather than a field and a canyon — ${locale}`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale)
    await gotoApp(page, '/transactions')

    // `SearchField` renders root > `FieldGroup` > input, so the input's grandparent is the field
    // and its great-grandparent is the bar every control on the row shares.
    const search = page.getByRole('searchbox').first()
    await expect(search).toBeVisible()
    const field = search.locator('xpath=../..')
    const bar = search.locator('xpath=../../..')

    const fieldBox = await boxOf(field)
    const barBox = await boxOf(bar)

    // The bar is wide; the field is not.
    expect(barBox.width).toBeGreaterThan(900)
    expect(fieldBox.width).toBeLessThan(barBox.width / 2)

    // And the next control sits beside it, at the bar's own gutter, rather than at the far end.
    const next = bar.locator('> *').nth(1)
    const nextBox = await boxOf(next)
    expect(nextBox.x - (fieldBox.x + fieldBox.width)).toBeLessThanOrEqual(
      TOOLBAR_GUTTER_MAX,
    )

    // On a phone the same row still belongs to the field: it is the widest thing on it, and the
    // row is full rather than trailing off. Pinning both is what would catch a later cap that
    // reached below `md` and left the search box stranded at half a screen.
    await page.setViewportSize({ width: 360, height: 800 })
    await expect(search).toBeVisible()
    const narrowField = await boxOf(field)
    const narrowBar = await boxOf(bar)
    const rendered = await bar.locator('> *').evaluateAll((elements) =>
      elements
        .map((element) => element.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0)
        .map((box) => ({ width: box.width, right: box.right })),
    )

    expect(Math.max(...rendered.map((box) => box.width))).toBe(
      narrowField.width,
    )
    expect(
      narrowBar.x + narrowBar.width - Math.max(...rendered.map((r) => r.right)),
    ).toBeLessThanOrEqual(TOOLBAR_GUTTER_MAX)
  })
}
