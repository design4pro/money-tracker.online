import { DELIBERATE_SERVER_FAILURE, expect, test } from './support/console'

import { gotoApp } from './support/app'
import { expectNoWcagViolations } from './support/axe-scan'
import { expectOutlineWithoutSkips } from './support/headings'
import { storageStateFor } from './support/session'
import { failServerFns, holdEveryServerFn } from './support/states'
import { openSurface } from './support/surfaces'

import en from '#/lib/i18n/messages/en'

import type { AppLocale, AppTheme } from './support/app'
import type { Surface } from './support/surfaces'
import type { MessageKey } from '#/lib/i18n'
import type { Browser } from '@playwright/test'

/**
 * Issue #21's actual complaint, answered where the answer can be checked.
 *
 * The issue is not "these states look wrong" — it is that there is **no evidence** any of them
 * exists. A state nothing can reach on purpose is a state nobody can review, photograph or
 * regress-test, and `docs/STATE-INVENTORY.md` §6 records that this was true of every one of them.
 *
 * ## Why the sentences come from the catalogue rather than being retyped
 *
 * Every assertion below reads `en[key]`, so it is an assertion about the sentence that ships. A
 * retyped string turns a copy regression into a green test, which is the failure this file exists
 * to prevent — and it silently drifts from `pl.ts`, whose parity is the i18n suite's business.
 *
 * ## Which state is asserted where, and why they are not one loop
 *
 * **Empty** is reachable by simply signing in as a workspace with nothing in it, and the loader
 * runs during SSR, so a `page.goto` is enough. That is the whole of the empty half.
 *
 * **Error** is reachable only where the read happens on the client. `failServerFns` intercepts
 * `/_serverFn/*`, and a `page.goto` produces none of those — the loader ran on the server before
 * the browser had a page to intercept on. `/transactions/$transactionId` fetches with `useQuery`
 * after hydration, which is why it is the surface asserted here: the interception reaches it, and
 * it is also the screen issue #21's sibling fix changed, so the case is doing double duty.
 *
 * **Loading** needs a client-side navigation, because a `page.goto` resolves its loader during SSR
 * and never asks the browser for anything a test could hold. The case below uses a card link, which
 * has always been one. It used to be the *only* kind: the shell's rail went through the
 * design-system `Link`, which did a full document load, and could not be used for a loading case at
 * all. #245 mounted React Aria's `RouterProvider`, so the rail is client-side too and
 * `e2e/navigation.spec.ts` asserts the same loading state through it — this file keeps the card
 * link because the surface it is about is the account detail, not the navigation that reaches it.
 */

/**
 * One catalogue entry, as the sentence it is.
 *
 * Most entries are strings; a plural one is an object of CLDR categories. None of the copy here is
 * plural, and this refuses rather than stringifying an object into an assertion that could never
 * match anything on screen.
 */
function sentence(key: MessageKey): string {
  const value = en[key]
  if (typeof value !== 'string') {
    throw new Error(`${key} is a plural entry, not a sentence`)
  }
  return value
}

/** A surface whose empty state a reader can arrive at without creating anything first. */
interface EmptySurface {
  readonly path: string
  /** The heading the screen shows when the workspace holds nothing. */
  readonly title: MessageKey
}

/**
 * The ten screens a brand-new workspace lands on with nothing to show.
 *
 * `/import` is here for its **history** rather than for the page: the two upload cards are always
 * present, and the empty half of that screen is the table under them.
 */
/** Named because the axe matrix below scans this one in the cells it does not scan the rest in. */
const EMPTY_RECURRING: EmptySurface = {
  path: '/recurring',
  title: 'recurring.empty.title',
}

const EMPTY_SURFACES: readonly EmptySurface[] = [
  { path: '/accounts', title: 'accounts.empty.title' },
  { path: '/transactions', title: 'transactions.empty.title' },
  { path: '/categories', title: 'categories.empty.title' },
  { path: '/payees', title: 'payees.empty.title' },
  { path: '/budgets', title: 'budgets.empty.title' },
  { path: '/goals', title: 'goals.empty.title' },
  EMPTY_RECURRING,
  { path: '/transactions/rules', title: 'rules.empty.title' },
  { path: '/transactions/groups', title: 'groups.empty.title' },
  { path: '/import', title: 'import.history.empty.title' },
]

test.describe('a workspace with nothing in it', () => {
  test.use({ storageState: storageStateFor('empty') })

  for (const surface of EMPTY_SURFACES) {
    test(`${surface.path} says what is missing and how to fill it`, async ({
      page,
    }) => {
      await gotoApp(page, surface.path)

      // The heading, not merely the text: an empty state that renders its sentence as a paragraph
      // gives a screen-reader user nothing to navigate to, and `EmptyState` exists to prevent that.
      await expect(
        page.getByRole('heading', { name: sentence(surface.title) }),
      ).toBeVisible()

      // And the screen it belongs to is still around it. An empty state that replaced the page
      // would be an error boundary wearing an empty state's copy.
      await expect(page.locator('main')).toBeVisible()

      // At the level the page gives it, which is the half of an empty state the `demo` session
      // cannot be relied on to show. `EmptyState` defaults `headingLevel` to `3`, so a screen that
      // renders it straight under its `<h1>` and says nothing announces a subsection with no
      // section — issue #166. `/transactions` and `/import` reach their empty branch on this
      // session alone; the rest are here because this is where the branch is guaranteed rather
      // than incidental.
      await expectOutlineWithoutSkips(page, `empty ${surface.path}`)
    })
  }
})

/** The empty surface as `openSurface` wants it. The path is the name: it is what a failure reads. */
function surfaceOf(empty: EmptySurface): Surface {
  return { name: empty.path, path: empty.path, session: 'empty' }
}

/** One theme and one locale — the two axes that change the rendered document. */
interface Cell {
  readonly theme: AppTheme
  readonly locale: AppLocale
}

/** The cell every empty surface is scanned in. */
const BASE_CELL: Cell = { theme: 'light', locale: 'en' }

/** The other three cells of the same matrix, scanned on one surface. See below for why. */
const VARIANT_CELLS: readonly Cell[] = [
  { theme: 'dark', locale: 'en' },
  { theme: 'light', locale: 'pl' },
  { theme: 'dark', locale: 'pl' },
]

/**
 * The empty states, at the same WCAG A/AA bar `accessibility.spec.ts` holds the populated ones to.
 *
 * An empty state that fails a success criterion fails it for the reader who has the least context
 * to recover from it — someone who has just signed up and has nothing on screen to orient by. That
 * is the whole reason these are scanned rather than only asserted for their copy.
 *
 * ## Why the matrix is 10 + 3 rather than 10 × 4
 *
 * `accessibility.spec.ts` runs every surface in both themes and both locales because each of its
 * surfaces renders different markup — a grid, a set of cards, a meter. These ten do not: every one
 * of them is the same `EmptyState` component with different copy, and theme and locale are
 * properties of *that component*, not of the screen it sits on. Scanning `/goals` in dark Polish
 * after `/accounts` has been scanned in dark Polish re-checks one contrast pair four more times and
 * finds nothing new.
 *
 * So the axes are split by what each one can actually catch. Every surface is scanned once, because
 * what varies per surface is the *composition* — the heading level the page gives the empty state,
 * whether an action button is present, what sits around it. And one surface is scanned in the three
 * remaining cells, because what varies per cell belongs to the shared component: the dashed border
 * and muted description text in a second palette, and a translated heading and button label.
 *
 * `/recurring` carries the variants because it renders the most of the component in each cell: it
 * is the only empty state in the product that passes a `secondaryAction`, so its cell scans a
 * `primary` and a `secondary` button side by side — two different token pairs — as well as the
 * icon, the heading and the description every other one has.
 */
test.describe('an empty screen is still an accessible screen', () => {
  for (const surface of EMPTY_SURFACES) {
    test(`${surface.path} has no WCAG A or AA violations · ${BASE_CELL.theme} · ${BASE_CELL.locale}`, async ({
      browser,
    }) => {
      await scanEmpty(browser, surfaceOf(surface), BASE_CELL)
    })
  }

  for (const cell of VARIANT_CELLS) {
    test(`${EMPTY_RECURRING.path} has no WCAG A or AA violations · ${cell.theme} · ${cell.locale}`, async ({
      browser,
    }) => {
      await scanEmpty(browser, surfaceOf(EMPTY_RECURRING), cell)
    })
  }
})

async function scanEmpty(
  browser: Browser,
  surface: Surface,
  cell: Cell,
): Promise<void> {
  const { context, page } = await openSurface(
    browser,
    surface,
    cell.theme,
    cell.locale,
  )

  try {
    await expectNoWcagViolations(
      page,
      `empty ${surface.name} · ${cell.theme} · ${cell.locale}`,
    )
  } finally {
    await context.close()
  }
}

test.describe('a read that has not come back yet', () => {
  test.use({ storageState: storageStateFor('demo') })

  /**
   * Also issue #230's regression case: this is the **first** client-side navigation of the tab, and
   * the hold covers every server function, the shell's included.
   *
   * `_app.beforeLoad` awaits the shell, and a fresh document's cache used to be empty, so this
   * navigation made a real shell request before the router would render any pending component —
   * holding it froze the router with the list still on screen (`docs/STATE-INVENTORY.md` §3). The
   * shell the SSR pass resolved now reaches the browser's cache through `src/router.tsx`, so the
   * guard answers from cache and the skeleton appears. Measured red before that channel existed:
   * zero `role="status"` regions for the whole five-second wait.
   */
  test('an account detail draws its skeleton instead of leaving the list on screen', async ({
    page,
  }) => {
    await gotoApp(page, '/accounts')
    await expect(
      page.getByRole('heading', { name: en['accounts.title'] }),
    ).toBeVisible()

    const held = await holdEveryServerFn(page)
    try {
      // A card link, because the account detail is not a rail destination: `account-card.tsx` uses
      // TanStack's `Link`, so this is a client-side navigation and its loader asks the browser for
      // the data.
      await page.locator('main a[href^="/accounts/"]').first().click()

      // What issue #21 says nobody could show: a designed loading state, on purpose, on demand.
      const loading = page.locator('main [role="status"]')
      await expect(loading).toHaveCount(1)
      await expect(loading).toHaveText(en['accounts.list.loading'])

      // And the previous screen is gone rather than sitting there looking loaded — the failure
      // `docs/STATE-INVENTORY.md` §3 measured before `defaultPendingComponent` existed.
      await expect(
        page.getByRole('heading', { name: en['accounts.title'] }),
      ).toBeHidden()
    } finally {
      await held.release()
    }

    // And it does land. A skeleton that never resolves is a different bug wearing this one's face.
    // Only the loading sentence has to go: a loaded screen keeps live regions of its own.
    await expect(
      page
        .locator('main [role="status"]')
        .filter({ hasText: en['accounts.list.loading'] }),
    ).toHaveCount(0)
  })
})

/**
 * The error state, and the one ordering rule that keeps it from failing for a reason of its own.
 *
 * The interception is installed **before the first navigation of the test**, on a blank page.
 * Turning Playwright's request interception on while a WebKit page already has requests in flight
 * makes the engine refuse some of them — `Fetch API cannot load http://…/_serverFn/… due to access
 * control checks.` — and Playwright surfaces that as a `pageerror`, which `support/console.ts`
 * treats as fatal without consulting the per-test `expected` list. It is not a product failure and
 * no reader ever sees it, but it is indistinguishable from one in a report.
 *
 * Measured on this branch, `--repeat-each=10` across `webkit` and `mobile-safari`: with the
 * interception installed after an initial `gotoApp('/transactions')`, 19 of 22 runs failed that
 * way; installed first, 22 of 22 passed. The dev server's own console pipe was caught in it too, so
 * the symptom is the interception being switched on, not anything this suite asked to intercept.
 *
 * The separate `page.goto` that used to precede this is gone with it: the navigation under test is
 * a full document load either way, so the first one was only ever paying for a screen nothing
 * asserts on.
 */
test.describe('a read that fails', () => {
  // The seeded workspace, read and never written: what is under test is the *failure*, and an
  // empty workspace would leave the shell around it in its own empty state as well.
  test.use({ storageState: storageStateFor('demo') })

  test('a transaction detail offers a retry rather than saying the row is gone', async ({
    page,
    expectConsole,
  }) => {
    // The console net treats a 500 as fatal by construction. This is the narrow, per-test opt-out
    // step 3.1 built: the three messages a deliberate failure writes, measured and declared here
    // beside the interception that causes them.
    expectConsole(DELIBERATE_SERVER_FAILURE)

    // Installed before the first navigation, and that ordering is measured rather than tidy: see
    // the note above this test. The id never has to name a real row — `failServerFns` answers
    // before the repository is asked.
    const failing = await failServerFns(page)
    try {
      await gotoApp(page, '/transactions/does-not-matter')

      await expect(
        page.getByRole('heading', {
          name: en['transactions.detail.error.title'],
        }),
      ).toBeVisible()

      // The retry is the whole point of separating this from not-found: a failed read is worth
      // trying again, and a missing row never is.
      await expect(
        page.getByRole('button', { name: en['action.retry'] }),
      ).toBeVisible()

      // And the sentence that was wrong before #21 is gone: this screen used to tell a reader
      // their transaction was not here whenever anything at all went wrong.
      await expect(page.locator('body')).not.toContainText(
        en['transactions.detail.notFound.title'],
      )
    } finally {
      await failing.release()
    }
  })
})
