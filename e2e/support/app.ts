import { expect } from '@playwright/test'

import { THEME_STORAGE_KEY } from '#/lib/theme'

import {
  TRANSACTION_DETAIL_URL,
  TRANSACTION_ROW_SELECTOR,
} from './transactions'

import type { BrowserContext, Locator, Page } from '@playwright/test'

/**
 * The handful of things every spec in this suite does to the browser, and the labels it addresses
 * the product by.
 *
 * `THEME_STORAGE_KEY` is imported from the application rather than copied: a suite that spells
 * `'money-tracker.theme'` for itself keeps passing on the day the product renames the key and
 * stops honouring the theme, which is the one failure a theme test exists to catch.
 *
 * The locale cookie name cannot be imported the same way. `src/components/app/shell/locale-cookie`
 * re-exports through `#/lib/i18n`, whose catalogue loader is built on `import.meta.glob` — a Vite
 * primitive that does not exist in Playwright's own module runner, so the import takes the whole
 * suite down at collection time. It is mirrored here with the name of its owner attached instead.
 */

/** Mirrors `LOCALE_COOKIE` in `src/components/app/shell/locale-cookie.ts`. See the note above. */
const LOCALE_COOKIE = 'mtr_locale'

/** The shipped locales, as `src/lib/i18n/locales.ts` tags them. */
export type AppLocale = 'en' | 'pl'

export type AppTheme = 'light' | 'dark'

/* -------------------------------------------------------------------------- */
/* Addressing the product                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The visible strings the helpers below drive the product by, per locale.
 *
 * Every one of them is a value from `src/lib/i18n/messages/*.ts`, quoted rather than imported for
 * the `import.meta.glob` reason above. Written out per locale because half of this suite runs in
 * Polish: a helper hard-coded to "Save" would make a Polish money test unwritable, which is the
 * language whose decimal comma the money test exists to exercise.
 */
export interface UiLabels {
  readonly skipToContent: string
  readonly newAccount: string
  readonly accountName: string
  readonly currency: string
  readonly openingBalance: string
  readonly create: string
  readonly amount: string
  readonly account: string
  readonly note: string
  readonly save: string
}

export const LABELS: Readonly<Record<AppLocale, UiLabels>> = {
  en: {
    skipToContent: 'Skip to main content',
    newAccount: 'New account',
    accountName: 'Account name',
    currency: 'Currency',
    openingBalance: 'Opening balance',
    create: 'Create',
    amount: 'Amount',
    account: 'Account',
    note: 'Note',
    save: 'Save',
  },
  pl: {
    skipToContent: 'Przejdź do treści głównej',
    newAccount: 'Nowe konto',
    accountName: 'Nazwa konta',
    currency: 'Waluta',
    openingBalance: 'Stan początkowy',
    create: 'Utwórz',
    amount: 'Kwota',
    account: 'Konto',
    note: 'Notatka',
    save: 'Zapisz',
  },
}

/* -------------------------------------------------------------------------- */
/* Getting a page into a known state                                           */
/* -------------------------------------------------------------------------- */

/**
 * Puts the document in one language before the first byte is written.
 *
 * The negotiation chain runs on the server (`src/routes/__root.tsx`), so a language chosen after
 * load would be a second render correcting the first — and `<html lang>`, which is what a screen
 * reader picks its voice from, would state the previous language for the whole of the axe scan.
 * The cookie is the first rung of that chain, so setting it here is the same door the language
 * picker uses.
 *
 * It is written for **both** loopback names, and that is not belt and braces. A cookie is scoped
 * to the host it names, and this suite is run against either: `playwright.config.ts` defaults to
 * `localhost:3010`, while `.ai/scripts/test-env-up.sh` prints `PLAYWRIGHT_BASE_URL` on
 * `127.0.0.1` — for a reason of its own, that the seed's `fetch` resolves `localhost` to v4 while
 * a default Vite bind can be v6-only. Naming one host meant that following the setup script's own
 * instruction left every `pl` test looking at an English document: `<html lang>` read `en`, the
 * assertion failed on the language rather than on the screen, and the Polish half of the suite
 * proved nothing while reporting a defect. Measured on this branch: 30 of 32 chromium failures
 * were that, and all of them passed on `localhost` unchanged.
 */
export async function useLocale(
  context: BrowserContext,
  locale: AppLocale,
): Promise<void> {
  await context.addCookies(
    ['localhost', '127.0.0.1'].map((domain) => ({
      name: LOCALE_COOKIE,
      value: locale,
      domain,
      path: '/',
      sameSite: 'Lax' as const,
    })),
  )
}

/**
 * Pins the theme the way the product does: the stored mode plus the media preference.
 *
 * Both are needed and neither is enough. `data-theme` comes from the bootstrap script reading
 * `localStorage` before first paint, while `prefers-color-scheme` decides what the browser paints
 * behind the document and what the `system` branch of the token layer resolves to. Setting only
 * one of them scans a page no reader will ever see.
 */
export async function useTheme(page: Page, theme: AppTheme): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        // Blocked site data. The media preference still carries the theme.
      }
    },
    [THEME_STORAGE_KEY, theme] as const,
  )
  await page.emulateMedia({ colorScheme: theme })
}

/**
 * Waits until React has taken over the server-rendered document.
 *
 * This is not a nicety. Every control in this product is a React Aria component driven by
 * `onPress`, and the shell is streamed from the server, so between first paint and hydration the
 * page *looks* finished and answers nothing: a click lands on a button with no handler, and text
 * typed into an input is discarded when React attaches. Both read as "the form did not submit" —
 * a product bug that is not there.
 *
 * The signal is React's own: it stamps a `__reactFiber$<id>` property onto each host element as it
 * hydrates it, so one on the main landmark means the tree under it is live. It is the only marker
 * this application offers — nothing writes a `data-hydrated` attribute — and it is a private React
 * field, so a future React that drops it makes this helper time out loudly rather than quietly
 * pass a page that was never hydrated.
 *
 * `timeout` is a *budget*, not a tolerance: nothing that fails to hydrate is accepted, it is only
 * given longer to say so. The default is what every spec here has always used. The reason it is
 * adjustable at all is that hydration is gated on the client module graph, and under `pnpm dev`
 * Vite compiles that graph per route on first visit - so the first test to open a screen pays a
 * cost the twentieth does not, and a spec that opens seven screens once each pays it seven times.
 */
export async function waitForHydration(
  page: Page,
  timeout = 20_000,
): Promise<void> {
  await page.waitForFunction(
    () => {
      // `document.body` is null until the parser reaches it, and `waitForFunction` propagates a
      // throw instead of retrying past it - so an unguarded `Object.keys(null)` here does not
      // wait, it fails the test outright with "Cannot convert undefined or null to object". That
      // is a race against how early the first poll lands, which is why it shows up as an
      // occasional inexplicable red rather than as a broken helper.
      const element = document.querySelector('main') ?? document.body
      // `lib.dom` types `document.body` as non-nullable, which is the assumption that fails here.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (element === null) return false
      return Object.keys(element).some((key) => key.startsWith('__reactFiber$'))
    },
    undefined,
    { timeout },
  )
}

/** `page.goto`, and then the wait every interaction in this suite depends on. */
export async function gotoApp(
  page: Page,
  path: string,
  hydrationTimeout?: number,
): Promise<void> {
  await page.goto(path)
  await waitForHydration(page, hydrationTimeout)
}

/**
 * A token no other run can have produced.
 *
 * Rows created by the suite live in workspaces that persist between runs, so "the transaction I
 * just wrote" has to be findable by something a previous run cannot also match. A found-but-stale
 * row would make a money assertion pass against last run's number.
 */
export function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/* -------------------------------------------------------------------------- */
/* Driving the two write paths                                                 */
/* -------------------------------------------------------------------------- */

/** The account cards on `/accounts`, addressed the way a reader sees them: by name. */
export function accountLink(page: Page, name: string): Locator {
  return page.getByRole('link', { name, exact: true })
}

/** `RegExp` metacharacters in a fixture name, made literal. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface NewAccount {
  readonly name: string
  readonly currencyCode?: string
  readonly openingBalance?: string
  readonly labels?: UiLabels
}

/**
 * Creates an account through the dialog on `/accounts` and answers its id.
 *
 * The id comes from the URL of the account's own screen rather than from the database, because
 * that is the id a reader could put in a link — which is precisely the thing the tenant spec then
 * hands to the other workspace.
 */
export async function createAccountThroughUi(
  page: Page,
  options: NewAccount,
): Promise<string> {
  const labels = options.labels ?? LABELS.en

  await gotoApp(page, '/accounts')
  await page.getByRole('button', { name: labels.newAccount }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog
    .getByRole('textbox', { name: labels.accountName })
    .fill(options.name)

  if (options.currencyCode !== undefined) {
    // A React Aria `Select` renders its trigger with the *value* first and the label after it —
    // "PLN · Polish Zloty Currency" — so the label anchors at the end, never at the start.
    await dialog
      .getByRole('button', {
        name: new RegExp(`\\b${escapeRegExp(labels.currency)}$`),
      })
      .click()
    await page
      .getByRole('option', { name: new RegExp(`^${options.currencyCode}`) })
      .click()
  }

  if (options.openingBalance !== undefined) {
    const opening = dialog.getByRole('textbox', { name: labels.openingBalance })
    await opening.fill(options.openingBalance)
    await opening.blur()
  }

  await dialog.getByRole('button', { name: labels.create, exact: true }).click()
  await expect(dialog).toBeHidden()

  await accountLink(page, options.name).click()
  await expect(page).toHaveURL(/\/accounts\/[^/?]+/)
  const accountId = new URL(page.url()).pathname.split('/').pop()
  if (accountId === undefined || accountId === '') {
    throw new Error(`could not read an account id out of ${page.url()}`)
  }
  return accountId
}

export interface NewTransaction {
  /** Typed exactly as a reader would type it, in the locale the page is in. */
  readonly amount: string
  readonly accountName: string
  readonly note: string
  readonly labels?: UiLabels
}

/**
 * Records one transaction through `/transactions/new` and answers its id.
 *
 * The amount is *typed*, not set: `AmountField` parses what a person types in their own locale, so
 * a fixture that assigned a number would skip the parse the money specs are about.
 *
 * The id is read off the ledger row's own `href`, which is the link a reader would copy — the same
 * reason `createAccountThroughUi` reads the URL rather than the database.
 */
export async function createTransactionThroughUi(
  page: Page,
  options: NewTransaction,
): Promise<string> {
  const labels = options.labels ?? LABELS.en

  await gotoApp(page, '/transactions/new')

  const amount = page.getByRole('textbox', { name: labels.amount })
  await expect(amount).toBeVisible()

  await page
    .getByRole('button', {
      name: new RegExp(`\\b${escapeRegExp(labels.account)}$`),
    })
    .click()
  await page
    .getByRole('option', {
      name: new RegExp(`^${escapeRegExp(options.accountName)}`),
    })
    .click()

  await amount.click()
  await page.keyboard.type(options.amount)
  await amount.blur()

  await page.getByRole('textbox', { name: labels.note }).fill(options.note)
  await page.getByRole('button', { name: labels.save, exact: true }).click()

  await expect(page).toHaveURL(/\/transactions(\?|$)/)

  const row = page.getByRole('link', { name: options.note, exact: true })
  await expect(row).toBeVisible()
  const href = await row.getAttribute('href')
  const transactionId = href?.split('/').pop()
  if (transactionId === undefined || transactionId === '') {
    throw new Error(`could not read a transaction id out of ${String(href)}`)
  }
  return transactionId
}

/* -------------------------------------------------------------------------- */
/* Getting to a panel on the transaction detail screen                         */
/* -------------------------------------------------------------------------- */

/**
 * How long a screen is given to fetch what it will draw, once it is hydrated.
 *
 * A *budget*, in the same sense as {@link waitForHydration}'s, and for the same reason: nothing
 * that fails to arrive is accepted, it is only given longer to say so. It applies to the two waits
 * for data in {@link openTransactionDetailPanel} and to nothing else — the suite-wide
 * `expect.timeout` of five seconds in `playwright.config.ts` is untouched, so every assertion
 * about what the product *drew* still fails as fast as it ever did.
 *
 * The number is measured rather than picked. Run the way CI runs these — `mobile-safari`,
 * `workers: 1`, against `pnpm dev` — the whole of the slowest refund test takes 10.7 s, navigation,
 * hydration, the panel, a dialog and two axe scans included; the wait below is a small part of
 * that. Ten seconds is an order of magnitude more than it needs and still leaves two thirds of the
 * 30 s `timeout` for the test's own work, so a screen that genuinely never loads fails here, on
 * this sentence, rather than on a test timeout that has none.
 */
const DATA_TIMEOUT = 10_000

/**
 * Opens the first transaction in the ledger and returns one of its panels, by accessible name.
 *
 * The row is reached by following the list's own link rather than by a seeded id: the demo
 * workspace's contents are the seed's business, and a spec that hard-codes an id fails for a reason
 * that has nothing to do with the panel it is about. Which link that is, and why it has to be said
 * so precisely, is `support/transactions.ts` — it is #82.
 *
 * One helper rather than one per spec because the refund, split and receipts specs each wrote the
 * same navigate-click-assert themselves, which meant the bug in it was present three times, had to
 * be found three times, and could rot back into two of them unnoticed.
 *
 * Both waits for data carry {@link DATA_TIMEOUT} rather than the default five seconds, and neither
 * is a tolerance: the ledger and the detail screen are both fetched after hydration, on a runner
 * `playwright.config.ts` already records as slow enough to starve hydration itself. What they buy
 * is that the failure, when there is one, is the right one — a row that never arrives and a panel
 * that is not there fail on their own sentence rather than on whichever assertion the clock reached
 * first.
 *
 * @param panelName The panel's accessible name in the locale the page is in. It is a message value
 *   from `src/lib/i18n/messages/*.ts`, so callers pass it per locale rather than hard-coding one.
 */
export async function openTransactionDetailPanel(
  page: Page,
  panelName: string,
): Promise<Locator> {
  await gotoApp(page, '/transactions')

  const firstRow = page.locator(TRANSACTION_ROW_SELECTOR).first()
  await expect(
    firstRow,
    'The ledger listed no transaction to open. The demo workspace should always have one.',
  ).toBeVisible({ timeout: DATA_TIMEOUT })
  await firstRow.click()
  await expect(
    page,
    'Following the ledger\'s first row did not open one transaction. Landing on "/transactions/new" here means the create stamp in the bottom bar was clicked instead - see `support/transactions.ts`.',
  ).toHaveURL(TRANSACTION_DETAIL_URL)

  const panel = page.getByRole('region', { name: panelName })
  await expect(
    panel,
    // Not a diagnosis of *why*, and it cannot be: the accessible name is locale-dependent, so a
    // missing region and a renamed one look the same from here. What it can now say is that this
    // is the transaction's own screen, which is the part that used to be untrue.
    `No region named "${panelName}" on the transaction detail screen (the name is locale-dependent).`,
  ).toBeVisible({ timeout: DATA_TIMEOUT })
  return panel
}

/**
 * Every space a formatter may have used, flattened to one.
 *
 * `Intl` writes Polish groups with U+00A0 and, in newer CLDR, U+202F. Asserting on the codepoint a
 * particular runtime happened to choose is asserting about ICU rather than about the product;
 * asserting on the digits and the separator is the money question.
 */
export function normaliseSpaces(value: string): string {
  // The two spaces are written as escapes: a literal U+00A0 or U+202F in a source file is
  // invisible to a reviewer, and `no-irregular-whitespace` refuses it for that reason.
  return value
    .replace(/\s|\u00a0|\u202f/g, ' ')
    .replace(/ +/g, ' ')
    .trim()
}
