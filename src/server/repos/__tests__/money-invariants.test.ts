/**
 * The money boundary, held to the same standard as the tenant boundary.
 *
 * **Every write path that touches an amount gets a case here.** This file is seeded by the
 * transactions stage and extended by every later one; a stage that moves money and adds nothing
 * here has not finished.
 *
 * The invariants, stated once so a reader knows what is being defended:
 *
 * 1. `ref_amount_minor` is written once, at **`booked_on`'s** rate, and re-reading never recomputes
 *    it — a later change to the rate for that date leaves the stored figure alone.
 * 2. No read path recomputes a conversion. No SQL a read produces mentions `exchange_rates`.
 * 3. `rate_e10` is stored on the row, so the conversion is auditable without a rate join.
 * 4. An amount is a **positive integer** and the sign is `direction`. A negative or fractional
 *    amount cannot be created through any path.
 * 5. A row already in the base currency has `ref_amount_minor === amount_minor` and
 *    `rate_e10 === 1e10` **exactly** — no rounding drift on the identity conversion.
 * 6. Changing `booked_on` recomputes the conversion at the new date's rate. This is the one
 *    sanctioned recomputation and it is a **write**, not a read.
 * 7. No float touches the path: the arithmetic is integer end to end, rounds half to even at a
 *    single final step, and its results equal hand-computed integers — including for a zero-decimal
 *    currency (JPY) and a three-decimal one (KWD), where a hard-coded scale of 2 is wrong by a
 *    factor of a hundred and a thousand respectively.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { asCurrencyCode, asMinor, asRateE10 } from '#/lib/money'
import { organization, user } from '#/server/db/auth-schema'
import { accounts, currencies } from '#/server/db/schema'

import { createScope } from '../scope'
import {
  countTransactions,
  pageTransactions,
  sumTransactions,
} from '../transaction-queries'
import {
  computeRefAmount,
  createTransaction,
  getTransaction,
  updateTransaction,
} from '../transactions'

import type { RateE10 } from '#/lib/money'
import type * as BaseModule from '../base'
import type { TenantScope } from '../scope'
import type { ConversionContext, TransactionPolicies } from '../transactions'

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

/** A rate book keyed `from:to:date`. A miss is a miss; nothing is ever assumed. */
function conversionOf(
  base: string,
  entries: ReadonlyArray<readonly [string, number]>,
): ConversionContext {
  const rates = new Map<string, RateE10>(
    entries.map(([key, value]) => [key, asRateE10(value)]),
  )
  return {
    baseCurrencyCode: asCurrencyCode(base),
    resolveRate: async ({ base: from, quote, date }) =>
      rates.get(`${from}:${quote}:${date}`) ?? null,
  }
}

const BOOKED_ON = '2026-03-15'
const LATER = '2026-04-15'

let scope: TenantScope

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
      { code: 'JPY', name: 'Japanese yen', digits: 0, numericCode: 392 },
      { code: 'KWD', name: 'Kuwaiti dinar', digits: 3, numericCode: 414 },
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
  await db.insert(organization).values({
    id: 'org-a',
    name: 'A',
    slug: 'a',
    createdAt: now,
  })
  await db.insert(accounts).values({
    id: 'acc-a',
    organizationId: 'org-a',
    name: 'Everyday',
    currencyCode: 'PLN',
    createdAt: now,
    updatedAt: now,
  })

  scope = createScope(db, {
    userId: 'user-a',
    organizationId: 'org-a',
    role: 'owner',
  })
})

const INPUT = {
  accountId: 'acc-a',
  direction: 'expense',
  amountMinor: 12_345,
  currencyCode: 'PLN',
  bookedOn: BOOKED_ON,
} as const

/* -------------------------------------------------------------------------- */

describe('1 — ref_amount is written once, at booked_on’s rate', () => {
  it('does not move when the rate for that date later changes', async () => {
    const march = conversionOf('PLN', [
      [`EUR:PLN:${BOOKED_ON}`, 43_218_000_000],
    ])
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: march,
      input: { ...INPUT, currencyCode: 'EUR' },
    })
    expect(created.refAmountMinor).toBe(53_353)

    // The catalogue is corrected for that very day. History does not move with it.
    const corrected = conversionOf('PLN', [
      [`EUR:PLN:${BOOKED_ON}`, 99_000_000_000],
    ])
    expect(corrected.baseCurrencyCode).toBe('PLN')

    const reread = await getTransaction({
      scope,
      policies: EVERYTHING,
      id: created.id,
    })
    expect(reread.refAmountMinor).toBe(53_353)
    expect(reread.rateE10).toBe(43_218_000_000)
  })

  it('uses the booking date’s rate and not another day’s', async () => {
    const book = conversionOf('PLN', [
      [`EUR:PLN:${BOOKED_ON}`, 43_218_000_000],
      [`EUR:PLN:${LATER}`, 40_000_000_000],
    ])
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: book,
      input: { ...INPUT, currencyCode: 'EUR', bookedOn: BOOKED_ON },
    })
    expect(created.rateE10).toBe(43_218_000_000)
  })
})

describe('2 — no read recomputes a conversion', () => {
  it('never touches the rate catalogue on any read path', async () => {
    await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: conversionOf('PLN', []),
      input: INPUT,
    })
    executed.length = 0

    await pageTransactions({
      scope,
      policies: EVERYTHING,
      filters: {},
      historyFloor: null,
      sort: { field: 'bookedOn', direction: 'desc' },
      cursor: null,
    })
    await countTransactions({
      scope,
      policies: EVERYTHING,
      filters: {},
      historyFloor: null,
    })
    await sumTransactions({
      scope,
      policies: EVERYTHING,
      filters: {},
      historyFloor: null,
      baseCurrencyCode: asCurrencyCode('PLN'),
    })

    expect(executed.length).toBeGreaterThan(0)
    for (const query of executed) {
      expect(query).not.toContain('exchange_rates')
      expect(query).not.toContain('organization_exchange_rates')
    }
  })
})

describe('3 — rate_e10 travels on the row', () => {
  it('is stored, positive, and reproduces the conversion without a join', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: conversionOf('PLN', [
        [`EUR:PLN:${BOOKED_ON}`, 43_218_000_000],
      ]),
      input: { ...INPUT, currencyCode: 'EUR', amountMinor: 12_345 },
    })

    expect(created.rateE10).toBeGreaterThan(0)
    // 123.45 EUR × 4.3218 = 533.5262… → 533.53 PLN, computed from the row alone.
    const reproduced =
      (BigInt(created.amountMinor) * BigInt(created.rateE10) * 100n) /
      100_000_000_000_0n
    expect(Number(reproduced)).toBe(53_352)
    expect(created.refAmountMinor).toBe(53_353)
  })
})

describe('4 — an amount is a positive integer and the sign is direction', () => {
  const rejected = [
    -1,
    -12_345,
    0,
    12.5,
    Number.NaN,
    Number.MAX_SAFE_INTEGER + 2,
  ]

  for (const amountMinor of rejected) {
    it(`refuses ${String(amountMinor)}`, async () => {
      await expect(
        createTransaction({
          scope,
          policies: EVERYTHING,
          conversion: conversionOf('PLN', []),
          input: { ...INPUT, amountMinor },
        }),
      ).rejects.toThrow()
    })
  }

  it('stores the same magnitude for income and for expense', async () => {
    const conversion = conversionOf('PLN', [])
    const spent = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: { ...INPUT, direction: 'expense' },
    })
    const earned = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: { ...INPUT, direction: 'income' },
    })

    expect(spent.amountMinor).toBe(12_345)
    expect(earned.amountMinor).toBe(12_345)
    expect(spent.direction).toBe('expense')
    expect(earned.direction).toBe('income')
  })
})

describe('5 — the identity conversion is exact', () => {
  it('writes the amount unchanged and a rate of exactly 1e10', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: conversionOf('PLN', []),
      input: INPUT,
    })

    expect(created.refAmountMinor).toBe(created.amountMinor)
    expect(created.rateE10).toBe(10_000_000_000)
    expect(created.refCurrencyCode).toBe(created.currencyCode)
  })

  it('is exact for a zero-decimal base currency too', async () => {
    const yen = await computeRefAmount(
      {
        amountMinor: asMinor(5_000),
        currencyCode: asCurrencyCode('JPY'),
        bookedOn: BOOKED_ON,
      },
      conversionOf('JPY', []),
    )
    // ¥5000 is 5000 minor units, not 500000: the yen has no minor unit.
    expect(yen.refAmountMinor).toBe(5_000)
    expect(yen.rateE10).toBe(10_000_000_000)
  })
})

describe('6 — changing booked_on recomputes, and it is a write', () => {
  it('re-anchors to the new date’s rate', async () => {
    const book = conversionOf('PLN', [
      [`EUR:PLN:${BOOKED_ON}`, 43_218_000_000],
      [`EUR:PLN:${LATER}`, 40_000_000_000],
    ])
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: book,
      input: { ...INPUT, currencyCode: 'EUR' },
    })

    const moved = await updateTransaction({
      scope,
      policies: EVERYTHING,
      conversion: book,
      id: created.id,
      patch: { bookedOn: LATER },
    })

    expect(moved.rateE10).toBe(40_000_000_000)
    expect(moved.refAmountMinor).toBe(49_380)
  })

  it('leaves the stored figure untouched on a save that changes nothing', async () => {
    const book = conversionOf('PLN', [[`EUR:PLN:${BOOKED_ON}`, 43_218_000_000]])
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: book,
      input: { ...INPUT, currencyCode: 'EUR' },
    })

    const resolveRate = vi.fn(async () => asRateE10(1))
    const saved = await updateTransaction({
      scope,
      policies: EVERYTHING,
      conversion: { baseCurrencyCode: asCurrencyCode('PLN'), resolveRate },
      id: created.id,
      patch: {},
    })

    expect(resolveRate).not.toHaveBeenCalled()
    expect(saved.refAmountMinor).toBe(created.refAmountMinor)
    expect(saved.rateE10).toBe(created.rateE10)
  })
})

describe('7 — no float touches the path', () => {
  it('matches the worked JPY → PLN example from docs/MONEY.md §2.2', async () => {
    // ¥12 340 at 0.0263 PLN per yen is 324,54 zł. Omitting the digits term gives 3,24 zł, and
    // every same-digit test in the suite passes over that error without noticing.
    const converted = await computeRefAmount(
      {
        amountMinor: asMinor(12_340),
        currencyCode: asCurrencyCode('JPY'),
        bookedOn: BOOKED_ON,
      },
      conversionOf('PLN', [[`JPY:PLN:${BOOKED_ON}`, 263_000_000]]),
    )
    expect(converted.refAmountMinor).toBe(32_454)
  })

  it('scales into a three-decimal currency', async () => {
    // 100.00 EUR at 0.335 KWD per euro is 33.500 KWD — 33 500 minor units at three digits.
    const converted = await computeRefAmount(
      {
        amountMinor: asMinor(10_000),
        currencyCode: asCurrencyCode('EUR'),
        bookedOn: BOOKED_ON,
      },
      conversionOf('KWD', [[`EUR:KWD:${BOOKED_ON}`, 3_350_000_000]]),
    )
    expect(converted.refAmountMinor).toBe(33_500)
  })

  it('scales into a zero-decimal currency', async () => {
    // 10.00 EUR at 160.5 JPY per euro is ¥1605, with no minor unit at all.
    const converted = await computeRefAmount(
      {
        amountMinor: asMinor(1_000),
        currencyCode: asCurrencyCode('EUR'),
        bookedOn: BOOKED_ON,
      },
      conversionOf('JPY', [[`EUR:JPY:${BOOKED_ON}`, 1_605_000_000_000]]),
    )
    expect(converted.refAmountMinor).toBe(1_605)
  })

  it('rounds half to even, at one final step and no earlier', async () => {
    const quarter = conversionOf('EUR', [
      [`PLN:EUR:${BOOKED_ON}`, 2_500_000_000],
    ])
    const half = await computeRefAmount(
      {
        amountMinor: asMinor(2),
        currencyCode: asCurrencyCode('PLN'),
        bookedOn: BOOKED_ON,
      },
      quarter,
    )
    const oneAndAHalf = await computeRefAmount(
      {
        amountMinor: asMinor(6),
        currencyCode: asCurrencyCode('PLN'),
        bookedOn: BOOKED_ON,
      },
      quarter,
    )

    // 0.5 → 0 and 1.5 → 2: ties go to the even neighbour, which is what keeps a column of
    // conversions from drifting upward.
    expect(half.refAmountMinor).toBe(0)
    expect(oneAndAHalf.refAmountMinor).toBe(2)
  })

  it('round-trips a minor-unit amount through the database unchanged', async () => {
    const conversion = conversionOf('PLN', [])
    const amounts = [1, 5_000, 12_345, 99_999_999]
    for (const amountMinor of amounts) {
      const created = await createTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        input: { ...INPUT, amountMinor },
      })
      const reread = await getTransaction({
        scope,
        policies: EVERYTHING,
        id: created.id,
      })
      expect(reread.amountMinor).toBe(amountMinor)
      expect(Number.isInteger(reread.amountMinor)).toBe(true)
      expect(reread.refAmountMinor).toBe(amountMinor)
    }
  })

  it('refuses a rate that is not a positive integer rather than defaulting', async () => {
    for (const rate of [0, -1, 1.5]) {
      await expect(
        computeRefAmount(
          {
            amountMinor: asMinor(100),
            currencyCode: asCurrencyCode('EUR'),
            bookedOn: BOOKED_ON,
          },
          {
            baseCurrencyCode: asCurrencyCode('PLN'),
            resolveRate: async () => rate as RateE10,
          },
        ),
      ).rejects.toThrow()
    }
  })
})
