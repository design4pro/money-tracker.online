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
import {
  accounts,
  budgetCategories,
  currencies,
  payees,
} from '#/server/db/schema'
import {
  createMemoryMarkerStore,
  sweepBudgetThresholds,
} from '#/server/budgets/thresholds'

import {
  addBudgetTransactions,
  archiveBudget,
  budgetSpend,
  deleteBudget,
  getBudget,
  listBudgets,
  removeBudgetTransactions,
  restoreBudget,
  setBudgetCategories,
  updateBudget,
} from '../budgets'
import {
  closePeriod,
  listPeriods,
  materializePeriods,
  recomputeOpenPeriod,
  reopenPeriod,
} from '../budget-periods'
import {
  addSecondMember,
  createBudgetWorld,
  executed as harnessExecuted,
  seedBudget,
  seedCategory,
  seedPeriod,
  seedTransaction,
} from './budget-harness'
import {
  countUnread,
  insertNotification,
  listPrefsFor,
  markRead,
  pageForReader,
  upsertPref,
} from '../notifications'
import {
  advanceImportBatch,
  createImportBatch,
  getImportBatch,
  importFileKey,
  importsThisMonth,
  listImportBatches,
} from '../imports'

import { createTenantRepository, tenantFilter } from '../base'
import {
  ForbiddenError,
  MissingTenantContextError,
  NotFoundError,
  TenantIsolationError,
  UnscopedWriteError,
} from '../errors'
import { createScope } from '../scope'

import type { BudgetWorld } from './budget-harness'
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

  it('stamps the tenant column on a conflict-tolerant insert too', async () => {
    // The `ON CONFLICT` path is a second write route into the table, so it needs the same proof as
    // `insert`: a smuggled workspace id loses to the stamp, and the row is not reachable from B.
    const smuggled = {
      id: 'acc-a-98',
      organizationId: ORG_B,
      name: 'Smuggled',
      currencyCode: 'PLN',
      createdAt: NOW,
      updatedAt: NOW,
    } as unknown as Parameters<typeof accountRepo.insertOnConflictDoNothing>[1]

    const row = await accountRepo.insertOnConflictDoNothing(a, smuggled, [
      accounts.id,
    ])

    expect(row?.organizationId).toBe(ORG_A)
    await expect(accountRepo.findById(b, 'acc-a-98')).resolves.toBeNull()

    // The second offer of the same key is `null`, and it does not raise.
    await expect(
      accountRepo.insertOnConflictDoNothing(a, smuggled, [accounts.id]),
    ).resolves.toBeNull()
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

/* -------------------------------------------------------------------------- */
/* Budgets                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The budget repositories, held to the archetype above.
 *
 * A budget is an id in a URL that decides what a person is told about their own money, so the
 * assertions are the hostile ones: A calls **every** exported write with B's id, and after each
 * one B is re-read through B's own scope and compared. A write that matched no row but changed one
 * anyway is the failure this shape catches and a return-value assertion does not.
 *
 * The fixture is `budget-harness.ts` — the same two workspaces, the same real SQLite built from
 * `drizzle/*.sql` — rather than this file's `seedTwoWorkspaces`, because a budget needs categories,
 * transactions and periods to be worth attacking.
 */
describe('budgets cannot be reached across a workspace boundary', () => {
  let world: BudgetWorld

  beforeEach(async () => {
    world = await createBudgetWorld()
    await seedBudget(world.db, { id: 'bud-b', organizationId: 'org-b' })
    await seedPeriod(world.db, {
      budgetId: 'bud-b',
      organizationId: 'org-b',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      spentMinor: 900_00,
      closedAt: new Date('2026-02-01T00:00:00.000Z'),
    })
    await seedCategory(world.db, {
      id: 'cat-b',
      name: 'Food',
      organizationId: 'org-b',
    })
    await seedTransaction(world.db, {
      id: 'tx-b',
      organizationId: 'org-b',
      accountId: 'acc-b',
      categoryId: 'cat-b',
      refAmountMinor: 750_00,
      bookedOn: '2026-03-10',
    })
  })

  /** B's row, as B sees it. The comparison target after every attack. */
  async function budgetOfB() {
    return getBudget(world.otherScope, 'bud-b')
  }

  it('refuses every budget write aimed at another workspace’s id, and leaves the row alone', async () => {
    const before = await budgetOfB()

    await expect(getBudget(world.scope, 'bud-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      updateBudget(world.scope, 'bud-b', { limitMinor: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(archiveBudget(world.scope, 'bud-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(restoreBudget(world.scope, 'bud-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(deleteBudget(world.scope, 'bud-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      setBudgetCategories(world.scope, {
        budgetId: 'bud-b',
        categoryIds: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      addBudgetTransactions(world.scope, {
        budgetId: 'bud-b',
        transactionIds: ['tx-b'],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      removeBudgetTransactions(world.scope, {
        budgetId: 'bud-b',
        transactionIds: ['tx-b'],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(await budgetOfB()).toEqual(before)
    expect(await listBudgets(world.scope, { includeArchived: true })).toEqual(
      [],
    )
  })

  it('refuses another workspace’s category and transaction ids on a budget of its own', async () => {
    await seedBudget(world.db, { id: 'bud-a', kind: 'category' })
    await seedBudget(world.db, { id: 'bud-a-manual', kind: 'manual' })

    // A owns the budget; the ids it is pointing at belong to B. The tenant predicate on the
    // *referenced* rows is what makes this a `NotFoundError` rather than a foreign-key error at
    // some later read.
    await expect(
      setBudgetCategories(world.scope, {
        budgetId: 'bud-a',
        categoryIds: ['cat-b'],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      addBudgetTransactions(world.scope, {
        budgetId: 'bud-a-manual',
        transactionIds: ['tx-b'],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('never counts another workspace’s transaction, even under an identically named category', async () => {
    // Same name, same slug, different workspace — the case a `WHERE name = ?` would get wrong.
    await seedCategory(world.db, { id: 'cat-a', name: 'Food' })
    await seedBudget(world.db, { id: 'bud-a' })
    await world.db.insert(budgetCategories).values({
      organizationId: 'org-a',
      budgetId: 'bud-a',
      categoryId: 'cat-a',
    })
    await seedTransaction(world.db, {
      id: 'tx-a',
      categoryId: 'cat-a',
      refAmountMinor: 100_00,
      bookedOn: '2026-03-10',
    })

    const spend = await budgetSpend(
      world.scope,
      await getBudget(world.scope, 'bud-a'),
      {
        from: '2026-03-01',
        to: '2026-03-31',
      },
    )
    // 100,00, not 850,00.
    expect(spend.spentMinor).toBe(100_00)
  })

  it('refuses every period operation aimed at another workspace’s budget, and keeps its closed_at', async () => {
    // Not an empty list: `listPeriods` resolves the budget through A's scope first, so an id
    // belonging to B is indistinguishable from an id that does not exist.
    await expect(listPeriods(world.scope, 'bud-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )

    await expect(
      closePeriod(world.scope, {
        budgetId: 'bud-b',
        periodStart: '2026-01-01',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      reopenPeriod(world.scope, {
        budgetId: 'bud-b',
        periodStart: '2026-01-01',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      recomputeOpenPeriod(world.scope, 'bud-b', '2026-03-15'),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      materializePeriods(world.scope, {
        budgetId: 'bud-b',
        today: '2026-03-15',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const january = (await listPeriods(world.otherScope, 'bud-b')).at(0)
    expect(january?.closedAt).not.toBeNull()
    expect(january?.spentMinor).toBe(900_00)
  })

  it('sweeps only the caller’s budgets, and one workspace’s marker cannot silence another’s', async () => {
    // Two identical envelopes, one per workspace, both 45% over their 50% line.
    await seedBudget(world.db, { id: 'bud-a', alertThresholds: [50] })
    for (const [organizationId, budgetId] of [
      ['org-a', 'bud-a'],
      ['org-b', 'bud-b'],
    ] as const) {
      await seedPeriod(world.db, {
        organizationId,
        budgetId,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        spentMinor: 1_500_00,
      })
    }
    await updateBudget(world.otherScope, 'bud-b', { alertThresholds: [50] })

    const markers = createMemoryMarkerStore()
    const mine = await sweepBudgetThresholds({
      scope: world.scope,
      today: '2026-03-15',
      markers,
    })
    expect(mine.map((crossing) => crossing.budgetId)).toEqual(['bud-a'])

    // A's marker is now written. B's identical crossing must still be found.
    const theirs = await sweepBudgetThresholds({
      scope: world.otherScope,
      today: '2026-03-15',
      markers,
    })
    expect(theirs.map((crossing) => crossing.budgetId)).toEqual(['bud-b'])
  })
})

/* -------------------------------------------------------------------------- */
/* Imports                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Import batches, held to the archetype above, plus the one thing no other module in this file has
 * to answer for: **an object in a bucket**.
 *
 * A row that leaks is read through a scoped `SELECT` and the base repository makes that
 * inexpressible. A *key* is a string, and a string composed from a request body would let a caller
 * write bytes into — or point a row at — another workspace's prefix without any SQL being wrong at
 * all. So the assertions here are about the fake bucket's log as much as about the rows: what was
 * written, where, and whether anything was written before the refusal.
 *
 * The fixture is `budget-harness.ts` — the same two workspaces, the same real SQLite built from
 * `drizzle/*.sql` — because an upload needs an account to name, and `acc-b` belongs to B.
 */
describe('import batches cannot be reached or aimed across a workspace boundary', () => {
  /** Only the two methods the import path calls, with a memory of what it was asked to do. */
  class RecordingBucket {
    readonly writes: Array<string> = []
    readonly deletes: Array<string> = []

    async put(key: string): Promise<unknown> {
      this.writes.push(key)
      return {}
    }

    async delete(key: string): Promise<void> {
      this.deletes.push(key)
    }

    asR2(): R2Bucket {
      return this as unknown as R2Bucket
    }
  }

  const FILE = new TextEncoder().encode('data;kwota\n2026-01-02;-45,00\n')

  let importWorld: BudgetWorld
  let bucket: RecordingBucket

  beforeEach(async () => {
    importWorld = await createBudgetWorld()
    bucket = new RecordingBucket()
  })

  function payload(overrides: Record<string, unknown> = {}) {
    return {
      source: 'csv' as const,
      accountId: 'acc-a',
      fileName: 'wyciag.csv',
      byteSize: FILE.byteLength,
      ...overrides,
    }
  }

  it('refuses an accountId from another workspace with a not-found, and writes no object', async () => {
    // Not a `ForbiddenError`: a 403 would confirm that `acc-b` exists, which turns a guessed id
    // into an oracle for "does that workspace have this account".
    const attempt = createImportBatch(
      importWorld.scope,
      bucket.asR2(),
      payload({ accountId: 'acc-b' }),
      FILE,
    )

    await expect(attempt).rejects.toBeInstanceOf(NotFoundError)
    await expect(attempt).rejects.not.toBeInstanceOf(ForbiddenError)
    // The account is checked *before* the `put`, so a probe costs a `SELECT` and stores nothing.
    expect(bucket.writes).toEqual([])
    expect(bucket.deletes).toEqual([])
  })

  it('builds the key from the scope’s workspace, so a forged organizationId cannot move the object', async () => {
    // The forgery: the body claims to be B's. `createImportBatchSchema` is a `strictObject`, so an
    // unknown key does not parse at all — and even a caller who cast around the type reaches a key
    // composed from `scope.ctx`, which is the session's workspace and nothing else.
    let created: Awaited<ReturnType<typeof createImportBatch>> | null = null
    let refused: unknown = null
    try {
      created = await createImportBatch(
        importWorld.scope,
        bucket.asR2(),
        payload({ organizationId: 'org-b' }),
        FILE,
      )
    } catch (error) {
      refused = error
    }

    // Either the strict schema refused the extra key, or the object landed under A's prefix. What
    // must never happen is an object under `imports/org-b/`.
    if (created === null) {
      expect(refused).not.toBeNull()
      expect(bucket.writes).toEqual([])
    } else {
      expect(created.fileR2Key).toBe(
        importFileKey('org-a', created.id, 'wyciag.csv'),
      )
    }
    expect(bucket.writes.some((key) => key.startsWith('imports/org-b/'))).toBe(
      false,
    )
  })

  it('never lets A read, list or move B’s batch', async () => {
    const theirs = await createImportBatch(
      importWorld.otherScope,
      bucket.asR2(),
      payload({ accountId: 'acc-b' }),
      FILE,
    )

    await expect(
      getImportBatch(importWorld.scope, { id: theirs.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      advanceImportBatch(importWorld.scope, {
        id: theirs.id,
        status: 'failed',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    // B's row is untouched, as B sees it.
    const after = await getImportBatch(importWorld.otherScope, {
      id: theirs.id,
    })
    expect(after.status).toBe('queued')

    // And it is absent from A's list and from A's count, not merely unreadable by id.
    expect((await listImportBatches(importWorld.scope)).items).toEqual([])
    expect(await importsThisMonth(importWorld.scope)).toBe(0)
    expect(await importsThisMonth(importWorld.otherScope)).toBe(1)
  })

  it('scopes every statement the batch repository runs', async () => {
    // The harness's own log, because `createBudgetWorld` builds the database this world runs on.
    harnessExecuted.length = 0
    await createImportBatch(importWorld.scope, bucket.asR2(), payload(), FILE)
    await listImportBatches(importWorld.scope)

    const reads = harnessExecuted.filter((statement) =>
      statement.includes('import_batches'),
    )
    expect(reads.length).toBeGreaterThan(0)
    for (const statement of reads.filter(
      (candidate) => !candidate.startsWith('insert'),
    )) {
      expect(statement).toContain('organization_id')
    }
  })
})

describe('notifications cannot be read, counted or marked across a workspace boundary', () => {
  const AT = new Date('2026-03-15T10:00:00.000Z')
  const KIND = 'budget.threshold_crossed' as const

  let world: BudgetWorld

  beforeEach(async () => {
    world = await createBudgetWorld()
  })

  it('never lets A list, count or mark B’s notification', async () => {
    expect(
      await insertNotification(
        world.otherScope,
        {
          userId: 'user-b',
          kind: KIND,
          payloadJson: '{"v":1}',
          dedupeKey: 'budget:threshold:v1:b',
        },
        AT,
      ),
    ).toBe('written')

    // Absent from A's page and A's badge — not merely unreadable by id.
    expect((await pageForReader(world.scope)).items).toEqual([])
    expect(await countUnread(world.scope)).toBe(0)

    // And A cannot mark it, even holding the id.
    const theirs = (await pageForReader(world.otherScope)).items
    expect(theirs).toHaveLength(1)
    expect(await markRead(world.scope, { ids: [theirs[0].id] }, AT)).toBe(0)

    // B's row is untouched, as B sees it.
    expect(await countUnread(world.otherScope)).toBe(1)
    expect((await pageForReader(world.otherScope)).items[0].readAt).toBeNull()
  })

  it('lets two workspaces hold the same dedupe key, because the index is scoped', async () => {
    const dedupeKey = 'budget:threshold:v1:budget-1:2026-03-01:80'

    expect(
      await insertNotification(
        world.scope,
        { userId: 'user-a', kind: KIND, payloadJson: '{"v":1}', dedupeKey },
        AT,
      ),
    ).toBe('written')
    expect(
      await insertNotification(
        world.otherScope,
        { userId: 'user-b', kind: KIND, payloadJson: '{"v":1}', dedupeKey },
        AT,
      ),
    ).toBe('written')

    expect(await countUnread(world.scope)).toBe(1)
    expect(await countUnread(world.otherScope)).toBe(1)
  })

  it('reports the same key twice in one workspace as deduped, and stores one row', async () => {
    const input = {
      userId: 'user-a',
      kind: KIND,
      payloadJson: '{"v":1}',
      dedupeKey: 'budget:threshold:v1:budget-1:2026-03-01:80',
    }

    expect(await insertNotification(world.scope, input, AT)).toBe('written')
    // The retry a cron makes after a transient failure, since the marker is written last.
    expect(await insertNotification(world.scope, input, AT)).toBe('deduped')
    expect(await countUnread(world.scope)).toBe(1)
  })

  it('shows one person only the workspace they are acting in', async () => {
    // The sharpest case the scoped index has to survive: the *same* `user_id` on both rows, so
    // nothing but the workspace predicate separates them.
    await addSecondMember(world.db)
    const bInA = createScope(world.db, {
      userId: 'user-b',
      organizationId: 'org-a',
      role: 'member',
    })

    await insertNotification(
      world.otherScope,
      {
        userId: 'user-b',
        kind: KIND,
        payloadJson: '{"v":1}',
        dedupeKey: 'shared-key',
      },
      AT,
    )
    await insertNotification(
      bInA,
      {
        userId: 'user-b',
        kind: KIND,
        payloadJson: '{"v":2}',
        dedupeKey: 'shared-key',
      },
      AT,
    )

    const fromA = (await pageForReader(bInA)).items
    const fromB = (await pageForReader(world.otherScope)).items
    expect(fromA).toHaveLength(1)
    expect(fromB).toHaveLength(1)
    expect(fromA[0].payloadJson).toBe('{"v":2}')
    expect(fromB[0].payloadJson).toBe('{"v":1}')
  })

  it('never lets a preference written in one workspace reach another', async () => {
    await addSecondMember(world.db)
    const bInA = createScope(world.db, {
      userId: 'user-b',
      organizationId: 'org-a',
      role: 'member',
    })

    await upsertPref(
      world.otherScope,
      { kind: KIND, inApp: false, email: false, digest: false },
      AT,
    )
    await upsertPref(
      bInA,
      { kind: KIND, inApp: true, email: false, digest: true },
      AT,
    )

    // Two rows for the same person and kind, one per workspace, each read back through its own.
    const inA = (await listPrefsFor(bInA, 'user-b')).get(KIND)
    const inB = (await listPrefsFor(world.otherScope, 'user-b')).get(KIND)
    expect(inA?.inApp).toBe(true)
    expect(inB?.inApp).toBe(false)
    expect(inA?.id).not.toBe(inB?.id)

    // And A's owner, who wrote nothing, still has no row at all — defaults, not someone else's.
    expect((await listPrefsFor(world.scope, 'user-a')).size).toBe(0)
  })

  it('scopes every statement the notification repository runs', async () => {
    harnessExecuted.length = 0
    await insertNotification(
      world.scope,
      {
        userId: 'user-a',
        kind: KIND,
        payloadJson: '{"v":1}',
        dedupeKey: 'k',
      },
      AT,
    )
    await pageForReader(world.scope)
    await countUnread(world.scope)
    await markRead(world.scope, { ids: ['no-such-id'] }, AT)
    await upsertPref(
      world.scope,
      { kind: KIND, inApp: true, email: true, digest: true },
      AT,
    )

    const statements = harnessExecuted.filter(
      (statement) =>
        statement.includes('notifications') ||
        statement.includes('notification_prefs'),
    )
    expect(statements.length).toBeGreaterThan(0)
    for (const statement of statements.filter(
      (candidate) => !candidate.startsWith('insert'),
    )) {
      expect(statement).toContain('organization_id')
    }
  })
})
