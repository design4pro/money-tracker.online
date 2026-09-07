import { expect, test } from './support/console'

import {
  createAccountThroughUi,
  createTransactionThroughUi,
  gotoApp,
  uniqueToken,
  waitForHydration,
} from './support/app'
import { storageStateFor } from './support/session'

/**
 * The tenant boundary, attacked in the running application.
 *
 * ## Why this exists even though the repositories are unit-tested
 *
 * `src/server/repos/__tests__` proves that a tenant-scoped query composes its predicate. It cannot
 * prove that the *application* only reaches data through those queries. Between a proven
 * repository and a leak there are a router that runs in the attacker's own browser, a `beforeLoad`
 * guard whose own docblock says it "is UX, never a data boundary", a React Query cache keyed by an
 * id rather than by a workspace, and an SSR pass that renders the document before any of it. None
 * of those is exercised by a unit test, and the one that leaks is the one nobody wrote a unit test
 * for. So this spec drives two real sessions in one real server and asks for the other one's rows
 * by URL — the attack an ordinary reader can perform with nothing but the address bar.
 *
 * ## What counts as passing
 *
 * A refusal, not an absence of a crash. Three separate claims, and all three are needed:
 *
 * 1. The screen says the row is not there.
 * 2. **Nothing about the row appears anywhere in the document** — not its name, not its note, not
 *    its amount. A refusal that leaks the account name in an error message has still answered the
 *    question the probe was asking.
 * 3. The refusal is a *not found*, never a *forbidden*. `-server/detail.ts` says so in both files:
 *    the two answers are distinguishable, and one of them confirms the row exists somewhere.
 *
 * ## Why the ids come from the product
 *
 * Tenant A's account and transaction are created through the same screens a reader uses, and their
 * ids are read out of the URL and the ledger's own `href`. An id fabricated by the test would
 * prove that an unknown id is refused, which is not the same claim: a leak is a *real* id reaching
 * the wrong reader.
 */

const TENANT_A_STATE = storageStateFor('tenant-a')
const TENANT_B_STATE = storageStateFor('tenant-b')

test.describe('tenant isolation', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'The boundary is server-side. Three engines would assert the same server three times and ' +
      'spend the sign-in budget doing it.',
  )

  test('workspace B is refused workspace A’s account and transaction by URL', async ({
    browser,
  }) => {
    const token = uniqueToken('iso')
    const accountName = `Tenant A account ${token}`
    const note = `Tenant A note ${token}`

    /* ---- Tenant A writes two rows a reader could link to -------------------- */

    const asTenantA = await browser.newContext({ storageState: TENANT_A_STATE })
    const a = await asTenantA.newPage()

    const accountId = await createAccountThroughUi(a, {
      name: accountName,
      openingBalance: '250',
    })
    const transactionId = await createTransactionThroughUi(a, {
      amount: '99.99',
      accountName,
      note,
    })

    // A's own session sees them, so a refusal on B's side cannot be explained by the rows not
    // existing. This is the control the whole spec rests on.
    await gotoApp(a, `/accounts/${accountId}`)
    await expect(
      a.getByRole('heading', { name: accountName, level: 1 }),
    ).toBeVisible()
    await gotoApp(a, `/transactions/${transactionId}`)
    await expect(a.getByText(note, { exact: true }).first()).toBeVisible()

    await asTenantA.close()

    /* ---- Tenant B asks for them --------------------------------------------- */

    const asTenantB = await browser.newContext({ storageState: TENANT_B_STATE })
    const b = await asTenantB.newPage()

    // B is a signed-in reader of its own workspace: the refusals below are the tenant boundary
    // answering, not the authentication guard.
    await gotoApp(b, '/accounts')
    await expect(
      b.getByRole('heading', { name: 'Accounts', level: 1 }),
    ).toBeVisible()

    // Issue #16 moved this refusal from the generic error panel to the router's not-found
    // surface, so the two answers below have to be compared rather than asserted one at a time:
    // A's real account id and an id that exists in no workspace at all must be the same response.
    const foreign = await b.goto(`/accounts/${accountId}`, {
      waitUntil: 'commit',
    })
    await waitForHydration(b)
    const foreignBody = await b.locator('body').innerText()

    await expect(b.getByRole('heading', { name: 'Not here' })).toBeVisible()
    await expect(b.locator('body')).not.toContainText(accountName)
    // A `403` would confirm the row exists in *some* workspace. The product answers `NotFoundError`
    // and nothing that reaches the reader may name a permission.
    await expect(b.locator('body')).not.toContainText(
      /forbidden|not allowed|permission/i,
    )

    const missing = await b.goto('/accounts/does-not-exist', {
      waitUntil: 'commit',
    })
    await waitForHydration(b)

    // The oracle this whole spec exists to close: same status, same body. A difference of any
    // kind — a status, a heading, an id echoed back — answers "does workspace X have this row?"
    expect(foreign?.status()).toBe(404)
    expect(missing?.status()).toBe(foreign?.status())
    expect(await b.locator('body').innerText()).toBe(foreignBody)

    await gotoApp(b, `/transactions/${transactionId}`)
    await expect(
      b.getByRole('heading', { name: 'That entry is not here' }),
    ).toBeVisible()
    await expect(b.locator('body')).not.toContainText(note)
    await expect(b.locator('body')).not.toContainText('99.99')

    // And neither row shows up in B's own lists, which is where a cache keyed by id rather than by
    // workspace would surface them.
    await gotoApp(b, '/accounts')
    await expect(b.locator('body')).not.toContainText(accountName)
    await gotoApp(b, '/transactions')
    await expect(b.locator('body')).not.toContainText(note)

    await asTenantB.close()

    /* ---- And an anonymous visitor never reaches the screens at all ---------- */

    const anonymous = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    })
    const nobody = await anonymous.newPage()

    await nobody.goto(`/accounts/${accountId}`)
    await expect(nobody).toHaveURL(/\/login/)
    await expect(nobody.locator('body')).not.toContainText(accountName)

    await nobody.goto(`/transactions/${transactionId}`)
    await expect(nobody).toHaveURL(/\/login/)
    await expect(nobody.locator('body')).not.toContainText(note)

    await anonymous.close()
  })
})
