import { expect, test } from './support/console'

import { gotoApp, useLocale } from './support/app'
import { storageStateFor } from './support/session'

import en from '#/lib/i18n/messages/en'

import type { Locator } from '@playwright/test'
import type { AppLocale } from './support/app'

/**
 * Kind tiles on the empty `/accounts` and `/budgets` screens are one set:
 * stacked inside, equal outside. Both screens render `KindTile` (#567).
 *
 * ## The fault this file exists to catch
 *
 * The tiles asked the shared `Button` for a column (`flex-col`), but the button lays its content
 * out in its own inner row, so the request never reached the icon, the title and the help text:
 * they rendered side by side. The button also sized itself to its own content, so the tile with
 * the longer help text ("Chosen by hand") was taller than its neighbour (124px against 106px at
 * 360 wide). `/accounts` hid the same fault because each tile carries one label.
 *
 * jsdom has no layout, so none of this can be asserted in the unit test: this is the layer that
 * can see it. Boxes are measured rather than photographed (ADR 0016).
 *
 * ## 360 and 1280
 *
 * 360 is the width at which the grid is one column and the tiles wrap under each other, and where
 * the help text breaks across the most lines; 1280 is the multi-column row, where equal height is
 * the stretch of the grid cell and not a coincidence of the copy. Polish is the longer catalogue.
 *
 * ## The names come from the catalogue
 *
 * The English sentences are read from `en.ts`, so this asserts the copy that ships. The Polish
 * ones are quoted, for the `import.meta.glob` reason `support/app.ts` sets out.
 */

test.use({ storageState: storageStateFor('empty') })

interface TileCopy {
  readonly title: string
  readonly help?: string
}

const SCREENS: ReadonlyArray<{
  readonly path: '/budgets' | '/accounts'
  readonly count: number
  readonly tiles: Record<AppLocale, readonly TileCopy[]>
}> = [
  {
    path: '/budgets',
    count: 2,
    tiles: {
      en: [
        {
          title: en['budgets.kind.category'],
          help: en['budgets.kind.category.help'],
        },
        {
          title: en['budgets.kind.manual'],
          help: en['budgets.kind.manual.help'],
        },
      ],
      pl: [
        {
          title: 'Kategorie',
          help: 'Liczy każdy wydatek z wybranych kategorii i ich podkategorii.',
        },
        {
          title: 'Wybrane ręcznie',
          help: 'Liczy tylko te wydatki, które sam do niego dodasz. Na wyjazd, remont albo jednorazowy zakup.',
        },
      ],
    },
  },
  {
    path: '/accounts',
    count: 3,
    tiles: {
      en: [
        { title: en['accounts.category.current'] },
        { title: en['accounts.category.cash'] },
        { title: en['accounts.category.creditCard'] },
      ],
      pl: [
        { title: 'Konto osobiste' },
        { title: 'Gotówka' },
        { title: 'Karta kredytowa' },
      ],
    },
  },
]

const WIDTHS = [360, 1280] as const
const LOCALES = ['en', 'pl'] as const satisfies readonly AppLocale[]

/** Sub-pixel rounding on a fractional layout; anything over this is a visible step. */
const TOLERANCE = 1

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('element is not rendered')
  return box
}

for (const screen of SCREENS) {
  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      test(`the empty ${screen.path} kind tiles stack inside and share a height — ${width}px · ${locale}`, async ({
        page,
        context,
      }) => {
        await page.setViewportSize({ width, height: 900 })
        await useLocale(context, locale)
        await gotoApp(page, screen.path)

        const tiles = page.locator(
          'main section[aria-labelledby] ul > li button',
        )
        await expect(tiles).toHaveCount(screen.count)

        const boxes = []
        for (let index = 0; index < screen.count; index += 1) {
          boxes.push(await boxOf(tiles.nth(index)))
        }
        for (let index = 1; index < boxes.length; index += 1) {
          expect(
            Math.abs(boxes[0].height - boxes[index].height),
            `tiles 0 and ${index} are ${boxes[0].height}px and ${boxes[index].height}px tall`,
          ).toBeLessThanOrEqual(TOLERANCE)
        }

        for (const [index, copy] of screen.tiles[locale].entries()) {
          const tile = tiles.nth(index)
          const tileBox = await boxOf(tile)
          const icon = await boxOf(tile.locator('svg'))
          const title = await boxOf(tile.getByText(copy.title, { exact: true }))

          const label = `"${copy.title}" at ${width}px`
          expect(
            icon.y + icon.height,
            `${label}: the icon sits above the title`,
          ).toBeLessThanOrEqual(title.y + TOLERANCE)
          expect(
            Math.abs(icon.x - title.x),
            `${label}: icon and title share a start edge`,
          ).toBeLessThanOrEqual(TOLERANCE)

          if (copy.help) {
            const help = await boxOf(tile.getByText(copy.help, { exact: true }))
            expect(
              title.y + title.height,
              `${label}: the title sits above the help`,
            ).toBeLessThanOrEqual(help.y + TOLERANCE)
            expect(
              Math.abs(title.x - help.x),
              `${label}: title and help share a start edge`,
            ).toBeLessThanOrEqual(TOLERANCE)
            expect(help.y + help.height).toBeLessThanOrEqual(
              tileBox.y + tileBox.height + TOLERANCE,
            )
          } else {
            expect(title.y + title.height).toBeLessThanOrEqual(
              tileBox.y + tileBox.height + TOLERANCE,
            )
          }
        }

        for (let index = 0; index < screen.count; index += 1) {
          const { height } = await boxOf(tiles.nth(index))
          expect(height).toBeGreaterThanOrEqual(44)
        }
      })
    }
  }
}
