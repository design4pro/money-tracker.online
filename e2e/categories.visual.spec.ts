import { expect, test } from './support/console'

import { gotoApp, useLocale, useTheme } from './support/app'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'
import type { Page } from '@playwright/test'

/**
 * `/categories` in a real browser: the refused drag.
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
 * ## The demo workspace is read and never written
 *
 * The drag is refused, and a refusal writes nothing, so `scripts/seed/verify.mjs` still counts the
 * rows it expects. The demo user owns its workspace (the seed signs it up through the real
 * endpoint), so the owner-or-admin gate passes and the refusal that arrives is the depth one.
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
}

const LABELS: Readonly<Record<AppLocale, CategoryLabels>> = {
  en: {
    title: 'Categories',
    tree: 'Categories, in display order',
    refusedTitle: 'That move was not made',
    nestSentence: (category, parent) =>
      `The category "${category}" cannot go inside "${parent}": categories nest only two levels.`,
    genericBody: 'The problem has been reported. Try again in a moment.',
  },
  pl: {
    title: 'Kategorie',
    tree: 'Kategorie w kolejności wyświetlania',
    refusedTitle: 'Nie udało się przenieść kategorii',
    nestSentence: (category, parent) =>
      `Kategoria „${category}” nie może trafić do kategorii „${parent}”: kategorie mają tylko dwa poziomy.`,
    genericBody: 'Zgłosiliśmy ten problem. Spróbuj ponownie za chwilę.',
  },
}

/** A parent with children, and a child of another parent: the seeded demo tree has both. */
const PARENT = 'Codzienne'
const TARGET_PARENT = 'Dom'
const TARGET_CHILD = 'Czynsz'

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

      // A refusal writes nothing: the tree after a reload is the tree before the drag.
      await page.reload()
      await expect(
        page.getByRole('heading', { level: 1, name: labels.title }),
      ).toBeVisible()
      expect(await tree.getByRole('row').allInnerTexts()).toEqual(before)
    })
  }
}
