import { expect, test } from './support/console'

import {
  createAccountThroughUi,
  createTransactionThroughUi,
  gotoApp,
  uniqueToken,
} from './support/app'
import {
  currencyCountsFor,
  organizationIdFor,
  storedTransaction,
} from './support/d1'

/**
 * The flow the whole slice exists to deliver, walked once, in one session.
 *
 * Sign up → the workspace provisions itself → an account → a transaction → the ledger → the
 * dashboard. It is deliberately one test rather than six: each step is only meaningful on the
 * state the previous one left, and six tests sharing a fixture would be one test with five
 * misleading names on it.
 *
 * ### It signs up for real, and that is the point
 *
 * Every other spec adopts a cached session, because `/sign-up/email` allows five attempts every
 * five minutes. This one spends one of them on purpose: *provisioning* is the behaviour under
 * test — the `user.create.after` hook in `src/server/auth/config.ts` creating an organization, an
 * owner membership and the four default currencies — and a cached session would assert it against
 * a workspace some earlier run provisioned.
 *
 * ### The provisioning assertion is made against rows, not against the header
 *
 * `src/routes/_app.tsx` falls back to the user's own name when the workspace listing lags, so a
 * plausible workspace name in the chrome is consistent with a workspace that was never written.
 * The membership and the currency rows are the claim; the screen is the evidence they reached it.
 */

// A fresh visitor: no cached session, whatever the project default is.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('the core flow', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'One sign-up per run. Repeating it in three browsers walks into the sign-up rate limit and ' +
      'reports it as a product failure; the flow is engine-independent and the axe and keyboard ' +
      'specs cover the other engines.',
  )

  test('sign up, provision, account, transaction, ledger, dashboard', async ({
    page,
  }) => {
    const token = uniqueToken('core')
    const email = `${token}@example.com`
    const password = 'core-flow-2026-pass'

    /* ---- Sign up ---------------------------------------------------------- */

    await gotoApp(page, '/register')
    await page.getByRole('textbox', { name: 'Your name' }).fill('Core Flow')
    await page.getByRole('textbox', { name: 'Email address' }).fill(email)
    // A masked input has no ARIA role, and the visible label carries a decorative asterisk, so
    // the field is addressed by the name it submits under.
    await page.locator('input[name="password"]').fill(password)
    await page.getByRole('button', { name: 'Create account' }).click()

    // Sign-up signs the reader in (`autoSignIn`) and the success path is a full document load, so
    // the guarded shell is built on the server from the cookie that call just set.
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(
      page.getByRole('heading', { name: 'Dashboard', level: 1 }),
    ).toBeVisible()

    /* ---- The workspace provisioned itself --------------------------------- */

    const organizationId = await organizationIdFor(email)
    expect(organizationId, 'sign-up must provision a workspace').not.toBeNull()

    const currencies = await currencyCountsFor(organizationId as string)
    expect(
      currencies.held,
      'a fresh workspace holds PLN, EUR, USD and GBP',
    ).toBe(4)
    expect(currencies.base, 'exactly one of them is the base currency').toBe(1)

    /* ---- An account ------------------------------------------------------- */

    const accountName = `Bank ${token}`
    await gotoApp(page, '/accounts')
    await expect(
      page.getByRole('heading', { name: 'No accounts yet' }),
    ).toBeVisible()

    const accountId = await createAccountThroughUi(page, {
      name: accountName,
      openingBalance: '1000',
    })
    expect(accountId).not.toBe('')

    await gotoApp(page, '/accounts')
    await expect(
      page.getByRole('link', { name: accountName, exact: true }),
    ).toBeVisible()

    /* ---- A transaction ---------------------------------------------------- */

    const note = `Coffee ${token}`
    const transactionId = await createTransactionThroughUi(page, {
      amount: '42.50',
      accountName,
      note,
    })

    /* ---- It is in the ledger ---------------------------------------------- */

    await gotoApp(page, '/transactions')
    const row = page.getByRole('row').filter({ hasText: note })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('42.50')

    // And it is stored as integer minor units, which is the only thing that distinguishes a
    // correct write from one the formatter would render identically until it was summed.
    const stored = await storedTransaction(transactionId)
    expect(
      stored,
      'the row must exist under the id the ledger links to',
    ).not.toBeNull()
    expect(stored?.amount_minor).toBe(4250)
    expect(stored?.currency_code).toBe('PLN')
    expect(stored?.direction).toBe('expense')

    /* ---- And it is on the dashboard --------------------------------------- */

    await gotoApp(page, '/dashboard')
    const recent = page.getByRole('region', { name: 'Latest entries' })
    await expect(recent).toBeVisible()
    await expect(recent).toContainText(note)
  })
})
