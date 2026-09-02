import { expect, test as setup } from '@playwright/test'

import { organizationIdFor } from './support/d1'
import { installYenFixture } from './support/fixtures'
import { DEMO, TENANT_A, TENANT_B, cacheSession } from './support/session'

/**
 * The `setup` project: every session the suite runs as, minted once.
 *
 * `playwright.config.ts` makes all three browser projects depend on this file, and its docblock
 * states why: `/sign-in/email` allows ten attempts a minute, so a suite that signs in per test
 * spends its budget on fixtures and then reports the `429` as a product failure.
 */

setup('demo session', async ({ playwright, baseURL }) => {
  setup.skip(baseURL === undefined, 'no baseURL configured')
  await cacheSession(playwright, baseURL as string, DEMO, 'demo')
})

/**
 * The two workspaces the tenant boundary is attacked across, and the zero-decimal fixture.
 *
 * They are provisioned in one serial step rather than as two parallel ones because a first run has
 * to sign both of them up, and `/sign-up/email` allows five attempts every five minutes — a
 * budget shared with the sign-up `core-flow.spec.ts` performs for real.
 *
 * `support/fixtures.ts` explains why the yen rows are written to D1 rather than clicked into
 * existence.
 */
setup('fixture workspaces', async ({ playwright, baseURL }) => {
  setup.skip(baseURL === undefined, 'no baseURL configured')
  const origin = baseURL as string

  await cacheSession(playwright, origin, TENANT_A, 'tenant-a')
  await cacheSession(playwright, origin, TENANT_B, 'tenant-b')

  const organizationId = await organizationIdFor(TENANT_A.email)
  expect(
    organizationId,
    'signing up must provision a workspace for the fixture tenant',
  ).not.toBeNull()

  await installYenFixture(organizationId as string)
})
