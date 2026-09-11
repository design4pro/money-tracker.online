import { expect, test as setup } from '@playwright/test'

import { organizationIdFor } from './support/d1'
import { installYenFixture } from './support/fixtures'
import {
  DEMO,
  EMPTY,
  RATE_LIMIT_BUDGET_MS,
  TENANT_A,
  TENANT_B,
  cacheSession,
} from './support/session'

/**
 * The `setup` project: every session the suite runs as, minted once.
 *
 * `playwright.config.ts` makes all three browser projects depend on this file, and its docblock
 * states why: `/sign-in/email` allows ten attempts a minute, so a suite that signs in per test
 * spends its budget on fixtures and then reports the `429` as a product failure.
 *
 * ## Why both steps set their own timeout
 *
 * `ensureSignedIn` waits a `429` out rather than reporting it, for up to `RATE_LIMIT_BUDGET_MS` per
 * sign-in. The file-level default is the 30s `playwright.config.ts` puts on every test, which is
 * less than one such wait — so a limiter that fires would end the step as a timeout, and the wait
 * would never once run to completion. Each step therefore states the ceiling its own sign-ins can
 * reach. It is a budget, not an expectation: a run where nothing is limited is unaffected.
 */

/** The ordinary 30s of `playwright.config.ts`, on top of whatever waiting a limiter forces. */
const SETUP_WORK_MS = 30_000

setup('demo session', async ({ playwright, baseURL }) => {
  setup.setTimeout(SETUP_WORK_MS + RATE_LIMIT_BUDGET_MS)
  setup.skip(baseURL === undefined, 'no baseURL configured')
  await cacheSession(playwright, baseURL as string, DEMO, 'demo')
})

/**
 * The two workspaces the tenant boundary is attacked across, the empty one, and the zero-decimal
 * fixture.
 *
 * They are provisioned in one serial step rather than as parallel ones because a first run has to
 * sign all three of them up, and `/sign-up/email` allows five attempts every five minutes — a
 * budget shared with the sign-up `core-flow.spec.ts` performs for real. Three plus one is four,
 * which is why the empty workspace joins this step instead of becoming a fourth one.
 *
 * `support/fixtures.ts` explains why the yen rows are written to D1 rather than clicked into
 * existence.
 */
setup('fixture workspaces', async ({ playwright, baseURL }) => {
  // Three sign-ins, so three times the budget.
  setup.setTimeout(SETUP_WORK_MS + 3 * RATE_LIMIT_BUDGET_MS)
  setup.skip(baseURL === undefined, 'no baseURL configured')
  const origin = baseURL as string

  await cacheSession(playwright, origin, TENANT_A, 'tenant-a')
  await cacheSession(playwright, origin, TENANT_B, 'tenant-b')
  // Nothing is written through this one, ever: `EMPTY`'s docblock says why.
  await cacheSession(playwright, origin, EMPTY, 'empty')

  const organizationId = await organizationIdFor(TENANT_A.email)
  expect(
    organizationId,
    'signing up must provision a workspace for the fixture tenant',
  ).not.toBeNull()

  await installYenFixture(organizationId as string)
})
