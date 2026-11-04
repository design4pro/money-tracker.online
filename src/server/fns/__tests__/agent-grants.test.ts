/**
 * Mint and revoke handlers: paid-plan gate, secret once, no hash on the wire.
 *
 * `createServerFn` is replaced so the handlers run in Node the way
 * `attachments.test.ts` does. `requireOrg` returns the fixture scope.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { subscriptions } from '#/server/db/schema'
import { createBudgetWorld, NOW } from '#/server/repos/__tests__/budget-harness'
import { FeatureLockedError } from '#/server/repos/errors'

import {
  loadAgentGrants,
  mintAgentPat,
  revokeAgentGrant,
} from '../agent-grants'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

const current = vi.hoisted(() => ({
  scope: undefined as unknown,
  appUrl: 'https://staging.example.test',
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (data: unknown) => unknown = (data) => data
    const builder = {
      inputValidator(validator: unknown) {
        validate =
          typeof validator === 'function'
            ? (validator as (data: unknown) => unknown)
            : (data) =>
                (validator as { parse: (data: unknown) => unknown }).parse(data)
        return builder
      },
      handler(
        run: (context: { data: unknown }) => Promise<unknown>,
      ): (call?: { data: unknown }) => Promise<unknown> {
        return (call) => run({ data: validate(call?.data) })
      },
    }
    return builder
  },
}))

vi.mock('#/server/auth/guards', () => ({
  requireOrg: async () => current.scope,
}))

vi.mock('#/server/auth/env', () => ({
  appUrl: () => current.appUrl,
}))

let world: BudgetWorld

beforeEach(async () => {
  world = await createBudgetWorld()
  current.scope = world.scope
  current.appUrl = 'https://staging.example.test'
})

async function seedPlus(): Promise<void> {
  await world.db.insert(subscriptions).values({
    id: 'sub-a',
    organizationId: 'org-a',
    plan: 'plus',
    status: 'active',
    providerCustomerId: 'cus_1',
    providerSubscriptionId: 'sub_1',
    providerProductId: null,
    seats: 1,
    cancelAtPeriodEnd: false,
    createdAt: NOW,
    updatedAt: NOW,
  })
}

describe('mintAgentPat', () => {
  it('refuses a free workspace', async () => {
    await expect(
      mintAgentPat({
        data: { name: 'Inspector', scopes: ['accounts:read'] },
      } as never),
    ).rejects.toBeInstanceOf(FeatureLockedError)
  })

  it('returns the secret once and never the hash', async () => {
    await seedPlus()
    const minted = (await mintAgentPat({
      data: { name: 'Inspector', scopes: ['accounts:read'] },
    } as never)) as {
      grant: { tokenPrefix: string; name: string }
      secret: string
    }

    expect(minted.secret.startsWith(minted.grant.tokenPrefix)).toBe(true)
    expect(minted.secret).toMatch(/^mto_stg_/)
    expect(minted.grant.name).toBe('Inspector')
    expect(JSON.stringify(minted)).not.toMatch(/tokenHash/)
  })
})

describe('loadAgentGrants and revokeAgentGrant', () => {
  it('lists the minted grant without a hash, then revoke leaves it listed as revoked', async () => {
    await seedPlus()
    const minted = (await mintAgentPat({
      data: { name: 'Inspector', scopes: ['budgets:read'] },
    } as never)) as { grant: { id: string } }

    const listed = (await loadAgentGrants()) as ReadonlyArray<{
      id: string
      revokedAt: Date | null
    }>
    expect(listed.map((grant) => grant.id)).toEqual([minted.grant.id])
    expect(JSON.stringify(listed)).not.toMatch(/tokenHash/)

    const revoked = (await revokeAgentGrant({
      data: { grantId: minted.grant.id },
    } as never)) as { revokedAt: Date | null }
    expect(revoked.revokedAt).not.toBeNull()
  })
})
