/**
 * The transaction write path: policies, parent authorisation, the deletion guards, and the ledger
 * batch.
 *
 * The database is a real SQLite built from `drizzle/*.sql`, not a mock. Every claim in this file is
 * about SQL that ran — a fake would happily agree that a tenant predicate is present, which is the
 * one thing worth checking.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { asCurrencyCode, asMinor, asRateE10 } from '#/lib/money'
import { organization, user } from '#/server/db/auth-schema'
import {
  accounts,
  categories,
  currencies,
  payees,
  transactions,
} from '#/server/db/schema'
import { classifyFailure } from '#/server/errors/classify'
import { buildEnvelope } from '#/server/errors/envelope'

import { touchLedgerAccount } from '../base'
import { ConflictError, NotFoundError, RateUnavailableError } from '../errors'
import { createScope } from '../scope'
import {
  applyPolicies,
  computeRefAmount,
  createTransaction,
  deleteTransaction,
  findTransaction,
  getTransaction,
  updateTransaction,
} from '../transactions'

import type { RateE10 } from '#/lib/money'
import type * as BaseModule from '../base'
import type { TenantScope } from '../scope'
import type {
  ConversionContext,
  CreateTransactionArgs,
  TransactionPolicies,
} from '../transactions'

vi.mock('../base', async (importOriginal) => {
  const actual = await importOriginal<typeof BaseModule>()
  return { ...actual, touchLedgerAccount: vi.fn() }
})

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

const MIGRATIONS = fileURLToPath(
  new URL('../../../../drizzle/', import.meta.url),
)

/** Every statement the tests caused, so a test can assert what the SQL did and did not touch. */
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
      if (trimmed.length > 0) {
        sqlite.exec(trimmed)
      }
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

const EVERYTHING: TransactionPolicies = {
  planned: 'include',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
}

/** `1 EUR = 4.3218 PLN` on the day the fixtures book against, and nothing on any other day. */
const MARCH_RATE = asRateE10(43_218_000_000)
const APRIL_RATE = asRateE10(40_000_000_000)

function conversionOf(
  rates: Map<string, RateE10>,
  base = 'PLN',
): ConversionContext {
  return {
    baseCurrencyCode: asCurrencyCode(base),
    resolveRate: async ({ base: from, quote, date }) =>
      rates.get(`${from}:${quote}:${date}`) ?? null,
  }
}

const RATES = new Map<string, RateE10>([
  ['EUR:PLN:2026-03-15', MARCH_RATE],
  ['EUR:PLN:2026-04-15', APRIL_RATE],
])

let scope: TenantScope
let otherScope: TenantScope
let conversion: ConversionContext

beforeEach(async () => {
  executed.length = 0
  const db = openTestDb()
  const now = new Date('2026-03-15T10:00:00.000Z')
  // `.onConflictDoNothing()` because `drizzle/0002_seed_currency_catalogue.sql` — which this
  // harness runs like every other migration — already holds the whole ISO-4217 catalogue. The
  // fixture stays so each test still states which currencies its rows depend on.

  await db
    .insert(currencies)
    .values([
      { code: 'PLN', name: 'Polish Zloty', digits: 2, numericCode: 985 },
      { code: 'EUR', name: 'Euro', digits: 2, numericCode: 978 },
    ])
    .onConflictDoNothing()
  await db.insert(user).values([
    {
      id: 'user-a',
      name: 'A',
      email: 'a@example.com',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'user-b',
      name: 'B',
      email: 'b@example.com',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(organization).values([
    { id: 'org-a', name: 'A', slug: 'a', createdAt: now },
    { id: 'org-b', name: 'B', slug: 'b', createdAt: now },
  ])
  await db.insert(accounts).values([
    {
      id: 'acc-a',
      organizationId: 'org-a',
      name: 'Everyday',
      currencyCode: 'PLN',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'acc-a2',
      organizationId: 'org-a',
      name: 'Savings',
      currencyCode: 'PLN',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'acc-b',
      organizationId: 'org-b',
      name: 'Theirs',
      currencyCode: 'PLN',
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(categories).values([
    {
      id: 'cat-a',
      organizationId: 'org-a',
      name: 'Food',
      slug: 'food',
      color: '#112233',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'cat-b',
      organizationId: 'org-b',
      name: 'Theirs',
      slug: 'theirs',
      color: '#112233',
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(payees).values([
    {
      id: 'pay-b',
      organizationId: 'org-b',
      name: 'Theirs',
      createdAt: now,
      updatedAt: now,
    },
  ])

  scope = createScope(db, {
    userId: 'user-a',
    organizationId: 'org-a',
    role: 'owner',
  })
  otherScope = createScope(db, {
    userId: 'user-b',
    organizationId: 'org-b',
    role: 'owner',
  })
  conversion = conversionOf(RATES)
  vi.mocked(touchLedgerAccount).mockClear()
})

const BASE_INPUT = {
  accountId: 'acc-a',
  direction: 'expense',
  amountMinor: 12_345,
  currencyCode: 'PLN',
  bookedOn: '2026-03-15',
} as const

/* -------------------------------------------------------------------------- */

describe('the policy argument', () => {
  it('cannot be omitted', () => {
    // A policy-free call does not compile. Deleting the next line must turn this file red: that,
    // and not the assertion below it, is the guarantee this case exists for.
    // @ts-expect-error — `policies` is required on every transactions call.
    const policyFree: CreateTransactionArgs = {
      scope,
      conversion,
      input: { ...BASE_INPUT },
    }
    expect(policyFree.input.accountId).toBe('acc-a')
  })

  it('cannot be partially stated', () => {
    // @ts-expect-error — a policy set missing `completeness` is not a policy set.
    const incomplete: TransactionPolicies = {
      planned: 'include',
      adjustments: 'include',
      transfers: 'include',
    }
    expect(incomplete.planned).toBe('include')
  })

  it('hides a planned row from a caller that excluded planned rows', async () => {
    const planned = await createTransaction({
      scope,
      policies: { ...EVERYTHING, planned: 'only' },
      conversion,
      input: { ...BASE_INPUT, isPlanned: true },
    })

    await expect(
      getTransaction({
        scope,
        policies: { ...EVERYTHING, planned: 'exclude' },
        id: planned.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    await expect(
      findTransaction({ scope, policies: EVERYTHING, id: planned.id }),
    ).resolves.not.toBeNull()
  })

  it('shows planned rows up to the horizon a `visibleTo` policy names', async () => {
    const soon = await createTransaction({
      scope,
      policies: { ...EVERYTHING, planned: 'only' },
      conversion,
      input: { ...BASE_INPUT, isPlanned: true, bookedOn: '2026-03-15' },
    })
    const later = await createTransaction({
      scope,
      policies: { ...EVERYTHING, planned: 'only' },
      conversion,
      input: { ...BASE_INPUT, isPlanned: true, bookedOn: '2026-04-15' },
    })
    const horizon: TransactionPolicies = {
      ...EVERYTHING,
      planned: { visibleTo: '2026-03-31' },
    }

    await expect(
      findTransaction({ scope, policies: horizon, id: soon.id }),
    ).resolves.not.toBeNull()
    await expect(
      findTransaction({ scope, policies: horizon, id: later.id }),
    ).resolves.toBeNull()
  })

  it('refuses to create a row the calling policies would hide', async () => {
    await expect(
      createTransaction({
        scope,
        policies: { ...EVERYTHING, planned: 'exclude' },
        conversion,
        input: { ...BASE_INPUT, isPlanned: true },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('parent authorisation', () => {
  it('refuses another workspace’s account with a NotFoundError', async () => {
    await expect(
      createTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        input: { ...BASE_INPUT, accountId: 'acc-b' },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses another workspace’s category and payee', async () => {
    await expect(
      createTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        input: { ...BASE_INPUT, categoryId: 'cat-b' },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      createTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        input: { ...BASE_INPUT, payeeId: 'pay-b' },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('does not reach another workspace’s row by id', async () => {
    const theirs = await createTransaction({
      scope: otherScope,
      policies: EVERYTHING,
      conversion,
      input: { ...BASE_INPUT, accountId: 'acc-b' },
    })

    await expect(
      getTransaction({ scope, policies: EVERYTHING, id: theirs.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        id: theirs.id,
        patch: { note: 'mine now' },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      deleteTransaction({ scope, policies: EVERYTHING, id: theirs.id }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const still = await findTransaction({
      scope: otherScope,
      policies: EVERYTHING,
      id: theirs.id,
    })
    expect(still?.note).toBeNull()
  })

  // `updateTransaction` and `deleteTransaction` hand `assertScopedWrite` a list that always holds
  // the id predicate, so the assertion cannot fire through the exported API: it is a backstop, and
  // it is pinned against the account repository in `tenant-isolation.test.ts` ("the write
  // backstop"). What this case pins is the precondition of that argument: an all-`include` policy
  // set contributes no predicate, so the id predicate alone scopes the statement, and the tenant
  // filter still keeps it to the caller's workspace.
  it('scopes a write by the id predicate alone under the all-`include` set, inside the workspace', async () => {
    expect(applyPolicies(EVERYTHING)).toEqual([])

    const mine = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: BASE_INPUT,
    })
    const theirs = await createTransaction({
      scope: otherScope,
      policies: EVERYTHING,
      conversion,
      input: { ...BASE_INPUT, accountId: 'acc-b' },
    })
    const theirRows = () =>
      otherScope.db
        .select()
        .from(transactions)
        .where(eq(transactions.organizationId, 'org-b'))

    const before = await theirRows()
    expect(before).toHaveLength(1)

    await updateTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      id: mine.id,
      patch: { note: 'mine' },
    })
    await expect(theirRows()).resolves.toEqual(before)

    await deleteTransaction({ scope, policies: EVERYTHING, id: mine.id })
    await expect(theirRows()).resolves.toEqual(before)
    await expect(
      findTransaction({ scope, policies: EVERYTHING, id: mine.id }),
    ).resolves.toBeNull()

    // The tenant filter stands: A's scope cannot delete B's row by its id, under the same set.
    await expect(
      deleteTransaction({ scope, policies: EVERYTHING, id: theirs.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(theirRows()).resolves.toEqual(before)
  })
})

describe('the amount', () => {
  it('rejects a negative amount: the sign lives in `direction`', async () => {
    await expect(
      createTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        input: { ...BASE_INPUT, amountMinor: -12_345 },
      }),
    ).rejects.toThrow()
  })

  it('rejects a fractional amount: minor units are integers', async () => {
    await expect(
      createTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        input: { ...BASE_INPUT, amountMinor: 12.5 },
      }),
    ).rejects.toThrow()
  })
})

describe('ref_amount', () => {
  it('is written at `booked_on`’s rate and never at today’s', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: { ...BASE_INPUT, currencyCode: 'EUR', amountMinor: 12_345 },
    })

    expect(created.refAmountMinor).toBe(53_353)
    expect(created.rateE10).toBe(43_218_000_000)
    expect(created.refCurrencyCode).toBe('PLN')
  })

  it('throws rather than defaulting when no rate exists for that day', async () => {
    await expect(
      createTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        input: {
          ...BASE_INPUT,
          currencyCode: 'EUR',
          bookedOn: '2026-03-14',
        },
      }),
    ).rejects.toBeInstanceOf(RateUnavailableError)
  })

  it('is the identity for a row already in the base currency', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: BASE_INPUT,
    })

    expect(created.refAmountMinor).toBe(created.amountMinor)
    expect(created.rateE10).toBe(10_000_000_000)
  })

  it('never asks for a rate when the row is already in the base currency', async () => {
    const resolveRate = vi.fn(async () => MARCH_RATE)
    await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: { baseCurrencyCode: asCurrencyCode('PLN'), resolveRate },
      input: BASE_INPUT,
    })
    expect(resolveRate).not.toHaveBeenCalled()
  })

  it('is not recomputed by a read', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: { ...BASE_INPUT, currencyCode: 'EUR' },
    })

    // The rate for that day changes. A read must not notice.
    const moved = conversionOf(
      new Map([['EUR:PLN:2026-03-15', asRateE10(1_000_000_000)]]),
    )
    expect(moved.baseCurrencyCode).toBe('PLN')

    const reread = await getTransaction({
      scope,
      policies: EVERYTHING,
      id: created.id,
    })
    expect(reread.refAmountMinor).toBe(created.refAmountMinor)
    expect(reread.rateE10).toBe(created.rateE10)
  })

  it('is not reachable by a read that joins the rate catalogue', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: BASE_INPUT,
    })
    executed.length = 0
    await getTransaction({ scope, policies: EVERYTHING, id: created.id })
    await findTransaction({ scope, policies: EVERYTHING, id: created.id })

    expect(executed.length).toBeGreaterThan(0)
    for (const query of executed) {
      expect(query).not.toContain('exchange_rates')
    }
  })
})

describe('updating', () => {
  it('leaves the conversion untouched when nothing that anchors it changed', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: { ...BASE_INPUT, currencyCode: 'EUR' },
    })
    const resolveRate = vi.fn(async () => APRIL_RATE)

    const updated = await updateTransaction({
      scope,
      policies: EVERYTHING,
      conversion: { baseCurrencyCode: asCurrencyCode('PLN'), resolveRate },
      id: created.id,
      patch: { note: 'renamed' },
    })

    expect(resolveRate).not.toHaveBeenCalled()
    expect(updated.refAmountMinor).toBe(created.refAmountMinor)
    expect(updated.rateE10).toBe(created.rateE10)
    expect(updated.note).toBe('renamed')
  })

  it('re-anchors the conversion when `booked_on` moves', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: { ...BASE_INPUT, currencyCode: 'EUR', amountMinor: 12_345 },
    })

    const updated = await updateTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      id: created.id,
      patch: { bookedOn: '2026-04-15' },
    })

    expect(updated.rateE10).toBe(40_000_000_000)
    expect(updated.refAmountMinor).toBe(49_380)
  })

  it('refuses another workspace’s category on a patch', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: BASE_INPUT,
    })
    await expect(
      updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        id: created.id,
        patch: { categoryId: 'cat-b' },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('deleting', () => {
  it('refuses a refund-linked row', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: BASE_INPUT,
    })
    await scope.db
      .update(transactions)
      .set({ refundLinked: true })
      .where(eq(transactions.id, created.id))

    await expect(
      deleteTransaction({ scope, policies: EVERYTHING, id: created.id }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('refuses one leg of an internal transfer', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: BASE_INPUT,
    })
    await scope.db
      .update(transactions)
      .set({ transferKind: 'internal', transferId: 'tr-1' })
      .where(eq(transactions.id, created.id))

    await expect(
      deleteTransaction({ scope, policies: EVERYTHING, id: created.id }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('removes an ordinary row', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: BASE_INPUT,
    })
    await deleteTransaction({ scope, policies: EVERYTHING, id: created.id })
    await expect(
      findTransaction({ scope, policies: EVERYTHING, id: created.id }),
    ).resolves.toBeNull()
  })
})

describe('the ledger batch', () => {
  it('touches the account a create landed on, once', async () => {
    await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: BASE_INPUT,
    })
    expect(vi.mocked(touchLedgerAccount).mock.calls).toEqual([['acc-a']])
  })

  it('touches both accounts when a row moves between them', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: BASE_INPUT,
    })
    vi.mocked(touchLedgerAccount).mockClear()

    await updateTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      id: created.id,
      patch: { accountId: 'acc-a2' },
    })

    expect(vi.mocked(touchLedgerAccount).mock.calls.flat()).toEqual([
      'acc-a',
      'acc-a2',
    ])
  })

  it('touches nothing when the write was refused', async () => {
    await expect(
      createTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        input: { ...BASE_INPUT, accountId: 'acc-b' },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(touchLedgerAccount).not.toHaveBeenCalled()
  })
})

describe('computeRefAmount', () => {
  it('rounds half to even at the single final step', async () => {
    const quarter = conversionOf(
      new Map([['PLN:EUR:2026-03-15', asRateE10(2_500_000_000)]]),
      'EUR',
    )
    const half = await computeRefAmount(
      {
        amountMinor: asMinor(2),
        currencyCode: asCurrencyCode('PLN'),
        bookedOn: '2026-03-15',
      },
      quarter,
    )
    const oneAndAHalf = await computeRefAmount(
      {
        amountMinor: asMinor(6),
        currencyCode: asCurrencyCode('PLN'),
        bookedOn: '2026-03-15',
      },
      quarter,
    )

    expect(half.refAmountMinor).toBe(0)
    expect(oneAndAHalf.refAmountMinor).toBe(2)
  })
})

/* -------------------------------------------------------------------------- */
/* The booking date                                                            */
/* -------------------------------------------------------------------------- */

/**
 * `NOW` is 10:00 UTC on the 15th, the first instant UTC+14 is on the 16th, so the latest calendar
 * day anywhere on Earth is the 16th. Only `Date` is faked: the in-memory database needs its timers.
 */
describe('the booking date', () => {
  const CUTOFF_DAY = '2026-03-16'
  const BEYOND = '2026-03-17'
  const FAR_FUTURE = '2999-01-01'

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-15T10:00:00.000Z'))
    return () => vi.useRealTimers()
  })

  async function rowCount(): Promise<number> {
    const rows = await scope.db.select().from(transactions)
    return rows.length
  }

  /** A legacy row: written when no rule looked, so it is settled and dated after the cutoff. */
  async function legacyFutureRow(): Promise<string> {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: { ...BASE_INPUT, isPlanned: true, bookedOn: FAR_FUTURE },
    })
    await scope.db
      .update(transactions)
      .set({ isPlanned: false })
      .where(eq(transactions.id, created.id))
    return created.id
  }

  it('accepts a non-planned row up to the cutoff day, so UTC+14 can book its own today', async () => {
    for (const bookedOn of ['2026-03-15', CUTOFF_DAY]) {
      const created = await createTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        input: { ...BASE_INPUT, bookedOn },
      })
      expect(created.bookedOn).toBe(bookedOn)
    }
  })

  it('refuses a non-planned row after the cutoff at bookedOn, before any lookup, writing nothing', async () => {
    for (const bookedOn of [BEYOND, FAR_FUTURE]) {
      executed.length = 0
      const failure = await createTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        input: { ...BASE_INPUT, currencyCode: 'EUR', bookedOn },
      }).catch((error: unknown) => error)

      expect(buildEnvelope(failure, classifyFailure(failure))).toMatchObject({
        kind: 'validation',
        fields: [{ path: 'bookedOn', key: 'failure.field.invalid' }],
      })
      expect(executed).toEqual([])
    }
    expect(await rowCount()).toBe(0)
  })

  it('accepts a planned row on any future date', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: conversionOf(new Map([['EUR:PLN:2999-01-01', APRIL_RATE]])),
      input: { ...BASE_INPUT, isPlanned: true, bookedOn: FAR_FUTURE },
    })

    expect(created.isPlanned).toBe(true)
    expect(created.bookedOn).toBe(FAR_FUTURE)
  })

  it('refuses a balance adjustment created through the generic path after the cutoff', async () => {
    await expect(
      createTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        input: { ...BASE_INPUT, isBalanceAdjustment: true, bookedOn: BEYOND },
      }),
    ).rejects.toBeInstanceOf(z.ZodError)
    expect(await rowCount()).toBe(0)
  })

  it('refuses an update that moves a non-planned row after the cutoff, leaving the row as it was', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: BASE_INPUT,
    })

    await expect(
      updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        id: created.id,
        patch: { bookedOn: BEYOND },
      }),
    ).rejects.toBeInstanceOf(z.ZodError)

    const after = await getTransaction({
      scope,
      policies: EVERYTHING,
      id: created.id,
    })
    expect(after.bookedOn).toBe(BASE_INPUT.bookedOn)
  })

  it('refuses a patch that flips a future-dated planned row to posted until the date changes', async () => {
    const planned = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: { ...BASE_INPUT, isPlanned: true, bookedOn: FAR_FUTURE },
    })

    await expect(
      updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        id: planned.id,
        patch: { isPlanned: false },
      }),
    ).rejects.toBeInstanceOf(z.ZodError)

    const posted = await updateTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      id: planned.id,
      patch: { isPlanned: false, bookedOn: CUTOFF_DAY },
    })
    expect(posted).toMatchObject({ isPlanned: false, bookedOn: CUTOFF_DAY })
  })

  it('accepts a planned row moved to another future date', async () => {
    const planned = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: { ...BASE_INPUT, isPlanned: true, bookedOn: FAR_FUTURE },
    })

    const moved = await updateTransaction({
      scope,
      policies: EVERYTHING,
      conversion: conversionOf(new Map([['EUR:PLN:2999-06-01', APRIL_RATE]])),
      id: planned.id,
      patch: { bookedOn: '2999-06-01' },
    })

    expect(moved.bookedOn).toBe('2999-06-01')
  })

  describe('a legacy future-dated non-planned row', () => {
    it('still takes a note-only and an amount-only edit', async () => {
      const id = await legacyFutureRow()

      const noted = await updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        id,
        patch: { note: 'renamed' },
      })
      const resized = await updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        id,
        patch: { amountMinor: 99_00 },
      })

      expect(noted.note).toBe('renamed')
      expect(resized.amountMinor).toBe(99_00)
    })

    it('still takes a save that re-sends the stored date and flag, as the detail screen does', async () => {
      const id = await legacyFutureRow()

      const saved = await updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        id,
        patch: { bookedOn: FAR_FUTURE, isPlanned: false, note: 'resent' },
      })

      expect(saved.note).toBe('resent')
    })

    it('refuses a move to a different future date', async () => {
      const id = await legacyFutureRow()

      await expect(
        updateTransaction({
          scope,
          policies: EVERYTHING,
          conversion,
          id,
          patch: { bookedOn: '2999-01-02' },
        }),
      ).rejects.toBeInstanceOf(z.ZodError)
    })

    it('takes a move back to a bookable date', async () => {
      const id = await legacyFutureRow()

      const moved = await updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        id,
        patch: { bookedOn: CUTOFF_DAY },
      })

      expect(moved.bookedOn).toBe(CUTOFF_DAY)
    })
  })
})
