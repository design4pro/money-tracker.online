import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { organization } from '../../db/auth-schema'
import { dbFromEnv } from '../../db/from-env'
import { payees } from '../../db/schema'
import { createScope, createTenantRepository, runTenantBatch } from '../base'

/**
 * `runTenantBatch` on the real D1 binding.
 *
 * The Node tests wrap the batch in `BEGIN`/`COMMIT` themselves, so they prove the seam's contract
 * and not that D1's own `batch` rolls back. This is that evidence: the second statement fails on a
 * primary-key conflict, and the first, which succeeded, must be gone with it.
 */
describe('a tenant batch in workerd', () => {
  const now = new Date('2026-03-15T10:00:00.000Z')
  const repo = createTenantRepository(payees, 'payee')

  async function setup() {
    const db = dbFromEnv(env)
    await db.insert(organization).values({
      id: 'org-batch',
      name: 'Batch',
      slug: 'batch',
      createdAt: now,
    })
    const scope = createScope(db, {
      userId: 'user-batch',
      organizationId: 'org-batch',
      role: 'owner',
    })
    await repo.insert(scope, {
      id: 'payee-1',
      name: 'One',
      createdAt: now,
      updatedAt: now,
    })
    return scope
  }

  it('applies every statement, and none when one of them fails', async () => {
    const scope = await setup()

    await expect(
      runTenantBatch(scope, [
        repo.removeWhereStatement(scope, eq(payees.id, 'payee-1')),
        repo.insertManyStatement(scope, [
          { id: 'payee-2', name: 'Two', createdAt: now, updatedAt: now },
        ]),
        // Same primary key as the row inserted just above: the batch has to fail here.
        repo.insertManyStatement(scope, [
          { id: 'payee-2', name: 'Again', createdAt: now, updatedAt: now },
        ]),
      ]),
    ).rejects.toThrow()

    const afterFailure = await repo.findMany(scope)
    expect(afterFailure.map((row) => row.id)).toEqual(['payee-1'])

    const [removed, inserted] = await runTenantBatch(scope, [
      repo.removeWhereStatement(scope, eq(payees.id, 'payee-1')),
      repo.insertManyStatement(scope, [
        { id: 'payee-2', name: 'Two', createdAt: now, updatedAt: now },
      ]),
    ])
    expect(removed).toHaveLength(1)
    expect(inserted).toHaveLength(1)
    const afterSuccess = await repo.findMany(scope)
    expect(afterSuccess.map((row) => row.id)).toEqual(['payee-2'])
  })
})
