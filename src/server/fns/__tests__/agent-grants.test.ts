/**
 * Mint and revoke handlers: paid-plan gate, secret once, no hash on the wire.
 *
 * `createServerFn` is replaced so the handlers run in Node the way
 * `attachments.test.ts` does. `requireOrg` returns the fixture scope.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { subscriptions } from '#/server/db/schema'
import { createBudgetWorld, NOW } from '#/server/repos/__tests__/budget-harness'
import { FeatureLockedError, NotFoundError } from '#/server/repos/errors'

import { createScope } from '#/server/repos/scope'

import {
  loadAgentGrants,
  loadAgentsPage,
  loadConsentPage,
  mintAgentPat,
  recordOauthGrant,
  revokeAgentGrant,
  updateAgentGrant,
} from '../agent-grants'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

const current = vi.hoisted(() => ({
  scope: undefined as unknown,
  appUrl: 'https://staging.example.test',
}))

vi.mock('@tanstack/react-start', () => ({
  createIsomorphicFn: () => ({
    client: () => ({
      server: (serverImpl: () => unknown) => serverImpl,
    }),
  }),
  createServerFn: () => {
    let validate: (data: unknown) => unknown = (data) => data
    const builder = {
      validator(validator: unknown) {
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

describe('updateAgentGrant', () => {
  it('refuses a free workspace and leaves the grant', async () => {
    await seedPlus()
    const minted = (await mintAgentPat({
      data: { name: 'Inspector', scopes: ['accounts:read'] },
    } as never)) as { grant: { id: string; name: string } }
    await world.db.delete(subscriptions)

    await expect(
      updateAgentGrant({
        data: {
          grantId: minted.grant.id,
          name: 'Wider',
          scopes: ['transactions:write'],
        },
      } as never),
    ).rejects.toBeInstanceOf(FeatureLockedError)

    current.scope = world.scope
    await seedPlus()
    const listed = (await loadAgentGrants()) as ReadonlyArray<{
      name: string
      scopes: ReadonlyArray<string>
    }>
    expect(listed.map((grant) => grant.name)).toEqual(['Inspector'])
    expect(listed[0]?.scopes).toEqual(['accounts:read'])
  })

  it('saves the new name and scopes and keeps the prefix', async () => {
    await seedPlus()
    const minted = (await mintAgentPat({
      data: { name: 'Inspector', scopes: ['accounts:read'] },
    } as never)) as { grant: { id: string; tokenPrefix: string } }

    const updated = (await updateAgentGrant({
      data: {
        grantId: minted.grant.id,
        name: 'Renamed',
        scopes: ['accounts:read', 'transactions:delete'],
      },
    } as never)) as {
      name: string
      scopes: ReadonlyArray<string>
      tokenPrefix: string
      lastUsedAt: Date | null
      clientId: string | null
    }
    expect(updated.name).toBe('Renamed')
    expect(updated.scopes).toEqual(['accounts:read', 'transactions:delete'])
    expect(updated.tokenPrefix).toBe(minted.grant.tokenPrefix)
    expect(updated.lastUsedAt).toBeNull()
    expect(updated.clientId).toBeNull()
    expect(JSON.stringify(updated)).not.toMatch(/tokenHash/)
  })

  it('does not update a revoked grant', async () => {
    await seedPlus()
    const minted = (await mintAgentPat({
      data: { name: 'Inspector', scopes: ['accounts:read'] },
    } as never)) as { grant: { id: string } }
    await revokeAgentGrant({ data: { grantId: minted.grant.id } } as never)

    await expect(
      updateAgentGrant({
        data: {
          grantId: minted.grant.id,
          name: 'Back',
          scopes: ['accounts:read'],
        },
      } as never),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('loadAgentsPage', () => {
  it('does not list grants for a member', async () => {
    await seedPlus()
    await mintAgentPat({
      data: { name: 'Inspector', scopes: ['accounts:read'] },
    } as never)
    current.scope = createScope(world.db, {
      userId: 'user-b',
      organizationId: 'org-a',
      role: 'member',
    })

    await expect(loadAgentsPage()).resolves.toMatchObject({
      kind: 'member',
    })
  })

  it('returns locked with remaining grants on the free plan', async () => {
    await seedPlus()
    await mintAgentPat({
      data: { name: 'Inspector', scopes: ['accounts:read'] },
    } as never)
    await world.db.delete(subscriptions)

    const page = (await loadAgentsPage()) as {
      kind: string
      grants: ReadonlyArray<{ name: string }>
    }
    expect(page.kind).toBe('locked')
    expect(page.grants.map((grant) => grant.name)).toEqual(['Inspector'])
  })
})

describe('loadConsentPage and recordOauthGrant', () => {
  it('lets an admin on Plus record an OAuth grant', async () => {
    await seedPlus()
    const consent = (await loadConsentPage()) as {
      canManage: boolean
      mcpEnabled: boolean
    }
    expect(consent).toMatchObject({ canManage: true, mcpEnabled: true })

    const grant = (await recordOauthGrant({
      data: {
        name: 'Inspector',
        clientId: 'client-1',
        scopes: ['accounts:read'],
      },
    } as never)) as { kind: string; clientId: string }
    expect(grant).toMatchObject({ kind: 'oauth', clientId: 'client-1' })
  })

  it('refuses minting an OAuth grant on the free plan', async () => {
    await expect(
      recordOauthGrant({
        data: {
          name: 'Inspector',
          clientId: 'client-1',
          scopes: ['accounts:read'],
        },
      } as never),
    ).rejects.toBeInstanceOf(FeatureLockedError)
  })
})
