/**
 * The rebuild, end to end, against a real SQLite database built from `drizzle/*.sql`.
 *
 * The defect this file exists for: `account_balances` was written once by the seed and then never
 * again, so the first transaction a person entered left the net-worth chart disagreeing with the
 * net-worth figure printed beside it. `scripts/seed/verify.mjs` names that invariant
 * `balanceGridEndsAtTheCachedBalance`, and {@link endsAtTheCachedBalance} below is the same
 * assertion in one process instead of two.
 *
 * Every write here goes through the real repository — `createTransaction`, `updateTransaction`,
 * `deleteTransaction`, `adjustAccountBalance` — inside a real `runWithLedgerBatch`, with the ledger
 * Durable Object replaced by a fake whose only job is to call the same rebuild port the Worker
 * hands the real one. A test that called `rebuildAccountBalance` directly would prove the rebuild
 * works and prove nothing about whether anything calls it, which is exactly the defect.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { and, asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCurrencyCode, asRateE10 } from '#/lib/money'
import { organization, user } from '#/server/db/auth-schema'
import {
  accountBalances,
  accounts,
  currencies,
  exchangeRates,
  organizationCurrencies,
  organizationExchangeRates,
} from '#/server/db/schema'
import { runWithLedgerBatch, setLedgerBatchPorts } from '#/server/ledger/batch'

import { adjustAccountBalance } from '../accounts'
import { rebuildAccountBalance } from '../account-balances'
import { createScope } from '../scope'
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from '../transactions'
import { resolveRate } from '../workspace-currencies'

import type { RateE10 } from '#/lib/money'
import type { Database, TenantScope } from '../base'
import type { ConversionContext, TransactionPolicies } from '../transactions'

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

const MIGRATIONS = fileURLToPath(
  new URL('../../../../drizzle/', import.meta.url),
)

/** A real SQLite database built from the generated DDL, behind Drizzle's proxy driver. */
function openTestDb(): Database {
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

  const one = (query: string, params: Array<unknown>, method: string) => {
    const statement = sqlite.prepare(query)
    if (method === 'run') {
      statement.run(...(params as Array<never>))
      return { rows: [] }
    }
    const rows = statement
      .all(...(params as Array<never>))
      .map((row) => Object.values(row as Record<string, unknown>))
    return method === 'get' ? { rows: rows.at(0) ?? [] } : { rows }
  }

  return drizzle((query, params, method) =>
    Promise.resolve(one(query, params, method)),
  )
}

const EVERYTHING: TransactionPolicies = {
  planned: 'include',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
}

/** `2026-09-30` is the fixture's "today", so every grid below ends there. */
const TODAY = new Date('2026-09-30T09:00:00.000Z')
const ANCHOR = '2026-09-30'

const EUR_RATE = asRateE10(43_000_000_000)
const USD_RATE = asRateE10(39_500_000_000)

let db: Database
let scope: TenantScope
let conversion: ConversionContext

/**
 * The ledger wiring, minus the Durable Object.
 *
 * `runWithLedgerBatch` collects touched accounts and fetches one stub per account; the real stub
 * runs `AccountLedger`, whose rebuild port `src/server/worker.ts` sets to `rebuildAccountBalance`.
 * This fake short-circuits the object and keeps the port, because what is under test is that the
 * write paths reach the port at all — the object's own lock and dirty bit are its own tests'.
 */
function installLedger(now: () => Date): void {
  setLedgerBatchPorts({
    namespace: () => ({
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => ({
        fetch: async (request: Request) => {
          const accountId = new URL(request.url).searchParams.get('accountId')
          if (accountId !== null) {
            await rebuildAccountBalance(db, accountId, { now })
          }
          return new Response(null, { status: 204 })
        },
      }),
    }),
  })
}

/** Every stored snapshot for one account, oldest first. */
async function gridOf(accountId: string) {
  return db
    .select({
      date: accountBalances.date,
      nativeMinor: accountBalances.nativeMinor,
      refMinor: accountBalances.refMinor,
      rateE10: accountBalances.rateE10,
    })
    .from(accountBalances)
    .where(eq(accountBalances.accountId, accountId))
    .orderBy(asc(accountBalances.date))
}

async function cachedBalanceOf(accountId: string) {
  const rows = await db
    .select({
      currentBalanceMinor: accounts.currentBalanceMinor,
      refCurrentBalanceMinor: accounts.refCurrentBalanceMinor,
    })
    .from(accounts)
    .where(eq(accounts.id, accountId))
  return rows[0]
}

/**
 * `verify.mjs`'s `balanceGridEndsAtTheCachedBalance`, in one process.
 *
 * The last snapshot must be today's and must equal `accounts.current_balance_minor`. The two are
 * views of one number and a person sees both on the same screen.
 */
async function endsAtTheCachedBalance(accountId: string): Promise<void> {
  const grid = await gridOf(accountId)
  const cached = await cachedBalanceOf(accountId)
  expect(grid.length).toBeGreaterThan(0)
  expect(grid.at(-1)?.date).toBe(ANCHOR)
  expect(grid.at(-1)?.nativeMinor).toBe(cached.currentBalanceMinor)
}

beforeEach(async () => {
  db = openTestDb()
  installLedger(() => TODAY)

  const now = new Date('2026-01-01T00:00:00.000Z')
  await db
    .insert(currencies)
    .values([
      { code: 'PLN', name: 'Polish Zloty', digits: 2, numericCode: 985 },
      { code: 'EUR', name: 'Euro', digits: 2, numericCode: 978 },
      { code: 'USD', name: 'US Dollar', digits: 2, numericCode: 840 },
    ])
    .onConflictDoNothing()

  await db.insert(user).values({
    id: 'user-a',
    name: 'A',
    email: 'a@example.com',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db
    .insert(organization)
    .values({ id: 'org-a', name: 'A', slug: 'a', createdAt: now })

  await db.insert(organizationCurrencies).values([
    {
      organizationId: 'org-a',
      currencyCode: 'PLN',
      isBase: true,
      liveRateUpdate: true,
      addedAt: now,
    },
    {
      organizationId: 'org-a',
      currencyCode: 'EUR',
      isBase: false,
      liveRateUpdate: true,
      addedAt: now,
    },
    {
      organizationId: 'org-a',
      currencyCode: 'USD',
      isBase: false,
      liveRateUpdate: true,
      addedAt: now,
    },
  ])

  // A rate for every day the fixtures reach, both pairs. Flat, so a case about the *grid* is not
  // also a case about the rate curve; the rate-curve cases set their own rows.
  const rates: Array<typeof exchangeRates.$inferInsert> = []
  for (let day = new Date('2026-08-25T00:00:00.000Z'); day <= TODAY;) {
    const date = day.toISOString().slice(0, 10)
    rates.push(
      {
        baseCode: 'EUR',
        quoteCode: 'PLN',
        date,
        rateE10: EUR_RATE,
        source: 'manual',
        fetchedAt: now,
      },
      {
        baseCode: 'USD',
        quoteCode: 'PLN',
        date,
        rateE10: USD_RATE,
        source: 'manual',
        fetchedAt: now,
      },
    )
    day = new Date(day.getTime() + 86_400_000)
  }
  await db.insert(exchangeRates).values(rates)

  await db.insert(accounts).values([
    {
      id: 'acc-pln',
      organizationId: 'org-a',
      name: 'Everyday',
      currencyCode: 'PLN',
      initialBalanceMinor: 1_000_00,
      refInitialBalanceMinor: 1_000_00,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'acc-eur',
      organizationId: 'org-a',
      name: 'Euro current',
      currencyCode: 'EUR',
      initialBalanceMinor: 200_00,
      refInitialBalanceMinor: 860_00,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'acc-usd',
      organizationId: 'org-a',
      name: 'Dollar savings',
      currencyCode: 'USD',
      initialBalanceMinor: 500_00,
      refInitialBalanceMinor: 1_975_00,
      createdAt: now,
      updatedAt: now,
    },
  ])

  scope = createScope(db, {
    userId: 'user-a',
    organizationId: 'org-a',
    role: 'owner',
  })
  conversion = {
    baseCurrencyCode: asCurrencyCode('PLN'),
    resolveRate: (query) => resolveRate(scope, query),
  }
})

function spend(accountId: string, amountMinor: number, bookedOn: string) {
  return runWithLedgerBatch(() =>
    createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: {
        accountId,
        direction: 'expense',
        amountMinor,
        currencyCode:
          accountId === 'acc-eur'
            ? 'EUR'
            : accountId === 'acc-usd'
              ? 'USD'
              : 'PLN',
        bookedOn,
      },
    }),
  )
}

/* -------------------------------------------------------------------------- */
/* The defect: a write through the app must rebuild the grid                   */
/* -------------------------------------------------------------------------- */

describe('a transaction written through the repository', () => {
  it('leaves the grid ending at the cached balance after a create, an edit and a delete', async () => {
    const created = await spend('acc-pln', 120_00, '2026-09-10')
    await endsAtTheCachedBalance('acc-pln')
    expect((await cachedBalanceOf('acc-pln')).currentBalanceMinor).toBe(880_00)

    await runWithLedgerBatch(() =>
      updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        id: created.id,
        patch: { amountMinor: 300_00 },
      }),
    )
    await endsAtTheCachedBalance('acc-pln')
    expect((await cachedBalanceOf('acc-pln')).currentBalanceMinor).toBe(700_00)

    await runWithLedgerBatch(() =>
      deleteTransaction({ scope, policies: EVERYTHING, id: created.id }),
    )
    await endsAtTheCachedBalance('acc-pln')
    expect((await cachedBalanceOf('acc-pln')).currentBalanceMinor).toBe(
      1_000_00,
    )
  })

  it('moves the movement when an edit moves its date, leaving no stale day behind', async () => {
    const created = await spend('acc-pln', 120_00, '2026-09-10')
    const before = await gridOf('acc-pln')
    expect(before.map((row) => row.date)).toContain('2026-09-10')

    await runWithLedgerBatch(() =>
      updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        id: created.id,
        patch: { bookedOn: '2026-09-20' },
      }),
    )

    const after = await gridOf('acc-pln')
    // The old day is *gone*, not merely overwritten with the same value: a survivor of a
    // delete-range is forward-filled on read as though it were a measurement.
    expect(after.map((row) => row.date)).not.toContain('2026-09-10')
    expect(after.map((row) => row.date)).toContain('2026-09-20')
    await endsAtTheCachedBalance('acc-pln')
  })

  it('rebuilds both accounts when an edit moves a transaction between them', async () => {
    const created = await spend('acc-pln', 120_00, '2026-09-10')
    await runWithLedgerBatch(() =>
      updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        id: created.id,
        patch: { accountId: 'acc-usd' },
      }),
    )

    await endsAtTheCachedBalance('acc-pln')
    await endsAtTheCachedBalance('acc-usd')
    expect((await cachedBalanceOf('acc-pln')).currentBalanceMinor).toBe(
      1_000_00,
    )
  })

  it('rebuilds through the balance-correction path, which writes a transaction', async () => {
    await runWithLedgerBatch(() =>
      adjustAccountBalance(
        scope,
        { accountId: 'acc-pln', targetMinor: 900_00, bookedOn: '2026-09-15' },
        conversion,
      ),
    )

    await endsAtTheCachedBalance('acc-pln')
    const grid = await gridOf('acc-pln')
    expect(grid.find((row) => row.date === '2026-09-15')?.nativeMinor).toBe(
      900_00,
    )
  })

  it('rebuilds one account per batch however many rows a single unit of work writes', async () => {
    await runWithLedgerBatch(async () => {
      for (const day of ['2026-09-05', '2026-09-06', '2026-09-07']) {
        await createTransaction({
          scope,
          policies: EVERYTHING,
          conversion,
          input: {
            accountId: 'acc-pln',
            direction: 'expense',
            amountMinor: 10_00,
            currencyCode: 'PLN',
            bookedOn: day,
          },
        })
      }
    })

    await endsAtTheCachedBalance('acc-pln')
    expect((await cachedBalanceOf('acc-pln')).currentBalanceMinor).toBe(970_00)
  })
})

/* -------------------------------------------------------------------------- */
/* Several accounts, and several currencies                                    */
/* -------------------------------------------------------------------------- */

describe('a workspace with several accounts', () => {
  it('rebuilds only the account that was touched and leaves the others byte-identical', async () => {
    await spend('acc-pln', 50_00, '2026-09-02')
    await spend('acc-eur', 20_00, '2026-09-03')
    await spend('acc-usd', 30_00, '2026-09-04')

    const untouched = await gridOf('acc-eur')
    await spend('acc-pln', 10_00, '2026-09-08')

    expect(await gridOf('acc-eur')).toEqual(untouched)
    for (const id of ['acc-pln', 'acc-eur', 'acc-usd']) {
      await endsAtTheCachedBalance(id)
    }
  })

  it('keeps each account in its own currency and each conversion at its own rate', async () => {
    await spend('acc-eur', 20_00, '2026-09-03')
    await spend('acc-usd', 30_00, '2026-09-04')

    const eur = await gridOf('acc-eur')
    const usd = await gridOf('acc-usd')

    expect(eur.at(-1)).toMatchObject({
      nativeMinor: 180_00,
      // 180,00 EUR × 4,30
      refMinor: 774_00,
      rateE10: EUR_RATE,
    })
    expect(usd.at(-1)).toMatchObject({
      nativeMinor: 470_00,
      // 470,00 USD × 3,95
      refMinor: 1_856_50,
      rateE10: USD_RATE,
    })
  })

  it('gives a base-currency account a rate of exactly 1 and no conversion at all', async () => {
    await spend('acc-pln', 50_00, '2026-09-02')
    const grid = await gridOf('acc-pln')
    expect(grid.every((row) => row.rateE10 === 10_000_000_000)).toBe(true)
    expect(grid.every((row) => row.refMinor === row.nativeMinor)).toBe(true)
  })

  it('revalues a foreign account day by day at that day’s rate', async () => {
    // The rate moves after the transaction. The holding does not, and the base-currency value must
    // move anyway — that is what "balance is a rebuild" means for a revalued account.
    await db
      .update(exchangeRates)
      .set({ rateE10: asRateE10(45_000_000_000) })
      .where(
        and(eq(exchangeRates.baseCode, 'EUR'), eq(exchangeRates.date, ANCHOR)),
      )

    await spend('acc-eur', 20_00, '2026-09-03')
    const grid = await gridOf('acc-eur')

    expect(grid.find((row) => row.date === '2026-09-03')).toMatchObject({
      nativeMinor: 180_00,
      refMinor: 774_00,
      rateE10: EUR_RATE,
    })
    expect(grid.at(-1)).toMatchObject({
      date: ANCHOR,
      nativeMinor: 180_00,
      refMinor: 810_00,
      rateE10: 45_000_000_000,
    })
  })
})

/* -------------------------------------------------------------------------- */
/* The properties the grid itself owes                                         */
/* -------------------------------------------------------------------------- */

describe('the stored grid', () => {
  it('is sparse: a run of unchanged days is one row, and both ends survive', async () => {
    await spend('acc-pln', 50_00, '2026-09-10')
    const grid = await gridOf('acc-pln')

    expect(grid.map((row) => row.date)).toEqual([
      // The day before the first transaction, where the opening balance lives.
      '2026-09-09',
      '2026-09-10',
      ANCHOR,
    ])
    expect(grid.map((row) => row.nativeMinor)).toEqual([
      1_000_00, 950_00, 950_00,
    ])
  })

  it('is idempotent: a second rebuild produces byte-identical rows', async () => {
    await spend('acc-pln', 50_00, '2026-09-10')
    const first = await gridOf('acc-pln')

    expect(
      await rebuildAccountBalance(db, 'acc-pln', { now: () => TODAY }),
    ).toBe('rebuilt')
    expect(await gridOf('acc-pln')).toEqual(first)
  })

  it('buckets by UTC whatever hour of the day the row was booked at', async () => {
    // 23:30 UTC on the 15th and 00:30 UTC on the 16th are different days; `booked_at` orders inside
    // a day and never dates it (`docs/MONEY.md` §6.5).
    await runWithLedgerBatch(async () => {
      await createTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        input: {
          accountId: 'acc-pln',
          direction: 'expense',
          amountMinor: 10_00,
          currencyCode: 'PLN',
          bookedOn: '2026-09-15',
          bookedAt: Date.parse('2026-09-15T23:30:00.000Z'),
        },
      })
      await createTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        input: {
          accountId: 'acc-pln',
          direction: 'expense',
          amountMinor: 20_00,
          currencyCode: 'PLN',
          bookedOn: '2026-09-16',
          bookedAt: Date.parse('2026-09-16T00:30:00.000Z'),
        },
      })
    })

    const grid = await gridOf('acc-pln')
    expect(grid.find((row) => row.date === '2026-09-15')?.nativeMinor).toBe(
      990_00,
    )
    expect(grid.find((row) => row.date === '2026-09-16')?.nativeMinor).toBe(
      970_00,
    )
  })

  it('leaves a planned row out of the grid, exactly as it is left out of the cache', async () => {
    await runWithLedgerBatch(() =>
      createTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        input: {
          accountId: 'acc-pln',
          direction: 'expense',
          amountMinor: 400_00,
          currencyCode: 'PLN',
          bookedOn: '2026-10-15',
          isPlanned: true,
        },
      }),
    )

    await endsAtTheCachedBalance('acc-pln')
    const grid = await gridOf('acc-pln')
    expect(grid.at(-1)?.date).toBe(ANCHOR)
    expect(grid.at(-1)?.nativeMinor).toBe(1_000_00)
  })

  it('replaces the whole history rather than a slice when an old day changes', async () => {
    await spend('acc-pln', 50_00, '2026-09-02')
    await spend('acc-pln', 70_00, '2026-09-20')

    const created = await spend('acc-pln', 30_00, '2026-09-10')
    await runWithLedgerBatch(() =>
      deleteTransaction({ scope, policies: EVERYTHING, id: created.id }),
    )

    const grid = await gridOf('acc-pln')
    expect(grid.map((row) => [row.date, row.nativeMinor])).toEqual([
      ['2026-09-01', 1_000_00],
      ['2026-09-02', 950_00],
      ['2026-09-20', 880_00],
      [ANCHOR, 880_00],
    ])
    await endsAtTheCachedBalance('acc-pln')
  })

  it('reports a natively-zero foreign account as zero in the base currency', async () => {
    await spend('acc-eur', 200_00, '2026-09-05')
    const grid = await gridOf('acc-eur')
    expect(grid.at(-1)).toMatchObject({ nativeMinor: 0, refMinor: 0 })
  })

  it('answers `skipped` for an account that was deleted between the touch and the rebuild', async () => {
    expect(await rebuildAccountBalance(db, 'acc-gone')).toBe('skipped')
    expect(await gridOf('acc-gone')).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* One resolution order, two implementations                                   */
/* -------------------------------------------------------------------------- */

describe('the bulk rate timeline', () => {
  it('agrees with `resolveRate` day by day, including the flat-rate rung', async () => {
    // The drift guard `ledger/rates.ts` promises. A rung added to one and not the other fails here.
    await db
      .update(organizationCurrencies)
      .set({ liveRateUpdate: false })
      .where(
        and(
          eq(organizationCurrencies.organizationId, 'org-a'),
          eq(organizationCurrencies.currencyCode, 'EUR'),
        ),
      )
    await db.insert(organizationExchangeRates).values({
      organizationId: 'org-a',
      baseCode: 'EUR',
      quoteCode: 'PLN',
      effectiveFrom: '2026-09-10',
      effectiveTo: '2026-09-20',
      rateE10: asRateE10(41_000_000_000),
      createdAt: TODAY,
      updatedAt: TODAY,
    })

    await spend('acc-eur', 10_00, '2026-09-05')
    const grid = await gridOf('acc-eur')

    for (const row of grid) {
      const expected: RateE10 | null = await resolveRate(scope, {
        base: 'EUR',
        quote: 'PLN',
        date: row.date,
      })
      expect([row.date, row.rateE10]).toEqual([row.date, expected])
    }
    // And the flat range really did win somewhere, so the assertion above is not vacuous.
    expect(grid.some((row) => row.rateE10 === 41_000_000_000)).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* Tenancy                                                                     */
/* -------------------------------------------------------------------------- */

describe('tenancy', () => {
  it('writes snapshots stamped with the organization the account belongs to', async () => {
    await spend('acc-pln', 50_00, '2026-09-10')
    const rows = await db
      .select({ organizationId: accountBalances.organizationId })
      .from(accountBalances)
      .where(eq(accountBalances.accountId, 'acc-pln'))

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.organizationId === 'org-a')).toBe(true)
  })

  it('leaves another workspace’s snapshots untouched', async () => {
    await db
      .insert(organization)
      .values({ id: 'org-b', name: 'B', slug: 'b', createdAt: TODAY })
    await db.insert(accounts).values({
      id: 'acc-b',
      organizationId: 'org-b',
      name: 'Theirs',
      currencyCode: 'PLN',
      createdAt: TODAY,
      updatedAt: TODAY,
    })
    await db.insert(accountBalances).values({
      organizationId: 'org-b',
      accountId: 'acc-b',
      date: '2026-09-01',
      nativeMinor: 7_777,
      refMinor: 7_777,
      rateE10: asRateE10(10_000_000_000),
    })

    await spend('acc-pln', 50_00, '2026-09-10')

    expect(await gridOf('acc-b')).toEqual([
      {
        date: '2026-09-01',
        nativeMinor: 7_777,
        refMinor: 7_777,
        rateE10: 10_000_000_000,
      },
    ])
  })
})
