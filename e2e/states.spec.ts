import { DELIBERATE_SERVER_FAILURE, expect, test } from './support/console'

import { gotoApp, waitForHydration } from './support/app'
import { storageStateFor } from './support/session'
import { failServerFns, holdServerFns } from './support/states'

import en from '#/lib/i18n/messages/en'

import type { MessageKey } from '#/lib/i18n'

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
 * and never asks the browser for anything a test could hold. The shell's own rail is not one — its
 * links go through the design-system `Link`, which does a full document load — so the case below
 * uses a card link, which is a TanStack `Link` and genuinely client-side.
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
 * The nine screens a brand-new workspace lands on with nothing to show.
 *
 * `/import` is here for its **history** rather than for the page: the two upload cards are always
 * present, and the empty half of that screen is the table under them.
 */
const EMPTY_SURFACES: readonly EmptySurface[] = [
  { path: '/accounts', title: 'accounts.empty.title' },
  { path: '/transactions', title: 'transactions.empty.title' },
  { path: '/categories', title: 'categories.empty.title' },
  { path: '/payees', title: 'payees.empty.title' },
  { path: '/budgets', title: 'budgets.empty.title' },
  { path: '/goals', title: 'goals.empty.title' },
  { path: '/recurring', title: 'recurring.empty.title' },
  { path: '/transactions/rules', title: 'rules.empty.title' },
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
    })
  }
})

test.describe('a read that has not come back yet', () => {
  test.use({ storageState: storageStateFor('demo') })

  test('an account detail draws its skeleton instead of leaving the list on screen', async ({
    page,
  }) => {
    await gotoApp(page, '/accounts')
    await expect(
      page.getByRole('heading', { name: en['accounts.title'] }),
    ).toBeVisible()

    const held = await holdServerFns(page)
    try {
      // A card link, not the rail: `account-card.tsx` uses TanStack's `Link`, so this is a
      // client-side navigation and its loader asks the browser for the data.
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

    await gotoApp(page, '/transactions')

    // The id never has to name a real row: `failServerFns` answers before the repository is asked.
    const failing = await failServerFns(page)
    try {
      await page.goto('/transactions/does-not-matter')
      await waitForHydration(page)

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
