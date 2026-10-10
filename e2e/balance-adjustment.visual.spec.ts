import { DELIBERATE_SERVER_FAILURE, expect, test } from './support/console'

import { gotoApp, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'
import { failServerFns, holdEveryServerFn } from './support/states'

import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'

import type { AppLocale, AppTheme } from './support/app'
import type { Locator, Page } from '@playwright/test'

/**
 * The balance-correction dialog in the browser: the axe gate `06-S3` phase C sets, and the claim
 * the dialog exists to make - the delta it names is the delta it writes, for any booking date.
 *
 * ## The gate
 *
 * Zero `serious`, zero `critical` with the dialog open and the preview settled, in both themes and
 * both locales, for the reasons `refunds.visual.spec.ts` gives: a dark theme is a different set
 * of colour tokens and a locale changes `<html lang>` and every accessible name.
 *
 * The states a person meets before it settles are scanned too, once each and in a rotating theme
 * and locale rather than across the full matrix: the loading state (the balance read held open),
 * the failed state (the read answered `500`, Try again visible, Record disabled) and the
 * future-date state (the picker's error shown). The settled state is also scanned at 360 px in
 * light/en and dark/pl, with a check that the dialog body does not scroll sideways.
 *
 * ## The keyboard path through Try again
 *
 * Reached with Tab only and activated with Enter and, separately, Space. A retry that succeeds
 * moves focus to the `role="status"` container; one that fails again says so there; and a person
 * who tabbed away while it was in flight keeps their focus.
 *
 * ## Typed future date and the result card
 *
 * A future date typed into the year segment reaches the dialog; it must disable Record, show the
 * error and start no read. That guard is interface only - the server still accepts a future date
 * (#657). The result card is reached through the `unchanged` outcome, which the real server
 * answers without writing a row, so no test here mutates the demo workspace.
 *
 * ## The demo workspace is read and never written
 *
 * Nothing here presses **Record the correction**, so `scripts/seed/verify.mjs` still finds every
 * counter it asserts. The write is exercised against a real database by
 * `repos/__tests__/accounts.test.ts` and `money-invariants.test.ts`.
 */

test.use({ storageState: storageStateFor('demo') })

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

/** Quoted from the catalogue rather than imported, for the `import.meta.glob` reason in `support/app.ts`. */
const LABELS: Readonly<
  Record<
    AppLocale,
    {
      readonly actions: RegExp
      readonly adjust: string
      readonly record: string
      readonly loading: RegExp
    }
  >
> = {
  en: {
    actions: /^Actions for /,
    adjust: 'Correct the balance',
    record: 'Record the correction',
    loading: /^Reading the balance on/,
  },
  pl: {
    actions: /^Działania dla konta /,
    adjust: 'Wyrównaj stan konta',
    record: 'Zapisz korektę',
    loading: /^Odczytujemy stan konta/,
  },
}

const CATALOGUE = { en, pl } as const

/** The catalogue sentence for a key, without its placeholders (all the sentences used here have none). */
function sentence(locale: AppLocale, key: keyof typeof en): string {
  const value = CATALOGUE[locale][key]
  if (typeof value !== 'string') {
    throw new Error(`${key} is a plural entry, not a sentence`)
  }
  return value
}

/** Opens the dialog on a page that is already on `/accounts`. */
async function openDialogOnAccounts(page: Page, locale: AppLocale) {
  const labels = LABELS[locale]
  await page.getByRole('button', { name: labels.actions }).first().click()
  await page.getByRole('menuitem', { name: labels.adjust }).click()
  const dialog = page.getByRole('dialog', { name: labels.adjust })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openDialog(page: Page, locale: AppLocale) {
  await gotoApp(page, '/accounts')
  return openDialogOnAccounts(page, locale)
}

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`the correction dialog has no serious or critical violations - ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      const labels = LABELS[locale]

      const dialog = await openDialog(page, locale)
      // Settled: the balance for today has been read, so the button is enabled and the status
      // region no longer says it is reading.
      await expect(dialog.getByRole('status')).not.toHaveText(labels.loading)
      await expect(
        dialog.getByRole('button', { name: labels.record }),
      ).toBeEnabled()

      await expectNoSeriousViolations(
        page,
        `/accounts with the correction dialog open (${theme}, ${locale})`,
      )
    })
  }
}

test('a past date previews a computed delta, not a promise to compute one later', async ({
  page,
}) => {
  const labels = LABELS.en
  const dialog = await openDialog(page, 'en')
  await expect(dialog.getByRole('status')).not.toHaveText(labels.loading)

  await dialog.getByRole('spinbutton', { name: /^day/i }).first().focus()
  await page.keyboard.press('ArrowDown')

  await expect(dialog.getByRole('status')).not.toHaveText(labels.loading)
  await expect(
    dialog.getByRole('button', { name: labels.record }),
  ).toBeEnabled()
  await expect(dialog.getByRole('status')).toHaveText(
    /Nothing\.|Money in of|An expense of/,
  )
})

/** The status sentence is no longer the loading one: the read has come back, whatever it said. */
async function expectSettled(dialog: Locator, locale: AppLocale) {
  await expect(dialog.getByRole('status')).not.toHaveText(
    LABELS[locale].loading,
  )
}

/** Types a year one past this year into the year segment, the way a person types a date. */
async function typeFutureYear(dialog: Locator, page: Page) {
  const year = String(new Date().getUTCFullYear() + 1)
  await dialog.getByRole('spinbutton', { name: /^year/i }).first().focus()
  await page.keyboard.type(year)
  return year
}

test.describe('the states before it settles, scanned by axe', () => {
  test('loading: the balance read is held open - light, en', async ({
    page,
  }) => {
    await gotoApp(page, '/accounts')
    const holding = await holdEveryServerFn(page)
    try {
      const dialog = await openDialogOnAccounts(page, 'en')
      await expect(dialog.getByRole('status')).toHaveText(LABELS.en.loading)
      await expect(
        dialog.getByRole('button', { name: LABELS.en.record }),
      ).toBeDisabled()

      await expectNoSeriousViolations(
        page,
        '/accounts with the correction dialog loading (light, en)',
      )
    } finally {
      await holding.release()
    }
  })

  test('failed: the read answered 500, Try again visible - dark, pl', async ({
    page,
    context,
    expectConsole,
  }) => {
    expectConsole(DELIBERATE_SERVER_FAILURE)
    await useLocale(context, 'pl')
    await useTheme(page, 'dark')
    await gotoApp(page, '/accounts')
    const failing = await failServerFns(page)
    try {
      const dialog = await openDialogOnAccounts(page, 'pl')
      await expect(
        dialog.getByRole('button', { name: sentence('pl', 'action.retry') }),
      ).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: LABELS.pl.record }),
      ).toBeDisabled()
      // The hit area is the design system's 44 px (`target-min`), drawn by a pseudo-element, so
      // it is read from the computed style rather than from the box.
      await expect(
        dialog.getByRole('button', { name: sentence('pl', 'action.retry') }),
      ).toHaveCSS('min-height', '44px', { pseudo: 'after' })

      await expectNoSeriousViolations(
        page,
        '/accounts with the correction dialog failed (dark, pl)',
      )
    } finally {
      await failing.release()
    }
  })

  test('future date: the picker shows its error - dark, en', async ({
    page,
  }) => {
    await useTheme(page, 'dark')
    const dialog = await openDialog(page, 'en')
    await expectSettled(dialog, 'en')

    await typeFutureYear(dialog, page)

    await expect(
      dialog.getByText(sentence('en', 'validation.date.future')),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: LABELS.en.record }),
    ).toBeDisabled()

    await expectNoSeriousViolations(
      page,
      '/accounts with the correction dialog on a future date (dark, en)',
    )
  })
})

test.describe('the settled state at 360 px', () => {
  for (const [theme, locale] of [
    ['light', 'en'],
    ['dark', 'pl'],
  ] as const) {
    test(`has no serious violations and no sideways scroll - ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)
      await page.setViewportSize({ width: 360, height: 800 })

      const dialog = await openDialog(page, locale)
      await expectSettled(dialog, locale)
      await expect(
        dialog.getByRole('button', { name: LABELS[locale].record }),
      ).toBeEnabled()

      // The body is the scrolling region (`overflow-y-auto`), so a wider child shows up as a
      // scroll width the client width does not cover.
      const overflow = await dialog.getByRole('status').evaluate((status) => {
        const body = status.closest('.overflow-y-auto')
        return body === null ? null : body.scrollWidth - body.clientWidth
      })
      expect(overflow, 'the dialog body scrolls sideways').toBe(0)

      await expectNoSeriousViolations(
        page,
        `/accounts with the correction dialog at 360 px (${theme}, ${locale})`,
      )
    })
  }
})

test('a typed future date is refused in the interface and starts no read', async ({
  page,
}) => {
  const reads: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/_serverFn/')) {
      reads.push(decodeURIComponent(request.url()))
    }
  })
  const dialog = await openDialog(page, 'en')
  await expectSettled(dialog, 'en')

  const year = await typeFutureYear(dialog, page)

  await expect(
    dialog.getByText(sentence('en', 'validation.date.future')),
  ).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: LABELS.en.record }),
  ).toBeDisabled()
  await expect(
    dialog.getByText(sentence('en', 'accounts.adjust.preview.blockedFuture')),
  ).toBeVisible()
  // The picker's own message, not React Aria's English "Value must be ... or earlier."
  await expect(dialog).not.toContainText('Value must be')
  // The reads the typing started for the years it passed through are fine; none is for the
  // year it ended on.
  expect(reads.filter((url) => url.includes(`${year}-`))).toEqual([])
})

test.describe('the keyboard path through Try again', () => {
  /** Tabs from wherever focus is until `target` has it, failing rather than looping for ever. */
  async function tabTo(page: Page, target: Locator) {
    for (let presses = 0; presses < 15; presses += 1) {
      await page.keyboard.press('Tab')
      if (await target.evaluate((node) => node === document.activeElement)) {
        return
      }
    }
    throw new Error('Try again was not reachable with Tab')
  }

  const retryName = sentence('en', 'action.retry')

  for (const key of ['Enter', 'Space'] as const) {
    test(`${key} retries, and success moves focus to the status container`, async ({
      page,
      expectConsole,
    }) => {
      expectConsole(DELIBERATE_SERVER_FAILURE)
      await gotoApp(page, '/accounts')
      const failing = await failServerFns(page)
      try {
        const dialog = await openDialogOnAccounts(page, 'en')
        const retry = dialog.getByRole('button', { name: retryName })
        await expect(retry).toBeVisible()
        await tabTo(page, retry)

        // The read works again before the retry is pressed.
        await failing.release()
        await page.keyboard.press(key)

        await expect(dialog.getByRole('status')).toBeFocused()
        await expect(dialog.getByRole('status')).toHaveText(
          /Nothing\.|Money in of|An expense of/,
        )
        await expect(retry).toHaveCount(0)
        await expect(
          dialog.getByRole('button', { name: LABELS.en.record }),
        ).toBeEnabled()
      } finally {
        await failing.release()
      }
    })
  }

  test('a retry that fails again says so and loses nothing', async ({
    page,
    expectConsole,
  }) => {
    expectConsole(DELIBERATE_SERVER_FAILURE)
    await gotoApp(page, '/accounts')
    const failing = await failServerFns(page)
    try {
      const dialog = await openDialogOnAccounts(page, 'en')
      const note = dialog.getByRole('textbox', { name: /^Reason/ })
      await note.fill('kept across the retry')
      const retry = dialog.getByRole('button', { name: retryName })
      await tabTo(page, retry)
      await page.keyboard.press('Enter')

      await expect(dialog.getByRole('status')).toContainText(
        /could not be read/,
      )
      await expect(retry).toBeVisible()
      await expect(note).toHaveValue('kept across the retry')
      await expect(
        dialog.getByRole('button', { name: LABELS.en.record }),
      ).toBeDisabled()
    } finally {
      await failing.release()
    }
  })

  test('tabbing away while the retry is in flight keeps focus where the person put it', async ({
    page,
    expectConsole,
  }) => {
    expectConsole(DELIBERATE_SERVER_FAILURE)
    await gotoApp(page, '/accounts')
    const failing = await failServerFns(page)
    try {
      const dialog = await openDialogOnAccounts(page, 'en')
      const retry = dialog.getByRole('button', { name: retryName })
      await tabTo(page, retry)

      await failing.release()
      const holding = await holdEveryServerFn(page)
      try {
        await page.keyboard.press('Enter')
        await page.keyboard.press('Tab')
        const elsewhere = await page.evaluate(
          () => document.activeElement?.outerHTML ?? '',
        )
        await holding.release()

        await expect(dialog.getByRole('status')).toHaveText(
          /Nothing\.|Money in of|An expense of/,
        )
        await expect(dialog.getByRole('status')).not.toBeFocused()
        expect(
          await page.evaluate(() => document.activeElement?.outerHTML ?? ''),
        ).toBe(elsewhere)
      } finally {
        await holding.release()
      }
    } finally {
      await failing.release()
    }
  })
})

test('the result card takes focus when Record unmounts, and states the written date', async ({
  page,
}) => {
  const dialog = await openDialog(page, 'en')
  await expectSettled(dialog, 'en')
  // The target is seeded with the balance, so the delta is zero and the server answers
  // `unchanged` without writing a row. Anything else would write to the demo workspace, so the
  // test stops here rather than press Record.
  await expect(dialog.getByRole('status')).toHaveText(/^Nothing\./)

  await dialog.getByRole('button', { name: LABELS.en.record }).click()

  const result = dialog.getByRole('status').filter({
    hasText: /Nothing was written/,
  })
  await expect(result).toBeVisible()
  await expect(result).toBeFocused()
})
