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
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { organization, user } from '#/server/db/auth-schema'
import {
  accounts,
  attachments,
  budgetCategories,
  currencies,
  importBatches,
  payees,
} from '#/server/db/schema'
import { materializeSeries } from '#/server/recurring/materialize'
import { plannedScreenFor } from '#/routes/_app/transactions/-server/planned-data'
import { createLogger, createMemorySink } from '#/server/observability/logger'
import { ledgerPageFor } from '#/server/transactions/ledger-page'
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
import { isMember, memberScopeFor } from '../members'
import { applyUnsubscribe } from '#/server/email/unsubscribe'
import { signUnsubscribeToken } from '#/server/email/unsubscribe-token'
import { notify } from '#/server/notify/dispatch'
import {
  createAttachment,
  deleteAttachment,
  getAttachmentForRead,
  listAttachments,
} from '../attachments'
import {
  advanceImportBatch,
  createImportBatch,
  getImportBatch,
  importFileKey,
  importsThisMonth,
  listImportBatches,
  readImportBatchFile,
} from '../imports'

import { createSeries, getUpcoming } from '../recurring'
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
 * Only the three methods the import and attachment paths call, with a memory of what each was asked
 * to do. `get` answers `null`: the cases below assert that it was *not called*, so what it would
 * have returned is beside the point.
 */
class RecordingBucket {
  readonly writes: Array<string> = []
  readonly reads: Array<string> = []
  readonly deletes: Array<string> = []

  async put(key: string): Promise<unknown> {
    this.writes.push(key)
    return {}
  }

  async get(key: string): Promise<null> {
    this.reads.push(key)
    return null
  }

  async delete(key: string): Promise<void> {
    this.deletes.push(key)
  }

  asR2(): R2Bucket {
    return this as unknown as R2Bucket
  }
}

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

  /**
   * `file_r2_key` is a free-text column, so a row of A's can name an object in B's prefix after a
   * bug or a bad restore. The shared reader is the only place a batch's file is fetched, so it is
   * the place that has to refuse before the bucket is asked for anything.
   */
  it.each([
    {
      name: 'a key under another workspace',
      fileR2Key: 'imports/org-b/batch-b/statement.csv',
    },
    {
      name: 'a key under a workspace whose id merely starts with A’s',
      fileR2Key: 'imports/org-ab/batch-b/statement.csv',
    },
    {
      name: 'a key that walks out of A’s prefix with a dot segment',
      fileR2Key: 'imports/org-a/../org-b/batch-b/statement.csv',
    },
    {
      name: 'a key from another family',
      fileR2Key: 'attachments/org-a/txn-a/att-1',
    },
  ])(
    'refuses $name with a not-found and never asks the bucket for it',
    async ({ fileR2Key }) => {
      await importWorld.db.insert(importBatches).values({
        id: 'batch-poisoned',
        organizationId: ORG_A,
        source: 'csv',
        status: 'queued',
        fileR2Key,
        createdAt: NOW,
        updatedAt: NOW,
      })
      const batch = await getImportBatch(importWorld.scope, {
        id: 'batch-poisoned',
      })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

      try {
        const refused = await readImportBatchFile(
          importWorld.scope,
          bucket.asR2(),
          batch,
        ).catch((error: unknown) => error)

        expect(refused).toBeInstanceOf(NotFoundError)
        expect((refused as NotFoundError).message).toBe(
          'import batch batch-poisoned was not found.',
        )
        expect(bucket.reads).toEqual([])

        // The warning carries the batch id and never the key or the other workspace.
        expect(warn).toHaveBeenCalled()
        for (const [line, fields] of warn.mock.calls) {
          const text = `${String(line)} ${JSON.stringify(fields ?? '')}`
          expect(text).toContain('batch-poisoned')
          expect(text).not.toContain(fileR2Key)
          expect(text).not.toContain('org-b')
          expect(text).not.toContain('org-ab')
        }
      } finally {
        warn.mockRestore()
      }
    },
  )

  it('reads A’s own file through the reader, and answers null for a batch with no key', async () => {
    const own = await createImportBatch(
      importWorld.scope,
      bucket.asR2(),
      payload(),
      FILE,
    )

    // A check that refused everything would pass the cases above: the right key reaches the bucket.
    await readImportBatchFile(importWorld.scope, bucket.asR2(), own)
    expect(bucket.reads).toEqual([own.fileR2Key])

    bucket.reads.length = 0
    await expect(
      readImportBatchFile(importWorld.scope, bucket.asR2(), {
        ...own,
        fileR2Key: null,
      }),
    ).resolves.toBeNull()
    expect(bucket.reads).toEqual([])
  })
})

/**
 * An attachment row is the whole authorisation decision for a download, so a row whose stored key
 * points into another workspace's prefix has to be refused by the repository itself. The write path
 * only ever composes a key under the owner's prefix; this is the backstop for a bug, a bad restore
 * or a hand-edited row (`00-S12`, Phase 2).
 */
describe('an attachment row cannot be used to reach another workspace’s object', () => {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])

  let world: BudgetWorld
  let bucket: RecordingBucket

  beforeEach(async () => {
    world = await createBudgetWorld()
    bucket = new RecordingBucket()
    await seedTransaction(world.db, { id: 'txn-a', refAmountMinor: 120_00 })
    await seedTransaction(world.db, {
      id: 'txn-b',
      organizationId: ORG_B,
      accountId: 'acc-b',
      refAmountMinor: 200_00,
    })
  })

  function metadataFor(transactionId: string, originalName: string) {
    return {
      transactionId,
      contentType: 'application/pdf' as const,
      byteSize: PDF.byteLength,
      originalName,
    }
  }

  /**
   * B's receipt is created through B's scope so its key is a real one, then B's *row* is deleted
   * with a raw statement (a test may write SQL; the rule is for application code) so the unique
   * index on `r2_key` is free, and an A row is inserted carrying that key. B's object is still in
   * the bucket, which is the state a poisoned row would point at.
   */
  async function poisonedRowOfA() {
    const theirs = await createAttachment(
      world.otherScope,
      bucket.asR2(),
      metadataFor('txn-b', 'b-receipt.pdf'),
      PDF,
    )
    await world.db.delete(attachments).where(eq(attachments.id, theirs.id))
    await world.db.insert(attachments).values({
      id: 'att-poisoned',
      organizationId: ORG_A,
      transactionId: 'txn-a',
      r2Key: theirs.r2Key,
      contentType: 'application/pdf',
      byteSize: PDF.byteLength,
      originalName: 'poisoned.pdf',
      uploadedByUserId: world.scope.ctx.userId,
      createdAt: NOW,
    })
    return { poisonedId: 'att-poisoned', foreignKey: theirs.r2Key }
  }

  it('the files route refuses an object whose key prefix is not the caller’s workspace', async () => {
    const { poisonedId, foreignKey } = await poisonedRowOfA()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      // The route's own order: the repository read decides, and `serveAttachment` runs only when
      // it returned. A refusal therefore means the bucket is never asked for the bytes.
      const route = async (id: string) => {
        const row = await getAttachmentForRead(world.scope, { id })
        return bucket.asR2().get(row.r2Key)
      }

      const poisoned = route(poisonedId)
      await expect(poisoned).rejects.toBeInstanceOf(NotFoundError)
      expect(bucket.reads).toEqual([])

      // Indistinguishable from an id that does not exist: same class, same entity, same message
      // shape, and nothing in the error names the key or the other workspace.
      const missing = await getAttachmentForRead(world.scope, {
        id: 'att-nope',
      }).catch((error: unknown) => error)
      const refused = await poisoned.catch((error: unknown) => error)
      expect(refused).toBeInstanceOf(NotFoundError)
      expect((refused as NotFoundError).entity).toBe(
        (missing as NotFoundError).entity,
      )
      expect((refused as NotFoundError).message).toBe(
        `attachment ${poisonedId} was not found.`,
      )

      // Delete: the same refusal, and neither the object nor the row is touched.
      await expect(
        deleteAttachment(world.scope, bucket.asR2(), { id: poisonedId }),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(bucket.deletes).toEqual([])
      expect(
        await world.db
          .select({ id: attachments.id })
          .from(attachments)
          .where(eq(attachments.id, poisonedId)),
      ).toHaveLength(1)

      // The warning carries the attachment id and nothing else that identifies the target.
      expect(warn).toHaveBeenCalled()
      for (const [line] of warn.mock.calls) {
        const text = String(line)
        expect(text).toContain(poisonedId)
        expect(text).not.toContain(foreignKey)
        expect(text).not.toContain(ORG_B)
      }

      // A check that rejected everything would pass the lines above, so a correctly keyed row of
      // A's still reads and still deletes.
      const own = await createAttachment(
        world.scope,
        bucket.asR2(),
        metadataFor('txn-a', 'a-receipt.pdf'),
        PDF,
      )
      expect(own.r2Key.startsWith('attachments/org-a/')).toBe(true)
      expect((await getAttachmentForRead(world.scope, { id: own.id })).id).toBe(
        own.id,
      )
      await deleteAttachment(world.scope, bucket.asR2(), { id: own.id })
      expect(bucket.deletes).toEqual([own.r2Key])
    } finally {
      warn.mockRestore()
    }
  })

  /**
   * Keys no builder would compose, written straight into A's row. Each is distinct (the unique
   * index on `r2_key`) and each starts with something that looks like A's prefix:
   *
   * - `org-ab` shares `org-a` as characters, so a check that drops the trailing separator
   *   (`startsWith('attachments/org-a')`) lets it through;
   * - the traversal key starts with A's exact prefix and walks out of it into B's.
   */
  it.each([
    {
      name: 'a key under a workspace whose id merely starts with A’s',
      r2Key: 'attachments/org-ab/txn-b/att-collision',
    },
    {
      name: 'a key that walks out of A’s prefix with a dot segment',
      r2Key: 'attachments/org-a/../org-b/txn-b/att-traversal',
    },
  ])('refuses $name on read and on delete', async ({ r2Key }) => {
    await world.db.insert(attachments).values({
      id: 'att-poisoned',
      organizationId: ORG_A,
      transactionId: 'txn-a',
      r2Key,
      contentType: 'application/pdf',
      byteSize: PDF.byteLength,
      originalName: 'poisoned.pdf',
      uploadedByUserId: world.scope.ctx.userId,
      createdAt: NOW,
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const missing = await getAttachmentForRead(world.scope, {
        id: 'att-nope',
      }).catch((error: unknown) => error)

      // Read: the same class, entity and message shape as an id that does not exist, and the
      // bucket is never asked for the bytes.
      const refused = await getAttachmentForRead(world.scope, {
        id: 'att-poisoned',
      }).catch((error: unknown) => error)
      expect(refused).toBeInstanceOf(NotFoundError)
      expect((refused as NotFoundError).entity).toBe(
        (missing as NotFoundError).entity,
      )
      expect((refused as NotFoundError).message).toBe(
        'attachment att-poisoned was not found.',
      )
      expect(bucket.reads).toEqual([])

      // Delete: the same refusal, and neither the object nor the row is touched.
      const refusedDelete = await deleteAttachment(world.scope, bucket.asR2(), {
        id: 'att-poisoned',
      }).catch((error: unknown) => error)
      expect(refusedDelete).toBeInstanceOf(NotFoundError)
      expect((refusedDelete as NotFoundError).message).toBe(
        'attachment att-poisoned was not found.',
      )
      expect(bucket.deletes).toEqual([])
      expect(
        await world.db
          .select({ id: attachments.id })
          .from(attachments)
          .where(eq(attachments.id, 'att-poisoned')),
      ).toHaveLength(1)

      // The warning carries the attachment id and never the key.
      expect(warn).toHaveBeenCalled()
      for (const [line, fields] of warn.mock.calls) {
        const text = `${String(line)} ${JSON.stringify(fields ?? '')}`
        expect(text).toContain('att-poisoned')
        expect(text).not.toContain(r2Key)
        expect(text).not.toContain('org-ab')
      }

      // A check that rejected everything would pass the lines above, so a correctly keyed row of
      // A's still reads and still deletes.
      const own = await createAttachment(
        world.scope,
        bucket.asR2(),
        metadataFor('txn-a', 'a-receipt.pdf'),
        PDF,
      )
      expect((await getAttachmentForRead(world.scope, { id: own.id })).id).toBe(
        own.id,
      )
      await deleteAttachment(world.scope, bucket.asR2(), { id: own.id })
      expect(bucket.deletes).toEqual([own.r2Key])
    } finally {
      warn.mockRestore()
    }
  })

  it('lists without a poisoned row, and no item it returns carries r2Key', async () => {
    await world.db.insert(attachments).values({
      id: 'att-poisoned',
      organizationId: ORG_A,
      transactionId: 'txn-a',
      r2Key: 'attachments/org-b/txn-b/att-foreign',
      contentType: 'application/pdf',
      byteSize: PDF.byteLength,
      originalName: 'poisoned.pdf',
      uploadedByUserId: world.scope.ctx.userId,
      createdAt: NOW,
    })
    const own = await createAttachment(
      world.scope,
      bucket.asR2(),
      metadataFor('txn-a', 'a-receipt.pdf'),
      PDF,
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const listed = await listAttachments(world.scope, {
        transactionId: 'txn-a',
      })

      // The poisoned row is dropped, the honest one stays, and the call does not throw.
      expect(listed.map((item) => item.id)).toEqual([own.id])
      for (const item of listed) expect(item).not.toHaveProperty('r2Key')

      // The warning is the one the read and delete paths log: the attachment id, never the key.
      expect(warn).toHaveBeenCalledTimes(1)
      const [line, fields] = warn.mock.calls[0]
      const text = `${String(line)} ${JSON.stringify(fields ?? '')}`
      expect(text).toContain('att-poisoned')
      expect(text).not.toContain('att-foreign')
      expect(text).not.toContain(ORG_B)
    } finally {
      warn.mockRestore()
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
    ).not.toBeNull()

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
    ).not.toBeNull()
    expect(
      await insertNotification(
        world.otherScope,
        { userId: 'user-b', kind: KIND, payloadJson: '{"v":1}', dedupeKey },
        AT,
      ),
    ).not.toBeNull()

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

    expect(await insertNotification(world.scope, input, AT)).not.toBeNull()
    // The retry a cron makes after a transient failure, since the marker is written last.
    expect(await insertNotification(world.scope, input, AT)).toBeNull()
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

describe('membership is a question about one workspace at a time', () => {
  let world: BudgetWorld

  beforeEach(async () => {
    world = await createBudgetWorld()
  })

  it('does not see B’s member from A’s scope, or the reverse', async () => {
    await expect(isMember(world.scope, 'user-a')).resolves.toBe(true)
    await expect(isMember(world.scope, 'user-b')).resolves.toBe(false)
    await expect(isMember(world.otherScope, 'user-b')).resolves.toBe(true)
    await expect(isMember(world.otherScope, 'user-a')).resolves.toBe(false)
  })

  it('scopes the lookup, so the answer cannot come from another workspace’s row', async () => {
    harnessExecuted.length = 0
    await isMember(world.scope, 'user-b')

    const reads = harnessExecuted.filter((statement) =>
      statement.includes('from "member"'),
    )
    expect(reads.length).toBeGreaterThan(0)
    for (const statement of reads) {
      expect(statement).toContain('organization_id')
    }
  })

  it('turns notify into a no-op for somebody who belongs to the other workspace', async () => {
    // The dispatcher’s own refusal, end to end: `user-b` exists and is a member *somewhere*, which
    // is exactly the case a check on `user` rather than on `member` would wave through.
    const outcome = await notify(
      world.scope,
      {
        userId: 'user-b',
        kind: 'budget.threshold_crossed',
        payload: {
          v: 1,
          budgetId: 'budget-1',
          budgetName: 'Groceries',
          periodStart: '2026-03-01',
          threshold: 80,
          spentMinor: 160_000,
          availableMinor: 200_000,
          currencyCode: 'PLN',
        },
        dedupeKey: 'budget:threshold:v1:budget-1:2026-03-01:80',
      },
      new Date('2026-03-15T10:00:00.000Z'),
    )

    expect(outcome).toBe('skipped')
    // Nothing written in either workspace — not A’s, and not the one `user-b` does belong to.
    expect(await countUnread(world.scope)).toBe(0)
    expect(await countUnread(world.otherScope)).toBe(0)
  })
})

describe('an unsubscribe link acts in the workspace it names and nowhere else', () => {
  const KEYS = { current: 'test-signing-key' }
  let world: BudgetWorld

  beforeEach(async () => {
    world = await createBudgetWorld()
  })

  it('builds a scope only for a member of that workspace, with their own role', async () => {
    await addSecondMember(world.db)

    const bInA = await memberScopeFor(world.db, 'org-a', 'user-b')
    expect(bInA?.ctx).toEqual({
      userId: 'user-b',
      organizationId: 'org-a',
      role: 'member',
    })
    await expect(
      memberScopeFor(world.db, 'org-b', 'user-a'),
    ).resolves.toBeNull()
  })

  it('scopes the membership read to the workspace the link names', async () => {
    harnessExecuted.length = 0
    await memberScopeFor(world.db, 'org-a', 'user-b')

    const reads = harnessExecuted.filter((statement) =>
      statement.includes('from "member"'),
    )
    expect(reads.length).toBeGreaterThan(0)
    for (const statement of reads) {
      expect(statement).toContain('organization_id')
    }
  })

  it('never lets a token for B change A, for a person who is a member of both', async () => {
    await addSecondMember(world.db)
    const bInA = createScope(world.db, {
      userId: 'user-b',
      organizationId: 'org-a',
      role: 'member',
    })
    const token = await signUnsubscribeToken(
      { userId: 'user-b', organizationId: 'org-b', subject: 'budget.exceeded' },
      KEYS.current,
      NOW,
    )

    const outcome = await applyUnsubscribe(world.db, KEYS, token, NOW)

    expect(outcome).toMatchObject({ ok: true, workspaceName: 'B' })
    const inB = (await listPrefsFor(world.otherScope, 'user-b')).get(
      'budget.exceeded',
    )
    expect(inB?.email).toBe(false)
    // A holds no row for this person at all: their defaults, untouched.
    expect((await listPrefsFor(bInA, 'user-b')).size).toBe(0)
  })

  it('does nothing with a token for a workspace the person does not belong to', async () => {
    const token = await signUnsubscribeToken(
      { userId: 'user-b', organizationId: 'org-a', subject: 'budget.exceeded' },
      KEYS.current,
      NOW,
    )

    await expect(applyUnsubscribe(world.db, KEYS, token, NOW)).resolves.toEqual(
      {
        ok: false,
      },
    )
    expect((await listPrefsFor(world.otherScope, 'user-b')).size).toBe(0)
  })
})

/**
 * The upcoming read, which the planned screen widens by three ids of the series it joins.
 *
 * `getUpcoming` already scopes both halves of its join. What this case adds is the claim about the
 * **new** columns: `account_id`, `category_id` and `payee_id` are foreign keys, and three ids
 * leaving a repository are three more ways to hand one workspace another's row id if the join ever
 * loses its `tenantFilter`. So A and B each own a series built from their own account, category and
 * payee - under identical names - and A's read must return A's ids and not one of B's.
 */
describe('the upcoming read cannot leak another workspace’s series ids', () => {
  let world: BudgetWorld

  async function seedPayee(id: string, organizationId: string) {
    await world.db.insert(payees).values({
      id,
      organizationId,
      name: 'Landlord',
      createdAt: NOW,
      updatedAt: NOW,
    })
  }

  beforeEach(async () => {
    world = await createBudgetWorld()
    await seedCategory(world.db, { id: 'cat-a', name: 'Rent' })
    await seedCategory(world.db, {
      id: 'cat-b',
      name: 'Rent',
      organizationId: 'org-b',
    })
    await seedPayee('payee-a', 'org-a')
    await seedPayee('payee-b', 'org-b')

    for (const [scope, suffix] of [
      [world.scope, 'a'],
      [world.otherScope, 'b'],
    ] as const) {
      const series = await createSeries(scope, {
        name: 'Rent',
        expectedAmountMinor: 250_000,
        expectedCurrencyCode: 'PLN',
        startDate: '2026-04-10',
        accountId: `acc-${suffix}`,
        categoryId: `cat-${suffix}`,
        payeeId: `payee-${suffix}`,
      })
      await materializeSeries(scope, {
        seriesId: series.id,
        today: '2026-04-01',
        ahead: 1,
      })
    }
  })

  it('returns the caller’s own account, category and payee ids and none of the other workspace’s', async () => {
    const upcoming = await getUpcoming(world.scope, { today: '2026-04-01' })

    expect(upcoming.length).toBeGreaterThan(0)
    for (const period of upcoming) {
      expect(period.accountId).toBe('acc-a')
      expect(period.categoryId).toBe('cat-a')
      expect(period.payeeId).toBe('payee-a')
    }
    const seen = JSON.stringify(upcoming)
    expect(seen).not.toContain('acc-b')
    expect(seen).not.toContain('cat-b')
    expect(seen).not.toContain('payee-b')
  })

  it('returns null for a series whose links were never set, never a neighbour’s id', async () => {
    const bare = await createSeries(world.scope, {
      name: 'Bare',
      expectedAmountMinor: 100_00,
      expectedCurrencyCode: 'PLN',
      startDate: '2026-04-12',
    })
    await materializeSeries(world.scope, {
      seriesId: bare.id,
      today: '2026-04-01',
      ahead: 1,
    })

    const upcoming = await getUpcoming(world.scope, { today: '2026-04-01' })
    const mine = upcoming.filter((period) => period.seriesId === bare.id)

    expect(mine.length).toBeGreaterThan(0)
    for (const period of mine) {
      expect(period.accountId).toBeNull()
      expect(period.categoryId).toBeNull()
      expect(period.payeeId).toBeNull()
    }
  })

  it('keeps B’s expectations and planned rows off A’s planned screen', async () => {
    await seedTransaction(world.db, {
      id: 'plan-b',
      refAmountMinor: 777_00,
      organizationId: 'org-b',
      accountId: 'acc-b',
      categoryId: 'cat-b',
      bookedOn: '2026-04-20',
      isPlanned: true,
    })
    await seedTransaction(world.db, {
      id: 'plan-a',
      refAmountMinor: 100_00,
      bookedOn: '2026-04-21',
      isPlanned: true,
    })

    const page = await plannedScreenFor(
      world.scope,
      {
        policies: {
          planned: 'only',
          adjustments: 'exclude',
          transfers: 'include',
          completeness: 'any',
        },
        filters: {},
        sort: { field: 'bookedOn', direction: 'desc' },
        cursor: null,
      },
      '2026-04-01',
      {
        readLedger: ledgerPageFor,
        logger: createLogger({ sink: createMemorySink() }),
      },
    )

    if (page.expectations.state !== 'shown') {
      throw new Error('the group was not shown')
    }
    expect(page.expectations.rows.length).toBeGreaterThan(0)
    expect(page.rows.map((row) => row.id)).toEqual(['plan-a'])
    const seen = JSON.stringify(page)
    for (const foreign of ['acc-b', 'cat-b', 'payee-b', 'plan-b']) {
      expect(seen).not.toContain(foreign)
    }
  })

  it('narrows by a category only within the caller’s own tree', async () => {
    const page = await plannedScreenFor(
      world.scope,
      {
        policies: {
          planned: 'only',
          adjustments: 'exclude',
          transfers: 'include',
          completeness: 'any',
        },
        // B's category id, named from A's screen: it resolves to nothing in A's workspace.
        filters: { categoryIds: ['cat-b'] },
        sort: { field: 'bookedOn', direction: 'desc' },
        cursor: null,
      },
      '2026-04-01',
      {
        readLedger: ledgerPageFor,
        logger: createLogger({ sink: createMemorySink() }),
      },
    )

    expect(page.expectations).toMatchObject({ state: 'shown', rows: [] })
  })

  describe('the ledger read the planned screen shares with the ledger', () => {
    const POLICIES = {
      planned: 'only',
      adjustments: 'exclude',
      transfers: 'include',
      completeness: 'any',
    } as const
    const SORT = { field: 'bookedOn', direction: 'desc' } as const

    /** A holds two planned rows, B three, so a leak moves the ids, the count and the totals. */
    async function seedPlannedRows() {
      for (const [id, amount] of [
        ['plan-a-1', 100_00],
        ['plan-a-2', 200_00],
      ] as const) {
        await seedTransaction(world.db, {
          id,
          refAmountMinor: amount,
          bookedOn: '2026-04-20',
          isPlanned: true,
        })
      }
      for (const id of ['plan-b-1', 'plan-b-2', 'plan-b-3']) {
        await seedTransaction(world.db, {
          id,
          refAmountMinor: 777_00,
          organizationId: 'org-b',
          accountId: 'acc-b',
          categoryId: 'cat-b',
          bookedOn: '2026-04-21',
          isPlanned: true,
        })
      }
    }

    it('returns none of B’s row ids, totals or counts under A’s scope', async () => {
      await seedPlannedRows()

      const page = await ledgerPageFor(world.scope, {
        policies: POLICIES,
        filters: {},
        sort: SORT,
        cursor: null,
      })

      expect(page.rows.map((row) => row.id).sort()).toEqual([
        'plan-a-1',
        'plan-a-2',
      ])
      expect(page.total).toBe(2)
      expect(page.totals.expenseMinor).toBe(300_00)
      expect(JSON.stringify(page)).not.toContain('plan-b')
    })

    it('answers a cursor page from A’s ledger alone, with no group and no foreign id', async () => {
      await seedPlannedRows()
      const deps = {
        readLedger: ledgerPageFor,
        logger: createLogger({ sink: createMemorySink() }),
      }
      const first = await plannedScreenFor(
        world.scope,
        { policies: POLICIES, filters: {}, sort: SORT, cursor: null, limit: 1 },
        '2026-04-01',
        deps,
      )
      expect(first.nextCursor).not.toBeNull()

      const second = await plannedScreenFor(
        world.scope,
        {
          policies: POLICIES,
          filters: {},
          sort: SORT,
          cursor: first.nextCursor,
          limit: 1,
        },
        '2026-04-01',
        deps,
      )

      expect(second.rows).toHaveLength(1)
      expect(second.total).toBe(2)
      expect(second.expectations).toBeUndefined()
      const seen = JSON.stringify(second)
      for (const foreign of ['plan-b', 'acc-b', 'cat-b', 'payee-b']) {
        expect(seen).not.toContain(foreign)
      }
    })

    it('reads a cursor minted under B’s scope as A’s own page, never as B’s rows', async () => {
      await seedPlannedRows()
      const fromB = await ledgerPageFor(world.otherScope, {
        policies: POLICIES,
        filters: {},
        sort: SORT,
        cursor: null,
        limit: 1,
      })
      expect(fromB.nextCursor).not.toBeNull()

      const page = await ledgerPageFor(world.scope, {
        policies: POLICIES,
        filters: {},
        sort: SORT,
        cursor: fromB.nextCursor,
        limit: 1,
      }).catch(() => null)

      // The keyset only narrows A's own rows: it either refuses or answers from A, never from B.
      expect(JSON.stringify(page)).not.toContain('plan-b')
    })
  })
})
