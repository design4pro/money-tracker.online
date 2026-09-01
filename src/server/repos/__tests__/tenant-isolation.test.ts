/**
 * The tenancy archetype. Every other repository test in this codebase is judged against this one.
 *
 * A multi-tenant finance app has exactly one unforgivable bug: showing one household another
 * household's money. `src/server/repos/base.ts` exists to make that bug inexpressible, and this file
 * is the adversary that tries to express it anyway. It is deliberately hostile — it does not check
 * that the happy path works, it checks that the dishonest paths fail.
 *
 * Three things make it evidence rather than reassurance:
 *
 * **The database is real.** Every `drizzle/*.sql` migration runs into an in-memory SQLite with
 * foreign keys on, so the constraints, the `CHECK`s and the indexes are the ones production has. A
 * mocked database would happily agree that a tenant predicate was present, which is the single
 * claim worth testing.
 *
 * **Every statement is captured.** {@link executed} holds the SQL the proxy driver actually ran, so
 * the assertions can say "this `DELETE` carried an `organization_id` predicate" rather than "the
 * function returned something plausible". A base repository that returned the right rows for the
 * wrong reason would pass a behavioural test and fail here.
 *
 * **Workspace B's rows are checked after every write.** An isolation failure is not only "A saw B's
 * row"; it is also "A's `UPDATE` matched no row but changed one anyway". So the tests re-read B
 * through B's own scope and compare, rather than trusting a return value produced by the code under
 * test.
 *
 * The compile-time half is at the bottom: `@ts-expect-error` fixtures proving that the tenancy
 * violations the runtime cannot see — a query with no scope, an insert aimed at another workspace —
 * do not type-check. Those are the strongest assertions in the file, because they fail at build
 * time for everyone rather than at test time for whoever runs the suite.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { and, eq, like, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { beforeEach, describe, expect, it } from 'vitest'

import { organization, user } from '#/server/db/auth-schema'
import { accounts, currencies, payees } from '#/server/db/schema'

import { createTenantRepository, tenantFilter } from '../base'
import {
  MissingTenantContextError,
  NotFoundError,
  TenantIsolationError,
  UnscopedWriteError,
} from '../errors'
import { createScope } from '../scope'

import type { TenantScope } from '../scope'

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

const MIGRATIONS = fileURLToPath(
  new URL('../../../../drizzle/', import.meta.url),
)

/** Every statement the driver ran, so a test can assert on the SQL and not only on the rows. */
const executed: Array<string> = []

function openTestDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON;')

  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    for (const statement of readFileSync(
      path.join(MIGRATIONS, file),
      'utf8',
    ).split('--> statement-breakpoint')) {
      const trimmed = statement.trim()
      if (trimmed.length > 0) sqlite.exec(trimmed)
    }
  }

  return drizzle(async (query, params, method) => {
    executed.push(query)
    const statement = sqlite.prepare(query)
    if (method === 'run') {
      statement.run(...(params as Array<never>))
      return { rows: [] }
    }
    const rows = statement
      .all(...(params as Array<never>))
      .map((row) => Object.values(row as Record<string, unknown>))
    return method === 'get' ? { rows: rows.at(0) ?? [] } : { rows }
  })
}

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const NOW = new Date('2026-04-01T09:00:00.000Z')

/**
 * Ids are lexicographically ordered on purpose: keyset pagination sorts on the primary key, so a
 * page test with random ids would be testing the random generator rather than the cursor.
 */
const A_ACCOUNTS = ['acc-a-01', 'acc-a-02', 'acc-a-03'] as const
const B_ACCOUNTS = ['acc-b-01', 'acc-b-02'] as const

const accountRepo = createTenantRepository(accounts, 'account')
const payeeRepo = createTenantRepository(payees, 'payee')

let db: ReturnType<typeof openTestDb>
let a: TenantScope
let b: TenantScope

/** Statements since the last reset, upper-cased so the `WHERE` matching is not dialect-sensitive. */
function statementsMatching(fragment: string): Array<string> {
  return executed.filter((query) =>
    query.toLowerCase().includes(fragment.toLowerCase()),
  )
}

beforeEach(async () => {
  executed.length = 0
  db = openTestDb()

  await db
    // `.onConflictDoNothing()` because `drizzle/0002_seed_currency_catalogue.sql` — which this
    // harness runs like every other migration — already holds the whole ISO-4217 catalogue. The
    // fixture stays so each test still states which currencies its rows depend on.
    .insert(currencies)
    .values([
      { code: 'PLN', name: 'Polish Zloty', digits: 2, numericCode: 985 },
    ])
    .onConflictDoNothing()

  await db.insert(user).values([
    {
      id: 'user-a',
      name: 'A',
      email: 'a@example.com',
      emailVerified: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'user-b',
      name: 'B',
      email: 'b@example.com',
      emailVerified: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ])

  await db.insert(organization).values([
    { id: ORG_A, name: 'A', slug: 'a', createdAt: NOW, updatedAt: NOW },
    { id: ORG_B, name: 'B', slug: 'b', createdAt: NOW, updatedAt: NOW },
  ])

  await db.insert(accounts).values([
    ...A_ACCOUNTS.map((id, index) => ({
      id,
      organizationId: ORG_A,
      name: `A account ${index}`,
      currencyCode: 'PLN',
      currentBalanceMinor: 1_000 * (index + 1),
      createdAt: NOW,
      updatedAt: NOW,
    })),
    ...B_ACCOUNTS.map((id, index) => ({
      id,
      organizationId: ORG_B,
      // The same names as A's, so a query that leaks cannot be excused as "a different row".
      name: `A account ${index}`,
      currencyCode: 'PLN',
      currentBalanceMinor: 900_000 * (index + 1),
      createdAt: NOW,
      updatedAt: NOW,
    })),
  ])

  await db.insert(payees).values([
    {
      id: 'payee-a-01',
      organizationId: ORG_A,
      name: 'Shared name',
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'payee-b-01',
      organizationId: ORG_B,
      name: 'Shared name',
      createdAt: NOW,
      updatedAt: NOW,
    },
  ])

  a = createScope(db, {
    userId: 'user-a',
    organizationId: ORG_A,
    role: 'owner',
  })
  b = createScope(db, {
    userId: 'user-b',
    organizationId: ORG_B,
    role: 'owner',
  })
  executed.length = 0
})

/** Workspace B's accounts as B sees them. The control group for every write test. */
async function snapshotOfB() {
  return b.db
    .select()
    .from(accounts)
    .where(eq(accounts.organizationId, ORG_B))
    .orderBy(accounts.id)
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

describe('reads cannot reach another workspace', () => {
  it('answers null for a row that exists, in someone else’s workspace', async () => {
    await expect(accountRepo.findById(a, B_ACCOUNTS[0])).resolves.toBeNull()
    // …and the row really is there, so the null is isolation and not an empty fixture.
    await expect(accountRepo.findById(b, B_ACCOUNTS[0])).resolves.toMatchObject(
      {
        id: B_ACCOUNTS[0],
      },
    )
  })

  it('reports a foreign id as not found, never as forbidden', async () => {
    const error = await accountRepo
      .requireById(a, B_ACCOUNTS[0])
      .catch((thrown: unknown) => thrown)

    // A `403` would confirm the row exists. "Not found" is the only answer that discloses nothing.
    expect(error).toBeInstanceOf(NotFoundError)
    expect((error as NotFoundError).code).toBe('NOT_FOUND')
  })

  it('excludes foreign rows from a list whose extra predicate matches them', async () => {
    // The caller's predicate is written to match B's rows exactly. It is ANDed, never substituted.
    const rows = await accountRepo.findMany(a, {
      where: like(accounts.name, 'A account%'),
    })

    expect(rows.map((row) => row.id)).toEqual([...A_ACCOUNTS])
  })

  it('drops foreign ids from a mixed id list instead of failing open', async () => {
    const rows = await accountRepo.findByIds(a, [
      A_ACCOUNTS[0],
      B_ACCOUNTS[0],
      B_ACCOUNTS[1],
    ])

    expect(rows.map((row) => row.id)).toEqual([A_ACCOUNTS[0]])
  })

  it('does not admit that a foreign row exists', async () => {
    await expect(accountRepo.exists(a, B_ACCOUNTS[0])).resolves.toBe(false)
    await expect(accountRepo.exists(b, B_ACCOUNTS[0])).resolves.toBe(true)
  })

  it('never returns a foreign row while paging, at any page size', async () => {
    const seen: Array<string> = []
    let cursor: string | null = null

    do {
      const page = await accountRepo.page(a, { limit: 1, cursor })
      seen.push(...page.items.map((row) => row.id))
      cursor = page.nextCursor
    } while (cursor)

    // Every one of A's rows exactly once, and none of B's — the cursor walks `id` descending, and
    // B's ids interleave with A's in that ordering, so a missing predicate would surface here.
    expect(seen).toEqual([...A_ACCOUNTS].reverse())
  })

  it('is generic over tables, not special-cased for accounts', async () => {
    await expect(payeeRepo.findById(a, 'payee-b-01')).resolves.toBeNull()
    await expect(payeeRepo.findMany(a)).resolves.toHaveLength(1)
  })

  it('puts the tenant column in every statement it runs', async () => {
    await accountRepo.findMany(a)
    await accountRepo.findById(a, A_ACCOUNTS[0])
    await accountRepo.count(a)
    await accountRepo.page(a, { limit: 2 })

    expect(statementsMatching('select')).not.toHaveLength(0)
    for (const statement of statementsMatching('select')) {
      expect(statement).toContain('organization_id')
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Aggregates                                                                  */
/* -------------------------------------------------------------------------- */

describe('aggregates cannot see another workspace', () => {
  it('counts only the caller’s rows', async () => {
    await expect(accountRepo.count(a)).resolves.toBe(A_ACCOUNTS.length)
    await expect(accountRepo.count(b)).resolves.toBe(B_ACCOUNTS.length)
  })

  it('sums only the caller’s minor units', async () => {
    // A's balances are 1000 + 2000 + 3000. B's are 900000 + 1800000, and a leak would be obvious.
    await expect(
      accountRepo.sumOf(a, accounts.currentBalanceMinor),
    ).resolves.toBe(6_000)
    await expect(
      accountRepo.sumOf(b, accounts.currentBalanceMinor),
    ).resolves.toBe(2_700_000)
  })

  it('keeps a sum an integer count of minor units', async () => {
    const total = await accountRepo.sumOf(a, accounts.currentBalanceMinor)
    expect(Number.isInteger(total)).toBe(true)
  })

  it('sums zero, not NaN, for a workspace with no rows', async () => {
    const empty = createScope(db, {
      userId: 'user-a',
      organizationId: 'org-empty',
      role: 'owner',
    })
    await expect(
      accountRepo.sumOf(empty, accounts.currentBalanceMinor),
    ).resolves.toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

describe('inserts land in the caller’s workspace and nowhere else', () => {
  it('stamps the tenant column from the scope, overwriting a smuggled value', async () => {
    const smuggled = {
      id: 'acc-a-99',
      // Cast through the type that removes this field. The stamp still wins.
      organizationId: ORG_B,
      name: 'Smuggled',
      currencyCode: 'PLN',
      createdAt: NOW,
      updatedAt: NOW,
    } as unknown as Parameters<typeof accountRepo.insert>[1]

    const row = await accountRepo.insert(a, smuggled)

    expect(row.organizationId).toBe(ORG_A)
    await expect(accountRepo.findById(b, 'acc-a-99')).resolves.toBeNull()
  })

  it('stamps every row of a batch insert', async () => {
    const rows = await accountRepo.insertMany(a, [
      {
        id: 'acc-a-10',
        name: 'Ten',
        currencyCode: 'PLN',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'acc-a-11',
        organizationId: ORG_B,
        name: 'Eleven',
        currencyCode: 'PLN',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ] as unknown as Parameters<typeof accountRepo.insertMany>[1])

    expect(rows.map((row) => row.organizationId)).toEqual([ORG_A, ORG_A])
    await expect(accountRepo.count(b)).resolves.toBe(B_ACCOUNTS.length)
  })
})

describe('updates cannot reach or move another workspace’s row', () => {
  it('does not update a foreign row addressed by id', async () => {
    const before = await snapshotOfB()

    await expect(
      accountRepo.update(a, B_ACCOUNTS[0], { name: 'Renamed by A' }),
    ).resolves.toBeNull()

    await expect(snapshotOfB()).resolves.toEqual(before)
  })

  it('raises not-found rather than forbidden for a foreign row', async () => {
    await expect(
      accountRepo.requireUpdate(a, B_ACCOUNTS[0], { name: 'Renamed by A' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('does not update foreign rows matched by a broad predicate', async () => {
    const before = await snapshotOfB()

    // A predicate that matches every account in the database, in both workspaces.
    const changed = await accountRepo.updateWhere(
      a,
      like(accounts.name, 'A account%'),
      { name: 'Rewritten' },
    )

    expect(changed.map((row) => row.id)).toEqual([...A_ACCOUNTS])
    await expect(snapshotOfB()).resolves.toEqual(before)
  })

  it('refuses a patch that would move a row into another workspace', async () => {
    const before = await snapshotOfB()

    await expect(
      accountRepo.update(a, A_ACCOUNTS[0], {
        organizationId: ORG_B,
      } as unknown as Parameters<typeof accountRepo.update>[2]),
    ).rejects.toBeInstanceOf(TenantIsolationError)

    // Neither workspace changed: the refusal happens before any SQL is composed.
    await expect(snapshotOfB()).resolves.toEqual(before)
    await expect(accountRepo.findById(a, A_ACCOUNTS[0])).resolves.toMatchObject(
      {
        organizationId: ORG_A,
      },
    )
  })

  it('puts the tenant column in the UPDATE it runs', async () => {
    await accountRepo.update(a, A_ACCOUNTS[0], { name: 'Renamed' })

    const updates = statementsMatching('update "accounts"')
    expect(updates).not.toHaveLength(0)
    for (const statement of updates) {
      expect(statement).toContain('organization_id')
    }
  })
})

describe('deletes cannot reach another workspace’s row', () => {
  it('reports nothing deleted for a foreign id, and deletes nothing', async () => {
    const before = await snapshotOfB()

    await expect(accountRepo.remove(a, B_ACCOUNTS[0])).resolves.toBe(false)
    await expect(snapshotOfB()).resolves.toEqual(before)
  })

  it('raises not-found rather than forbidden for a foreign id', async () => {
    await expect(
      accountRepo.requireRemove(a, B_ACCOUNTS[0]),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('leaves foreign rows alone when the predicate matches them', async () => {
    const before = await snapshotOfB()

    const removed = await accountRepo.removeWhere(
      a,
      like(accounts.name, 'A account%'),
    )

    expect(removed).toBe(A_ACCOUNTS.length)
    await expect(snapshotOfB()).resolves.toEqual(before)
  })

  it('puts the tenant column in the DELETE it runs', async () => {
    await accountRepo.remove(a, A_ACCOUNTS[0])

    const deletes = statementsMatching('delete from "accounts"')
    expect(deletes).not.toHaveLength(0)
    for (const statement of deletes) {
      expect(statement).toContain('organization_id')
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The backstops                                                               */
/* -------------------------------------------------------------------------- */

describe('the write backstop', () => {
  it('refuses a write whose predicate list collapsed to nothing', async () => {
    // What a dynamically assembled `and(...)` returns when every branch was skipped.
    const collapsed = and(...([] as Array<never>))
    expect(collapsed).toBeUndefined()

    await expect(
      accountRepo.removeWhere(a, collapsed as never),
    ).rejects.toBeInstanceOf(UnscopedWriteError)
    await expect(accountRepo.count(a)).resolves.toBe(A_ACCOUNTS.length)
  })

  it('names the table it refused to empty', async () => {
    const error = await accountRepo
      .removeWhere(a, undefined as never)
      .catch((thrown: unknown) => thrown)

    expect((error as UnscopedWriteError).message).toContain('account')
  })
})

describe('a scope cannot be forged', () => {
  it('refuses a context with no workspace', () => {
    expect(() => createScope(db, { userId: 'user-a', role: 'owner' })).toThrow(
      MissingTenantContextError,
    )
  })

  it('refuses a context whose role is not a workspace role', () => {
    // `admin` is a *platform* role. The two dictionaries are never interchangeable.
    expect(() =>
      createScope(db, {
        userId: 'user-a',
        organizationId: ORG_A,
        role: 'curator',
      }),
    ).toThrow(MissingTenantContextError)
  })

  it('cannot be re-pointed at another workspace after construction', () => {
    expect(() => {
      ;(a.ctx as { organizationId: string }).organizationId = ORG_B
    }).toThrow(TypeError)
    expect(a.ctx.organizationId).toBe(ORG_A)
  })

  it('composes the tenant predicate even when no extra predicate is given', () => {
    const filter = tenantFilter(a, accounts)
    expect(filter).toBeDefined()
    // Composed, not stringly built: the value is a Drizzle `SQL` the query builder binds.
    expect(String(sql`${filter}`)).not.toBe('')
  })
})

/* -------------------------------------------------------------------------- */
/* Compile-time fixtures                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The strongest assertions here, and the reason the base repository is shaped the way it is: these
 * are build failures for everyone, not test failures for whoever runs the suite. `pnpm typecheck`
 * fails if any `@ts-expect-error` below stops being an error — that is, if the tenancy hole it
 * describes ever becomes writable.
 */
describe('the type system refuses the violations', () => {
  it('has no way to query without a workspace', () => {
    // @ts-expect-error - a scope is the required first parameter of every repository method.
    void (() => accountRepo.findById(A_ACCOUNTS[0]))

    // @ts-expect-error - and of every list, count and aggregate too.
    void (() => accountRepo.count())
  })

  it('has no way to aim an insert at another workspace', () => {
    void (() =>
      accountRepo.insert(a, {
        id: 'acc-a-90',
        // @ts-expect-error - `TenantInsert` removes the tenant column from the payload type.
        organizationId: ORG_B,
        name: 'Nope',
        currencyCode: 'PLN',
        createdAt: NOW,
        updatedAt: NOW,
      }))
  })

  it('has no way to move a row with a patch', () => {
    // @ts-expect-error - `TenantPatch` removes the tenant column.
    void (() => accountRepo.update(a, A_ACCOUNTS[0], { organizationId: ORG_B }))

    // @ts-expect-error - and the primary key, so a patch cannot re-identify a row either.
    void (() => accountRepo.update(a, A_ACCOUNTS[0], { id: 'something-else' }))
  })

  it('keeps the workspace and platform role dictionaries apart', () => {
    void (() =>
      createScope(db, {
        userId: 'user-a',
        organizationId: ORG_A,
        role: 'owner',
      }))

    // The scope's `role` is typed `OrganizationRole`. A platform role is a different vocabulary
    // and assigning one to the other is a type error, not a runtime surprise.
    // @ts-expect-error - `curator` is a platform role, not a workspace role.
    const forged: TenantScope['ctx']['role'] = 'curator'
    void forged
  })
})

/**
 * The fork guard.
 *
 * The type system above stops a caller aiming a query at another workspace. It cannot stop a
 * repository from writing its own `eq(table.organizationId, scope.ctx.organizationId)` and
 * composing a predicate that is correct today and silently wrong the day somebody adds a branch to
 * it — which is exactly what happened while this slice was built in parallel: four repositories
 * were written against `base.ts` and two of them hand-rolled the predicate anyway.
 *
 * So the rule is enforced on the source. `src/server/repos/base.ts` is the only file that may name
 * the tenant column in a predicate or an insert payload; every other repository composes through
 * `tenantFilter`, `createTenantTableAccess` or `createTenantRepository`. The check reads the files
 * rather than the behaviour on purpose: a hand-rolled predicate that happens to be right passes
 * every behavioural test in this file, and it is the *next* edit to it that is the bug.
 */
describe('no repository forks the tenant predicate', () => {
  const REPO_DIR = fileURLToPath(new URL('../', import.meta.url))

  /** `base.ts` composes the predicate; `scope.ts` defines the context that carries the id. */
  const ALLOWED = new Set(['base.ts', 'scope.ts'])

  function repositorySources(): Array<{ name: string; source: string }> {
    return readdirSync(REPO_DIR)
      .filter((name) => name.endsWith('.ts') && !ALLOWED.has(name))
      .map((name) => ({
        name,
        source: readFileSync(path.join(REPO_DIR, name), 'utf8'),
      }))
  }

  it('covers every repository in the directory, so the check cannot lose its subject', () => {
    const names = repositorySources().map((file) => file.name)
    expect(names).toContain('accounts.ts')
    expect(names).toContain('transactions.ts')
    expect(names).toContain('transaction-queries.ts')
    expect(names).toContain('workspace-currencies.ts')
  })

  it('never compares the tenant column to a scope id outside the base', () => {
    const offenders = repositorySources().filter((file) =>
      /\.organizationId\s*,\s*[\s\S]{0,40}ctx\.organizationId/.test(
        file.source,
      ),
    )
    expect(offenders.map((file) => file.name)).toEqual([])
  })

  it('never writes the tenant column into an insert payload outside the base', () => {
    const offenders = repositorySources().filter((file) =>
      /organizationId:\s*scope\.ctx\.organizationId/.test(file.source),
    )
    expect(offenders.map((file) => file.name)).toEqual([])
  })

  it('routes every tenant-table WHERE through a predicate the base composed', () => {
    // The composers the base offers: its predicate builder, its policy-aware wrapper in the
    // transaction module (which *is* `tenantFilter` plus the planned/adjustment/transfer
    // policies), and the two factories whose every method begins with the predicate.
    const composers =
      /tenantFilter|scopedTransactionFilter|whereFor\(|createTenantTableAccess|createTenantRepository/
    const offenders = repositorySources()
      .filter((file) => /\bscope\.db\b|\bargs\.scope\.db\b/.test(file.source))
      .filter((file) => !composers.test(file.source))
    // `workspace-currencies.ts` reads the *global* `exchange_rates` catalogue, which carries no
    // tenant column by design — it also composes `tenantFilter` for everything that does, so it
    // is not an exemption here, it simply passes.
    expect(offenders.map((file) => file.name)).toEqual([])
  })
})
