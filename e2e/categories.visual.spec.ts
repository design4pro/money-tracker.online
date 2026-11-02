import { expect, test } from './support/console'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { expectOutlineWithoutSkips } from './support/headings'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'
import type { Page } from '@playwright/test'

/**
 * `/categories` in a real browser: the refused drag, the keyboard menu, the empty state, and the
 * axe gate Phase 5 of the categories spec adds on top of Phase 3.
 *
 * ## What this proves that the unit tests cannot
 *
 * The depth refusal reaches the screen as a failure envelope, not as the repository's error: the
 * server's failure middleware drops the error's own `code`, `childCount` and message before the
 * response leaves the Worker (`src/start.ts`). So `refusalOf` reads the envelope's `kind` from the
 * real transport, and the only test that can prove it still does is one that sends the real
 * request. The assertion is the named sentence, "cannot go inside", and not the generic body:
 * that is how this case fails if the kind stops surviving the wire. It is not to be weakened to
 * pass, and the message text is never the way out (`#734`, the stop rule of the spec's Phase 3).
 *
 * The row menu opened from the keyboard is the same contract `rules.visual.spec.ts` holds for
 * rules: the pointer path is not the only one, and a click would prove nothing about that.
 *
 * ## The demo workspace is read and never written
 *
 * The drag is refused, and a refusal writes nothing, so `scripts/seed/verify.mjs` still counts the
 * rows it expects. The demo user owns its workspace (the seed signs it up through the real
 * endpoint), so the owner-or-admin gate passes and the refusal that arrives is the depth one. The
 * keyboard case opens the menu and never activates a write. The empty-state case uses the `empty`
 * session and presses neither button.
 */

test.use({ storageState: storageStateFor('demo') })

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

/**
 * The screen's own labels, per locale.
 *
 * Quoted rather than imported, for the `import.meta.glob` reason `support/app.ts` sets out.
 */
interface CategoryLabels {
  /** `categories.title` */
  readonly title: string
  /** `categories.tree.label` */
  readonly tree: string
  /** `categories.move.refused` */
  readonly refusedTitle: string
  /** `categories.move.refused.nest`, with the names filled in. */
  readonly nestSentence: (category: string, parent: string) => string
  /** `empty.error.body`, which is what this case must NOT read. */
  readonly genericBody: string
  /** `action.moveUp` */
  readonly moveUp: string
  /** `action.moveDown` */
  readonly moveDown: string
  /** `action.moveToTop` */
  readonly moveToTop: string
  /** `action.moveToBottom` */
  readonly moveToBottom: string
  /** `action.moveTo` */
  readonly moveTo: string
  /** `categories.parent.none` */
  readonly topLevel: string
  /** `categories.empty.title` */
  readonly emptyTitle: string
  /** `categories.seed.action` */
  readonly seed: string
  /** `categories.create` */
  readonly create: string
  /** `categories.actions.label` for a named row. */
  readonly actionsFor: (name: string) => string
}

const LABELS: Readonly<Record<AppLocale, CategoryLabels>> = {
  en: {
    title: 'Categories',
    tree: 'Categories, in display order',
    refusedTitle: 'That move was not made',
    nestSentence: (category, parent) =>
      `The category "${category}" cannot go inside "${parent}": categories nest only two levels.`,
    genericBody: 'The problem has been reported. Try again in a moment.',
    moveUp: 'Move up',
    moveDown: 'Move down',
    moveToTop: 'Move to top',
    moveToBottom: 'Move to bottom',
    moveTo: 'Move to…',
    topLevel: 'Top level',
    emptyTitle: 'No categories yet',
    seed: 'Add the standard set',
    create: 'Add a category',
    actionsFor: (name) => `Actions for ${name}`,
  },
  pl: {
    title: 'Kategorie',
    tree: 'Kategorie w kolejności wyświetlania',
    refusedTitle: 'Nie udało się przenieść kategorii',
    nestSentence: (category, parent) =>
      `Kategoria „${category}” nie może trafić do kategorii „${parent}”: kategorie mają tylko dwa poziomy.`,
    genericBody: 'Zgłosiliśmy ten problem. Spróbuj ponownie za chwilę.',
    moveUp: 'Przenieś wyżej',
    moveDown: 'Przenieś niżej',
    moveToTop: 'Przenieś na początek',
    moveToBottom: 'Przenieś na koniec',
    moveTo: 'Przenieś do…',
    topLevel: 'Poziom główny',
    emptyTitle: 'Nie masz jeszcze kategorii',
    seed: 'Dodaj zestaw standardowy',
    create: 'Dodaj kategorię',
    actionsFor: (name) => `Działania dla: ${name}`,
  },
}

/** A parent with children, and a child of another parent: the seeded demo tree has both. */
const PARENT = 'Codzienne'
const TARGET_PARENT = 'Dom'
const TARGET_CHILD = 'Czynsz'

/** Demo top-level names, in seed order. The Move to… submenu lists these and nothing nested. */
const DEMO_PARENTS = ['Dom', 'Codzienne', 'Transport', 'Wpływy'] as const
/** Nested names the submenu must not offer. */
const DEMO_CHILDREN = [
  'Czynsz',
  'Media',
  'Zakupy spożywcze',
  'Restauracje',
  'Rozrywka',
  'Paliwo',
  'Bilety',
  'Wynagrodzenie',
  'Zwroty',
] as const

/**
 * Drags `parent` by keyboard to the slot between two children of `target`.
 *
 * React Aria's keyboard drag is a small protocol, and the order matters: the **row** takes focus
 * (focusing the handle directly hands focus to the first row instead), `ArrowRight` reaches the
 * drag handle inside it, `Enter` starts the drag and puts focus on the first drop target, and the
 * arrow keys walk the drop targets. A target's accessible name is localised ("Insert between X and
 * Y"), so the walk stops on the first one that names `target`, which is data and the same in both
 * locales.
 */
async function dragBesideChild(
  page: Page,
  parent: string,
  child: string,
): Promise<void> {
  const row = page.getByRole('row', { name: new RegExp(`^${parent}`) })
  // The row holds two buttons, the drag handle and the actions menu; only the handle has a slot.
  const handle = row.locator('button[slot="drag"]')
  // A refresh right after hydration can replace the row under the keyboard, so the focus step
  // retries as a unit rather than trusting the first `focus()`.
  await expect(async () => {
    await row.focus()
    await page.keyboard.press('ArrowRight')
    await expect(handle).toBeFocused({ timeout: 500 })
  }).toPass()

  await page.keyboard.press('Enter')
  const dropTarget = page.locator('[data-drop-target]')
  await expect(dropTarget).toHaveCount(1)

  for (let step = 0; step < 12; step++) {
    const name = await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label'),
    )
    if (name?.includes(child)) {
      await page.keyboard.press('Enter')
      return
    }
    await page.keyboard.press('ArrowUp')
  }
  throw new Error(`No drop target beside ${child} within twelve steps.`)
}

for (const locale of LOCALES) {
  for (const theme of THEMES) {
    test(`a parent dragged beside another parent's child is refused by name, ${locale} ${theme}`, async ({
      page,
      context,
      expectConsole,
    }) => {
      const labels = LABELS[locale]
      // The refusal is a real 409 from the server, and the browser reports every failed response.
      expectConsole([
        {
          why: 'the browser reporting the 409 the refused move is answered with, which is the behaviour under test',
          match:
            /^Failed to load resource: the server responded with a status of 409 \(Conflict\)$/,
        },
      ])
      await useLocale(context, locale)
      await useTheme(page, theme)
      await gotoApp(page, '/categories')
      await expect(
        page.getByRole('heading', { level: 1, name: labels.title }),
      ).toBeVisible()

      const tree = page.getByRole('grid', { name: labels.tree })
      const before = await tree.getByRole('row').allInnerTexts()
      expect(before.length).toBeGreaterThan(0)

      await dragBesideChild(page, PARENT, TARGET_CHILD)

      const region = page.getByRole('region', { name: labels.refusedTitle })
      await expect(region).toBeVisible()
      await expect(
        region.getByRole('heading', { level: 2, name: labels.refusedTitle }),
      ).toBeVisible()
      // The named sentence, not the generic body: this is the assertion that fails if the kind of
      // failure stops surviving the transport. It is never loosened to pass.
      await expect(region).toContainText(
        labels.nestSentence(PARENT, TARGET_PARENT),
      )
      await expect(region).not.toContainText(labels.genericBody)
      await expectNoSeriousViolations(
        page,
        `/categories refusal (${locale} ${theme})`,
      )
      await expectOutlineWithoutSkips(
        page,
        `/categories refusal (${locale} ${theme})`,
      )
      // The panel rests below the sticky header, not under it. The tree refresh that follows a
      // refusal makes the router restore the scroll position, which used to undo the panel
      // scrolling itself into view, so this settles by polling rather than reading once.
      const header = page.getByRole('banner').first()
      await expect
        .poll(
          async () => {
            const [regionBox, headerBox] = await Promise.all([
              region.boundingBox(),
              header.boundingBox(),
            ])
            if (regionBox === null || headerBox === null) return -Infinity
            return regionBox.y - (headerBox.y + headerBox.height)
          },
          { message: 'the refusal panel is hidden under the sticky header' },
        )
        .toBeGreaterThanOrEqual(-2)

      // A refusal writes nothing: the tree after a reload is the tree before the drag.
      await page.reload()
      await expect(
        page.getByRole('heading', { level: 1, name: labels.title }),
      ).toBeVisible()
      expect(await tree.getByRole('row').allInnerTexts()).toEqual(before)
    })
  }
}

for (const locale of LOCALES) {
  for (const theme of THEMES) {
    test(`/categories at rest has no serious or critical violations, ${locale} ${theme}`, async ({
      page,
      context,
    }) => {
      const labels = LABELS[locale]
      await useLocale(context, locale)
      await useTheme(page, theme)
      await gotoApp(page, '/categories')
      await expect(
        page.getByRole('heading', { level: 1, name: labels.title }),
      ).toBeVisible()
      await expect(
        page.getByRole('grid', { name: labels.tree }).getByRole('row').first(),
      ).toBeVisible()
      await expectNoSeriousViolations(
        page,
        `/categories rest (${locale} ${theme})`,
      )
    })

    test(`a child row menu opened from the keyboard offers ordering and Move to…, ${locale} ${theme}`, async ({
      page,
      context,
    }) => {
      const labels = LABELS[locale]
      await useLocale(context, locale)
      await useTheme(page, theme)
      await gotoApp(page, '/categories')
      await expect(
        page.getByRole('heading', { level: 1, name: labels.title }),
      ).toBeVisible()

      const row = page.getByRole('row', {
        name: new RegExp(`^${TARGET_CHILD}`),
      })
      const trigger = row.getByRole('button', {
        name: labels.actionsFor(TARGET_CHILD),
      })
      // Same protocol as the refused drag: the row takes focus, ArrowRight
      // walks into its buttons, and focusing the trigger directly hands focus
      // back to the first row.
      await expect(async () => {
        await row.focus()
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('ArrowRight')
        await expect(trigger).toBeFocused({ timeout: 500 })
      }).toPass()
      await page.keyboard.press('Enter')

      const menu = page.getByRole('menu')
      await expect(menu).toBeVisible()
      await expect(
        menu.getByRole('menuitem', { name: labels.moveUp }),
      ).toBeVisible()
      await expect(
        menu.getByRole('menuitem', { name: labels.moveDown }),
      ).toBeVisible()
      await expect(
        menu.getByRole('menuitem', { name: labels.moveToTop }),
      ).toBeVisible()
      await expect(
        menu.getByRole('menuitem', { name: labels.moveToBottom }),
      ).toBeVisible()
      await expect(
        menu.getByRole('menuitem', { name: labels.moveTo }),
      ).toBeVisible()
      // Czynsz is the first child of Dom, so moving it up would change nothing.
      await expect(
        menu.getByRole('menuitem', { name: labels.moveUp }),
      ).toBeDisabled()

      await expect(async () => {
        const focused = await page.evaluate(
          () => document.activeElement?.textContent ?? '',
        )
        if (focused.includes(labels.moveTo)) return
        await page.keyboard.press('ArrowDown')
        throw new Error(`still on “${focused.trim()}”, not ${labels.moveTo}`)
      }).toPass()
      await page.keyboard.press('ArrowRight')

      const submenu = page.getByRole('menu').last()
      await expect(submenu).toBeVisible()
      await expect(
        submenu.getByRole('menuitem', { name: labels.topLevel }),
      ).toBeVisible()
      for (const parent of DEMO_PARENTS) {
        await expect(
          submenu.getByRole('menuitem', { name: parent, exact: true }),
        ).toBeVisible()
      }
      for (const child of DEMO_CHILDREN) {
        await expect(
          submenu.getByRole('menuitem', { name: child, exact: true }),
        ).toHaveCount(0)
      }
      await expect(
        submenu.getByRole('menuitem', { name: TARGET_PARENT, exact: true }),
      ).toBeDisabled()
    })
  }
}

test.describe('an empty workspace', () => {
  test.use({ storageState: storageStateFor('empty') })

  for (const locale of LOCALES) {
    for (const theme of THEMES) {
      test(`offers the standard set first and a blank row second, ${locale} ${theme}`, async ({
        page,
        context,
      }) => {
        const labels = LABELS[locale]
        await useLocale(context, locale)
        await useTheme(page, theme)
        await gotoApp(page, '/categories')
        await expect(
          page.getByRole('heading', { level: 1, name: labels.title }),
        ).toBeVisible()

        const emptyTitle = page.getByRole('heading', {
          level: 2,
          name: labels.emptyTitle,
        })
        await expect(emptyTitle).toBeVisible()
        // The page header also holds "Add a category", so the two empty-state
        // actions are read from the dashed card that owns the empty heading.
        const empty = emptyTitle.locator(
          'xpath=ancestor::*[.//button][position()=1]',
        )
        const actions = empty.getByRole('button')
        await expect(actions).toHaveCount(2)
        await expect(actions.nth(0)).toHaveText(labels.seed)
        await expect(actions.nth(1)).toHaveText(labels.create)
        await expect(actions.nth(0)).toBeEnabled()
        await expect(actions.nth(1)).toBeEnabled()
      })
    }
  }
})
