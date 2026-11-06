/**
 * Grant resolution for the MCP door: PAT hash, OAuth client+user, membership, plan.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { subscriptions } from '#/server/db/schema'
import {
  createOauthGrant,
  createPatGrant,
  revokeGrant,
} from '#/server/repos/agent-grants'
import { createBudgetWorld, NOW } from '#/server/repos/__tests__/budget-harness'
import { FeatureLockedError } from '#/server/repos/errors'
import { createScope } from '#/server/repos/scope'
import { member } from '#/server/db/auth-schema'

import {
  bearerToken,
  isPatSecret,
  resolveOauthGrant,
  resolvePatGrant,
  scopeForGrant,
} from '../authenticate'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

const scopes = ['accounts:read'] as const

let world: BudgetWorld

beforeEach(async () => {
  world = await createBudgetWorld()
})

async function seedPlus(organizationId = 'org-a'): Promise<void> {
  await world.db.insert(subscriptions).values({
    id: `sub-${organizationId}`,
    organizationId,
    plan: 'plus',
    status: 'active',
    providerCustomerId: 'cus_1',
    providerSubscriptionId: `sub_${organizationId}`,
    providerProductId: null,
    seats: 1,
    cancelAtPeriodEnd: false,
    createdAt: NOW,
    updatedAt: NOW,
  })
}

describe('bearerToken', () => {
  it('reads a Bearer token and ignores anything else', () => {
    expect(
      bearerToken(
        new Request('https://app.example.test/api/mcp', {
          headers: { authorization: 'Bearer mto_stg_abc12345.secret' },
        }),
      ),
    ).toBe('mto_stg_abc12345.secret')
    expect(
      bearerToken(new Request('https://app.example.test/api/mcp')),
    ).toBeNull()
  })
})

describe('isPatSecret', () => {
  it('accepts the minted shape and rejects a JWT-looking value', () => {
    expect(
      isPatSecret('mto_stg_nwh4k2ab.abcdefghijklmnopqrstuvwxyz012345'),
    ).toBe(true)
    expect(isPatSecret('eyJhbGciOiJSUzI1NiJ9.e30.sig')).toBe(false)
  })
})

describe('resolvePatGrant', () => {
  it('resolves a live secret and treats a revoked one as unknown', async () => {
    const minted = await createPatGrant(
      world.scope,
      { name: 'Inspector', scopes: [...scopes], environment: 'stg' },
      NOW,
    )
    expect(await resolvePatGrant(world.db, minted.secret)).toMatchObject({
      id: minted.grant.id,
      organizationId: 'org-a',
    })
    await revokeGrant(world.scope, { grantId: minted.grant.id }, NOW)
    expect(await resolvePatGrant(world.db, minted.secret)).toBeNull()
  })

  it('does not resolve B’s secret as A’s grant', async () => {
    const mintedB = await createPatGrant(
      world.otherScope,
      { name: 'B inspector', scopes: [...scopes], environment: 'stg' },
      NOW,
    )
    const found = await resolvePatGrant(world.db, mintedB.secret)
    expect(found?.organizationId).toBe('org-b')
    expect(found?.organizationId).not.toBe('org-a')
  })
})

describe('resolveOauthGrant', () => {
  it('resolves by sub and azp, and treats a revoked row as unknown', async () => {
    const grant = await createOauthGrant(
      world.scope,
      {
        name: 'Claude',
        clientId: 'client-a',
        scopes: [...scopes],
      },
      NOW,
    )
    expect(
      await resolveOauthGrant(world.db, {
        sub: 'user-a',
        azp: 'client-a',
      }),
    ).toMatchObject({ id: grant.id, organizationId: 'org-a' })

    await revokeGrant(world.scope, { grantId: grant.id }, NOW)
    expect(
      await resolveOauthGrant(world.db, { sub: 'user-a', azp: 'client-a' }),
    ).toBeNull()
  })

  it('does not let A’s client id authenticate as B', async () => {
    await createOauthGrant(
      world.otherScope,
      { name: 'B client', clientId: 'client-b', scopes: [...scopes] },
      NOW,
    )
    expect(
      await resolveOauthGrant(world.db, { sub: 'user-a', azp: 'client-b' }),
    ).toBeNull()
    expect(
      await resolveOauthGrant(world.db, { sub: 'user-b', azp: 'client-b' }),
    ).toMatchObject({ organizationId: 'org-b' })
  })

  it('binds the organization claim and refuses a token that could see two workspaces', async () => {
    await createOauthGrant(
      world.scope,
      { name: 'Home', clientId: 'client-a', scopes: ['accounts:read'] },
      NOW,
    )
    await world.db.insert(member).values({
      id: 'mem-a-in-b',
      organizationId: 'org-b',
      userId: 'user-a',
      role: 'owner',
      createdAt: NOW,
    })
    await createOauthGrant(
      createScope(world.db, {
        userId: 'user-a',
        organizationId: 'org-b',
        role: 'owner',
      }),
      {
        name: 'Other house',
        clientId: 'client-a',
        scopes: ['transactions:write', 'transactions:delete'],
      },
      new Date(NOW.getTime() + 1_000),
    )

    expect(
      await resolveOauthGrant(world.db, { sub: 'user-a', azp: 'client-a' }),
    ).toBeNull()
    expect(
      await resolveOauthGrant(world.db, {
        sub: 'user-a',
        azp: 'client-a',
        org_id: 'org-a',
      }),
    ).toMatchObject({ organizationId: 'org-a' })
    expect(
      await resolveOauthGrant(world.db, {
        sub: 'user-a',
        azp: 'client-a',
        org_id: 'org-b',
      }),
    ).toMatchObject({ organizationId: 'org-b' })
    expect(
      await resolveOauthGrant(world.db, {
        sub: 'user-a',
        azp: 'client-a',
        org_id: 'org-missing',
      }),
    ).toBeNull()
  })
})

describe('scopeForGrant', () => {
  it('refuses a free workspace and accepts plus', async () => {
    const minted = await createPatGrant(
      world.scope,
      { name: 'Inspector', scopes: [...scopes], environment: 'stg' },
      NOW,
    )
    const grant = await resolvePatGrant(world.db, minted.secret)
    if (!grant) throw new Error('expected grant')
    await expect(scopeForGrant(world.db, grant)).rejects.toBeInstanceOf(
      FeatureLockedError,
    )
    await seedPlus()
    const scope = await scopeForGrant(world.db, grant)
    expect(scope.ctx.organizationId).toBe('org-a')
    expect(scope.ctx.userId).toBe('user-a')
  })
})
