/**
 * The batching seam of the tenant base, proved against a real SQLite.
 *
 * A repository composes several tenant-scoped writes into one atomic unit through the statement
 * builders and `runTenantBatch` in `../base`, and never names `organization_id` itself (the fork
 * guard in `tenant-isolation.test.ts` enforces that on the source). What this file proves is the
 * other half: the builders stamp and scope exactly as the executing methods do, the runner refuses
 * a statement that is not the scope's own, and a failure rolls every statement back.
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { organization, user } from '#/server/db/auth-schema'
import { payees } from '#/server/db/schema'

import { createScope, createTenantRepository, runTenantBatch } from '../base'
import { ConflictError, TenantIsolationError } from '../errors'
import { fault, openTestDb } from './db-harness'

import type { Database, TenantScope } from '../base'

const NOW = new Date('2026-04-01T09:00:00.000Z')
const payeeRepo = createTenantRepository(payees, 'payee')

let db: Database
let a: TenantScope
let b: TenantScope

async function names(scope: TenantScope): Promise<Array<string>> {
  const rows = await payeeRepo.findMany(scope)
  return rows.map((row) => row.name).sort()
}

beforeEach(async () => {
  fault.when = null
  db = openTestDb()
  await db.insert(user).values(
    ['a', 'b'].map((id) => ({
      id: `user-${id}`,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: NOW,
      updatedAt: NOW,
    })),
  )
  await db.insert(organization).values(
    ['a', 'b'].map((id) => ({
      id: `org-${id}`,
      name: id,
      slug: id,
      createdAt: NOW,
      updatedAt: NOW,
    })),
  )
  a = createScope(db, {
    userId: 'user-a',
    organizationId: 'org-a',
    role: 'owner',
  })
  b = createScope(db, {
    userId: 'user-b',
    organizationId: 'org-b',
    role: 'owner',
  })
  for (const scope of [a, b]) {
    await payeeRepo.insertMany(scope, [
      {
        id: `${scope.ctx.organizationId}-p1`,
        name: 'One',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: `${scope.ctx.organizationId}-p2`,
        name: 'Two',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ])
  }
})

describe('runTenantBatch', () => {
  it('applies insert, update and remove statements together', async () => {
    const [inserted, updated, removed] = await runTenantBatch(a, [
      payeeRepo.insertManyStatement(a, [
        { id: 'org-a-p3', name: 'Three', createdAt: NOW, updatedAt: NOW },
      ]),
      payeeRepo.updateWhereStatement(a, eq(payees.id, 'org-a-p1'), {
        name: 'Renamed',
      }),
      payeeRepo.removeWhereStatement(a, eq(payees.id, 'org-a-p2')),
    ])

    expect(inserted).toHaveLength(1)
    expect(updated).toHaveLength(1)
    expect(removed).toHaveLength(1)
    expect(await names(a)).toEqual(['Renamed', 'Three'])
  })

  it('rolls every statement back when the last one fails', async () => {
    fault.when = (query) => /^update /i.test(query)

    await expect(
      runTenantBatch(a, [
        payeeRepo.insertManyStatement(a, [
          { id: 'org-a-p3', name: 'Three', createdAt: NOW, updatedAt: NOW },
        ]),
        payeeRepo.removeWhereStatement(a, eq(payees.id, 'org-a-p2')),
        payeeRepo.updateWhereStatement(a, eq(payees.id, 'org-a-p1'), {
          name: 'Renamed',
        }),
      ]),
    ).rejects.toThrow(/injected fault/)

    expect(await names(a)).toEqual(['One', 'Two'])
  })

  it('stamps the tenant column on an insert even when the payload casts around the type', async () => {
    const smuggled = {
      id: 'org-a-p3',
      name: 'Three',
      createdAt: NOW,
      updatedAt: NOW,
      organizationId: 'org-b',
    }
    await runTenantBatch(a, [payeeRepo.insertManyStatement(a, [smuggled])])

    expect(await names(a)).toEqual(['One', 'Three', 'Two'])
    expect(await names(b)).toEqual(['One', 'Two'])
  })

  it('scopes a remove and an update to the workspace of the scope that built them', async () => {
    const [removed, updated] = await runTenantBatch(a, [
      payeeRepo.removeWhereStatement(a, eq(payees.id, 'org-b-p1')),
      payeeRepo.updateWhereStatement(a, eq(payees.id, 'org-b-p2'), {
        name: 'Hijacked',
      }),
    ])

    expect(removed).toHaveLength(0)
    expect(updated).toHaveLength(0)
    expect(await names(b)).toEqual(['One', 'Two'])
  })

  it('keeps the guards of the executing methods on the builders', () => {
    expect(() =>
      payeeRepo.removeWhereStatement(a, undefined as never),
    ).toThrow()
    expect(() =>
      payeeRepo.updateWhereStatement(a, eq(payees.id, 'org-a-p1'), {
        organizationId: 'org-b',
      } as never),
    ).toThrow(TenantIsolationError)
    expect(() =>
      payeeRepo.updateWhereStatement(a, eq(payees.id, 'org-a-p1'), {}),
    ).toThrow()
  })

  it('refuses an empty batch', async () => {
    await expect(
      runTenantBatch(a, [] as unknown as Parameters<typeof runTenantBatch>[1]),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('refuses a statement built under another workspace’s scope, and runs nothing', async () => {
    await expect(
      runTenantBatch(a, [
        payeeRepo.removeWhereStatement(a, eq(payees.id, 'org-a-p1')),
        payeeRepo.removeWhereStatement(b, eq(payees.id, 'org-b-p1')),
      ]),
    ).rejects.toBeInstanceOf(TenantIsolationError)

    expect(await names(a)).toEqual(['One', 'Two'])
    expect(await names(b)).toEqual(['One', 'Two'])
  })

  it('refuses a statement built over another database handle', async () => {
    const elsewhere = createScope(openTestDb(), a.ctx)

    await expect(
      runTenantBatch(a, [
        payeeRepo.removeWhereStatement(elsewhere, eq(payees.id, 'org-a-p1')),
      ]),
    ).rejects.toBeInstanceOf(TenantIsolationError)
  })

  it('refuses a statement the base did not build', async () => {
    const raw = db.delete(payees).where(eq(payees.id, 'org-b-p1')).returning()

    await expect(runTenantBatch(a, [raw as never])).rejects.toBeInstanceOf(
      TenantIsolationError,
    )
    expect(await names(b)).toEqual(['One', 'Two'])
  })
})
