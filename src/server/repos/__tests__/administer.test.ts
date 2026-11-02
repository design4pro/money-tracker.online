/**
 * The shared-workspace administer gate, at the function itself.
 *
 * Feature repositories keep their own "this write is gated" Forbidden cases. This file is the
 * one direct test of the rule: owner and admin pass even in a shared workspace, a member of a
 * solo workspace passes, and a member of a shared workspace is refused with the same
 * `ForbiddenError` the copies used to throw.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { assertMayAdminister } from '../administer'
import { ForbiddenError } from '../errors'
import { createScope } from '../scope'
import { addSecondMember, createBudgetWorld } from './budget-harness'

import type { BudgetWorld } from './budget-harness'
import type { OrganizationRole } from '../scope'

let world: BudgetWorld

beforeEach(async () => {
  world = await createBudgetWorld()
})

function asRole(role: OrganizationRole) {
  return createScope(world.db, {
    userId: 'user-a',
    organizationId: 'org-a',
    role,
  })
}

describe('assertMayAdminister', () => {
  it('lets an owner through a shared workspace', async () => {
    await addSecondMember(world.db)
    await expect(
      assertMayAdminister(asRole('owner'), 'edit an account'),
    ).resolves.toBeUndefined()
  })

  it('lets an admin through a shared workspace', async () => {
    await addSecondMember(world.db)
    await expect(
      assertMayAdminister(asRole('admin'), 'edit an account'),
    ).resolves.toBeUndefined()
  })

  it('lets a member through a solo workspace', async () => {
    await expect(
      assertMayAdminister(asRole('member'), 'edit an account'),
    ).resolves.toBeUndefined()
  })

  it('refuses a member of a shared workspace with owner|admin', async () => {
    await addSecondMember(world.db)
    await expect(
      assertMayAdminister(asRole('member'), 'edit an account'),
    ).rejects.toMatchObject({
      name: 'ForbiddenError',
      code: 'FORBIDDEN',
      action: 'edit an account',
      message:
        'Role not permitted to edit an account; requires one of: owner, admin.',
    })
    await expect(
      assertMayAdminister(asRole('member'), 'edit an account'),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
