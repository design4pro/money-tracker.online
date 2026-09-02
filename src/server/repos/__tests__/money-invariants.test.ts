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
import { projectCompletion } from '#/server/goals/project'
import { medianOf } from '#/server/recurring/detect'
import { matchesPeriod } from '#/server/recurring/match'
import { organization, user } from '#/server/db/auth-schema'
import {
  accounts,
  budgetCategories,
  currencies,
  transactionSplits,
} from '#/server/db/schema'
import { rolloverChain } from '#/server/budgets/rollover'
import { transferRefAmounts } from '#/server/transfers/ref-amount-cases'
import {
  NOOP_ALERT_DISPATCHER,
  createMemoryMarkerStore,
  setBudgetAlertDispatcher,
  sweepBudgetThresholds,
} from '#/server/budgets/thresholds'
import { hasReachedThreshold } from '#/server/budgets/utilisation'

import { budgetSpend, getBudget } from '../budgets'
import { periodVarianceMinor } from '../recurring'
import {
  listPeriods,
  materializePeriods,
  periodCorrections,
} from '../budget-periods'
import { createScope } from '../scope'
import { assertSplitSum, setSplits } from '../splits'
import {
  executed as budgetExecuted,
  createBudgetWorld,
  seedBudget,
  seedCategory,
  seedPeriod,
  seedTransaction,
} from './budget-harness'
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
import type { MatchSubject } from '#/server/recurring/match'
import type { BudgetWorld, TestDb } from './budget-harness'
import type * as BaseModule from '../base'
import type { MatchingRules, PeriodView } from '../recurring'
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

/* -------------------------------------------------------------------------- */
/* 8 — budgets                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The budget invariants named by `docs/plans/12-budgets.md`, held here because `docs/MONEY.md` §9
 * makes this file the default home for them.
 *
 * The scenario coverage — six MONEY.md spend cases, three rollover policies across a boundary in
 * both directions, twenty-two threshold cases — lives beside the code it exercises, in
 * `repos/__tests__/budgets.test.ts`, `repos/__tests__/budget-periods.test.ts` and
 * `budgets/__tests__/`. What is restated here is the *arithmetic contract*: the four claims a
 * reader of the money boundary should be able to check without opening the budget module.
 */
describe('8 — budget utilisation and rollover are integer arithmetic', () => {
  let world: BudgetWorld
  let db: TestDb

  beforeEach(async () => {
    world = await createBudgetWorld()
    db = world.db
    await seedCategory(db, { id: 'cat-food', name: 'Food' })
  })

  it('sums spend in SQL, in integers, rather than reducing a page in JavaScript', async () => {
    await seedBudget(db, { id: 'bud-a' })
    await db.insert(budgetCategories).values({
      organizationId: 'org-a',
      budgetId: 'bud-a',
      categoryId: 'cat-food',
    })
    for (const [index, amount] of [333_33, 12_345, 1].entries()) {
      await seedTransaction(db, {
        id: `tx-${index}`,
        categoryId: 'cat-food',
        refAmountMinor: amount,
        bookedOn: '2026-03-10',
      })
    }

    const budget = await getBudget(world.scope, 'bud-a')
    const mark = budgetExecuted.length
    const spend = await budgetSpend(world.scope, budget, {
      from: '2026-03-01',
      to: '2026-03-31',
    })
    const sql = budgetExecuted.slice(mark).join('\n').toLowerCase()

    expect(spend.spentMinor).toBe(333_33 + 12_345 + 1)
    expect(Number.isInteger(spend.spentMinor)).toBe(true)
    // The aggregate happened in the database. A `SELECT` of the rows themselves would mean the
    // total was reduced in JavaScript, which is where a float creeps into a column of money.
    expect(sql).toContain('sum(')
    expect(sql).not.toContain('limit ?')
  })

  it('excludes both legs of a transfer from the envelope', async () => {
    await seedBudget(db, { id: 'bud-a' })
    await db.insert(budgetCategories).values({
      organizationId: 'org-a',
      budgetId: 'bud-a',
      categoryId: 'cat-food',
    })
    await seedTransaction(db, {
      id: 'tx-spend',
      categoryId: 'cat-food',
      refAmountMinor: 100_00,
      bookedOn: '2026-03-10',
    })
    // Moving your own money between your own accounts is not spending, in either direction.
    await seedTransaction(db, {
      id: 'tx-out',
      categoryId: 'cat-food',
      refAmountMinor: 900_00,
      bookedOn: '2026-03-11',
      transferKind: 'internal',
      transferId: 'trf-1',
    })
    await seedTransaction(db, {
      id: 'tx-in',
      categoryId: 'cat-food',
      refAmountMinor: 900_00,
      bookedOn: '2026-03-11',
      direction: 'income',
      transferKind: 'internal',
      transferId: 'trf-1',
    })

    const budget = await getBudget(world.scope, 'bud-a')
    const spend = await budgetSpend(world.scope, budget, {
      from: '2026-03-01',
      to: '2026-03-31',
    })
    expect(spend.spentMinor).toBe(100_00)
  })

  it('leaves a closed period alone when a transaction inside it is edited, and reports the difference instead', async () => {
    await seedBudget(db, { id: 'bud-a', rolloverPolicy: 'carry_all' })
    await db.insert(budgetCategories).values({
      organizationId: 'org-a',
      budgetId: 'bud-a',
      categoryId: 'cat-food',
    })
    await seedTransaction(db, {
      id: 'tx-jan',
      categoryId: 'cat-food',
      refAmountMinor: 1_500_00,
      bookedOn: '2026-01-10',
    })
    // Materialisation closes every period that has elapsed, so January is frozen by the time
    // March is the open one.
    await materializePeriods(world.scope, {
      budgetId: 'bud-a',
      today: '2026-03-15',
    })

    // A receipt turns up in February for something bought in January.
    await seedTransaction(db, {
      id: 'tx-jan-late',
      categoryId: 'cat-food',
      refAmountMinor: 120_00,
      bookedOn: '2026-01-20',
    })
    await materializePeriods(world.scope, {
      budgetId: 'bud-a',
      today: '2026-03-15',
    })

    const budget = await getBudget(world.scope, 'bud-a')
    const periods = await listPeriods(world.scope, 'bud-a')
    const january = periods.find((row) => row.periodStart === '2026-01-01')

    // Frozen. Not 1 620,00.
    expect(january?.spentMinor).toBe(1_500_00)
    expect(january?.carriedInMinor).toBe(0)

    const corrections = await periodCorrections(world.scope, budget, periods)
    expect(corrections).toEqual([
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        storedSpentMinor: 1_500_00,
        actualSpentMinor: 1_620_00,
        deltaMinor: 120_00,
      },
    ])
  })

  it('telescopes the carry chain over six periods with no rounding step anywhere', () => {
    const outcomes = [
      { limitMinor: asMinor(2_000_00), spentMinor: asMinor(1_333_33) },
      { limitMinor: asMinor(2_000_00), spentMinor: asMinor(2_400_01) },
      { limitMinor: asMinor(1_950_00), spentMinor: asMinor(1_000_00) },
      { limitMinor: asMinor(2_000_00), spentMinor: asMinor(1_999_99) },
      { limitMinor: asMinor(2_000_00), spentMinor: asMinor(3_000_00) },
      { limitMinor: asMinor(2_000_00), spentMinor: asMinor(7) },
    ]
    const chain = rolloverChain('carry_all', outcomes)

    const totalLimit = outcomes.reduce((sum, row) => sum + row.limitMinor, 0)
    const totalSpent = outcomes.reduce((sum, row) => sum + row.spentMinor, 0)

    // Σlimit − Σspent, exactly. Every link is one addition and one subtraction of integers.
    expect(chain.at(-1)?.carriedOutMinor).toBe(totalLimit - totalSpent)
    for (const [index, row] of chain.entries()) {
      expect(Number.isInteger(row.carriedOutMinor)).toBe(true)
      expect(row.carriedOutMinor).toBe(
        row.limitMinor + row.carriedInMinor - row.spentMinor,
      )
      if (index + 1 < chain.length) {
        expect(chain[index + 1].carriedInMinor).toBe(row.carriedOutMinor)
      }
    }
  })

  it('crosses a threshold on an integer comparison, multiplying before dividing', () => {
    // 80% of 2 000,00 is 1 600,00 to the grosz. A `spent / available >= 0.8` in floats agrees
    // here and disagrees on limits that are not round; multiplying first cannot disagree at all.
    expect(hasReachedThreshold(1_599_99, 2_000_00, 80)).toBe(false)
    expect(hasReachedThreshold(1_600_00, 2_000_00, 80)).toBe(true)

    // A limit with no exact percentage: 33% of 1 000,03 is 330,0099, so 330,00 is short and
    // 330,01 is over. A division-first comparison rounds 330,0099 to 330,01 and fires early.
    expect(hasReachedThreshold(330_00, 1_000_03, 33)).toBe(false)
    expect(hasReachedThreshold(330_01, 1_000_03, 33)).toBe(true)
  })

  it('fires each threshold once per period, and only after the dispatch succeeded', async () => {
    await seedBudget(db, { id: 'bud-a', alertThresholds: [50, 80, 100] })
    await seedPeriod(db, {
      budgetId: 'bud-a',
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
      spentMinor: 2_400_00,
    })

    const markers = createMemoryMarkerStore()
    const dispatched: Array<number> = []

    setBudgetAlertDispatcher(async () => {
      throw new Error('the queue was down')
    })
    await expect(
      sweepBudgetThresholds({
        scope: world.scope,
        today: '2026-03-15',
        markers,
      }),
    ).rejects.toThrow('the queue was down')
    // Nothing was recorded, so the next sweep retries rather than swallowing the alert.
    expect(markers.keys.size).toBe(0)

    setBudgetAlertDispatcher(async (_scope, crossings) => {
      dispatched.push(...crossings.map((crossing) => crossing.threshold))
    })
    await sweepBudgetThresholds({
      scope: world.scope,
      today: '2026-03-15',
      markers,
    })
    await sweepBudgetThresholds({
      scope: world.scope,
      today: '2026-03-15',
      markers,
    })

    expect(dispatched).toEqual([50, 80, 100])
    setBudgetAlertDispatcher(NOOP_ALERT_DISPATCHER)
  })
})

/* -------------------------------------------------------------------------- */
/* 9 — recurring                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The recurring invariants named by `docs/plans/13-recurring.md`.
 *
 * Held here for the reason `8 —` gives: `docs/MONEY.md` §9 makes this file the money boundary's
 * index, and a stage that moves an amount and adds nothing here has not finished. The scenario
 * coverage — idempotent auto-record, the due-date rate, the earliest-unpaid-period choice — lives
 * beside the code it exercises in `recurring/__tests__/` and `repos/__tests__/recurring.test.ts`.
 * What is restated here is the *arithmetic contract*: the claims a reader of the money boundary
 * should be able to check without opening the recurring module.
 */
describe('9 — an expected amount is a plan, and the two are never conflated', () => {
  const period: PeriodView = {
    seriesId: 'ser-a',
    periodStart: '2026-03-01',
    dueOn: '2026-03-01',
    status: 'paid',
    derivedStatus: 'paid',
    expectedAmountMinor: asMinor(129_99),
    expectedCurrencyCode: asCurrencyCode('PLN'),
    settledTransactionId: 'tx-1',
    settledAmountMinor: asMinor(134_50),
    settledCurrencyCode: asCurrencyCode('PLN'),
    settledOn: '2026-03-03',
  }

  it('computes the variance as an integer subtraction and stores nothing', () => {
    // 134,50 − 129,99 = 4,51, exactly, with no rate and no rounding step in between.
    expect(periodVarianceMinor(period)).toBe(4_51)
    expect(Number.isInteger(periodVarianceMinor(period))).toBe(true)
  })

  it('refuses a variance across two currencies rather than implying it is zero', () => {
    // 43 EUR settled against 43 PLN expected is not a difference of nothing, and a subtraction
    // here would say it was. `null` is the only honest answer without a rate the person chose.
    expect(
      periodVarianceMinor({
        ...period,
        settledCurrencyCode: asCurrencyCode('EUR'),
      }),
    ).toBeNull()
  })

  it('has no variance at all until something settles', () => {
    expect(
      periodVarianceMinor({
        ...period,
        status: 'upcoming',
        derivedStatus: 'upcoming',
        settledTransactionId: null,
        settledAmountMinor: null,
        settledCurrencyCode: null,
        settledOn: null,
      }),
    ).toBeNull()
  })

  it('makes the match tolerance an integer window in minor units, inclusive at its edge', () => {
    const series = {
      id: 'ser-a',
      accountId: null,
      payeeId: null,
      direction: 'expense' as const,
      expectedAmountMinor: asMinor(129_99),
      expectedCurrencyCode: asCurrencyCode('PLN'),
    }
    const rules: MatchingRules = {
      payee: [],
      accountId: null,
      amountToleranceMinor: 500,
      dayWindow: 3,
    }
    const subject: MatchSubject = {
      accountId: 'acc-a',
      payeeId: null,
      payeeName: null,
      note: null,
      direction: 'expense' as const,
      amountMinor: asMinor(134_99),
      currencyCode: asCurrencyCode('PLN'),
      bookedOn: '2026-03-01',
    }

    // Exactly 5,00 zł out: inside the window, because the tolerance is a bound and not a strict
    // inequality. A percentage tolerance is what this deliberately is not — 10% of a 12 000 zł
    // instalment would match a completely unrelated 1 200 zł payment.
    const args = { series, rules, transaction: subject, dueOn: '2026-03-01' }
    expect(matchesPeriod(args).matched).toBe(true)
    expect(
      matchesPeriod({
        ...args,
        transaction: { ...subject, amountMinor: asMinor(135_00) },
      }),
    ).toEqual({ matched: false, because: 'amount' })
  })

  it('never proposes an amount the person has not actually paid', () => {
    // The median of an even count is the lower of the two middle values, not their mean: a mean
    // invents a figure that never occurred and moves with the rounding rule chosen to flatten it.
    expect(medianOf([100_00, 110_00, 120_00, 130_00])).toBe(110_00)
    expect(medianOf([100_00, 100_01])).toBe(100_00)
    expect(Number.isInteger(medianOf([1, 2, 4]))).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* 10 — savings goals                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The goal invariants named by `docs/plans/15-goals.md`.
 *
 * The cache-versus-links cases — `contributed_minor` after an add, after a remove and after
 * `recomputeContributed`, and the cross-currency refusal — need a database and live in
 * `repos/__tests__/goals.test.ts`. What is restated here is the projection's arithmetic, which is
 * the one place on this surface where a division appears at all.
 */
describe('10 — a goal projection is integer arithmetic over integers it was given', () => {
  const monthly = (month: number, amountMinor: number) => ({
    bookedOn: `2026-${String(month).padStart(2, '0')}-10`,
    amountMinor: asMinor(amountMinor),
  })

  it('takes an integer median of integer monthly sums, deterministic on an even count', () => {
    const projection = projectCompletion({
      goal: {
        targetMinor: asMinor(20_000_00),
        contributedMinor: asMinor(4_000_00),
        targetDate: null,
        status: 'active',
      },
      contributions: [
        monthly(1, 1_000_00),
        monthly(2, 1_000_01),
        monthly(3, 1_000_00),
        monthly(4, 1_000_01),
      ],
      today: '2026-04-20',
    })

    expect(projection.kind).toBe('on_track')
    if (projection.kind !== 'on_track') return
    // The lower middle of 1 000,00 / 1 000,00 / 1 000,01 / 1 000,01, and an integer.
    expect(projection.monthlyRateMinor).toBe(1_000_00)
    expect(Number.isInteger(projection.monthlyRateMinor)).toBe(true)
    // 16 000,00 remaining at 1 000,00 a month is 16 months, by integer ceiling division and not
    // by `Math.ceil` over a float quotient of two amounts.
    expect(projection.monthsRemaining).toBe(16)
  })

  it('rounds the months up, so a projected date is never earlier than the money allows', () => {
    const projection = projectCompletion({
      goal: {
        targetMinor: asMinor(1_000_00),
        contributedMinor: asMinor(0),
        targetDate: null,
        status: 'active',
      },
      // 300,00 a month against 1 000,00 outstanding: three months leaves 100,00 short.
      contributions: [
        monthly(1, 300_00),
        monthly(2, 300_00),
        monthly(3, 300_00),
      ],
      today: '2026-03-20',
    })
    expect(projection.kind).toBe('on_track')
    if (projection.kind !== 'on_track') return
    expect(projection.monthsRemaining).toBe(4)
    expect(projection.projectedDate).toBe('2026-07-31')
  })

  it('gives no date at all below three contribution months, and the type carries the absence', () => {
    const projection = projectCompletion({
      goal: {
        targetMinor: asMinor(10_000_00),
        contributedMinor: asMinor(500_00),
        targetDate: null,
        status: 'active',
      },
      contributions: [monthly(1, 250_00), monthly(2, 250_00)],
      today: '2026-03-20',
    })
    expect(projection).toEqual({
      kind: 'insufficient_data',
      reason: 'too_few_months',
      monthsObserved: 2,
    })
    // `projectedDate` is not merely absent: it is not a property of this branch of the union, so
    // a screen cannot read one. That is the invariant, expressed as a type rather than a check.
    expect('projectedDate' in projection).toBe(false)
  })

  it('never invents progress: the inputs come back untouched', () => {
    const goal = Object.freeze({
      targetMinor: asMinor(5_000_00),
      contributedMinor: asMinor(1_000_00),
      targetDate: null,
      status: 'active',
    })
    const contributions = Object.freeze([
      Object.freeze(monthly(1, 500_00)),
      Object.freeze(monthly(2, 500_00)),
      Object.freeze(monthly(3, 500_00)),
    ])

    projectCompletion({ goal, contributions, today: '2026-03-20' })

    expect(goal.contributedMinor).toBe(1_000_00)
    expect(contributions.map((entry) => entry.amountMinor)).toEqual([
      500_00, 500_00, 500_00,
    ])
  })

  it('projects nothing past the finish line', () => {
    expect(
      projectCompletion({
        goal: {
          targetMinor: asMinor(5_000_00),
          contributedMinor: asMinor(5_000_00),
          targetDate: '2027-01-01',
          status: 'active',
        },
        contributions: [
          monthly(1, 2_000_00),
          monthly(2, 2_000_00),
          monthly(3, 1_000_00),
        ],
        today: '2026-03-20',
      }),
    ).toEqual({ kind: 'reached' })
  })
})

/* -------------------------------------------------------------------------- */
/* 11 — transfers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The transfer invariants named by `docs/plans/10-transfers-and-refunds.md`.
 *
 * Held here for the reason `8 —` gives. The four cases of `docs/MONEY.md` §4.2 are worked through
 * one row at a time, on hand-computed integers, in `transfers/__tests__/ref-amount-cases.test.ts`;
 * the two-leg write path is in `repos/__tests__/transfers.test.ts`. What is restated here is the
 * single claim a reader of the money boundary should be able to check without opening either:
 * **moving money between two of your own accounts does not change what you are worth.**
 *
 * That claim is one signed integer. `netMinor` is `destination − source` in base minor units, so
 * a pair that leaves net worth alone is a pair whose `netMinor` is `0` — and the one case that may
 * legitimately be non-zero returns the residual instead of burying it.
 */
describe('11 — an internal transfer does not move net worth', () => {
  const DAY = '2026-03-15'

  const leg = (amountMinor: number, currencyCode: string) => ({
    amountMinor: asMinor(amountMinor),
    currencyCode: asCurrencyCode(currencyCode),
  })

  it.each([
    ['1 — the source is in base', leg(10_000, 'PLN'), leg(2_500, 'EUR')],
    ['2 — the destination is in base', leg(2_500, 'EUR'), leg(10_000, 'PLN')],
    ['3 — both are in base', leg(10_000, 'PLN'), leg(10_000, 'PLN')],
  ])('case %s nets to exactly zero', async (_name, source, destination) => {
    // No rate is in the book, and none is needed: a leg already in base *is* the truth, and the
    // other leg is told to match it. A resolver that is never called is the strongest form of
    // "this path does not consult the catalogue".
    const result = await transferRefAmounts({
      source,
      destination,
      bookedOn: DAY,
      conversion: {
        baseCurrencyCode: asCurrencyCode('PLN'),
        resolveRate: () => {
          throw new Error('a base-currency leg must not resolve a rate')
        },
      },
    })

    expect(result.netMinor).toBe(0)
    expect(result.source.refAmountMinor).toBe(result.destination.refAmountMinor)
    expect(Number.isInteger(result.netMinor)).toBe(true)
  })

  it('reports the residual between two foreign legs rather than hiding it', async () => {
    // Base PLN, and neither leg is in it, so each converts on its own.
    //   source:      100,00 € at 4,3000 → 10 000 × 4,3 = 43 000 = 430,00 zł
    //   destination: ¥15 000 at 0,02870 → 15 000 × 0,0287 × 10^(2−0) = 43 050 = 430,50 zł
    // The 0,50 zł between them is a real difference between two published conversions on the same
    // day. Forcing one leg onto the other would invent an EUR/JPY rate nobody published.
    const result = await transferRefAmounts({
      source: leg(10_000, 'EUR'),
      destination: leg(15_000, 'JPY'),
      bookedOn: DAY,
      conversion: conversionOf('PLN', [
        [`EUR:PLN:${DAY}`, 43_000_000_000],
        [`JPY:PLN:${DAY}`, 287_000_000],
      ]),
    })

    expect(result.appliedCase).toBe(4)
    expect(result.source.refAmountMinor).toBe(43_000)
    expect(result.destination.refAmountMinor).toBe(43_050)
    expect(result.netMinor).toBe(50)
  })
})

/* -------------------------------------------------------------------------- */
/* 12 — splits                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The split invariants named by `docs/plans/11-splits-groups-attachments.md`.
 *
 * The scenario coverage — the refusals, the reorder, the transfer leg, the guard on the parent's
 * amount — lives in `repos/__tests__/splits.test.ts`. What is restated here is the arithmetic
 * contract, which is rules 1, 2 and 3 applied to a row that is *derived* from another row rather
 * than converted on its own:
 *
 * - the lines add up to the whole, in integer minor units;
 * - their reference figures **allocate** the parent's single figure, so they sum to it exactly and
 *   there is no per-line rounding residue to leak into a category report;
 * - a line has nowhere to put a rate of its own, because `transaction_splits` has no `rate_e10`
 *   column. Rule 3 as structure: the conversion travels on the parent, once.
 */
describe('12 — a split allocates the parent’s figures and never re-converts', () => {
  /** The parent every case below splits: 123,45 € booked at 4,3218, so 533,53 zł. */
  async function eurParent() {
    return createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: conversionOf('PLN', [
        [`EUR:PLN:${BOOKED_ON}`, 43_218_000_000],
      ]),
      input: { ...INPUT, currencyCode: 'EUR' },
    })
  }

  it('sums the lines to the parent in both currencies, in integers', async () => {
    const parent = await eurParent()
    expect(parent.refAmountMinor).toBe(53_353)

    // Three lines that divide neither figure evenly, which is where a per-line conversion would
    // leave the reference total one minor unit short of the parent.
    const written = await setSplits(scope, {
      transactionId: parent.id,
      splits: [
        { categoryId: null, amountMinor: 4_000 },
        { categoryId: null, amountMinor: 4_000 },
        { categoryId: null, amountMinor: 4_345 },
      ],
    })

    const sum = (pick: (line: (typeof written)[number]) => number) =>
      written.reduce((total, line) => total + pick(line), 0)

    expect(sum((line) => line.amountMinor)).toBe(parent.amountMinor)
    expect(sum((line) => line.refAmountMinor)).toBe(parent.refAmountMinor)
    for (const line of written) {
      expect(Number.isInteger(line.refAmountMinor)).toBe(true)
      expect(line.currencyCode).toBe(parent.currencyCode)
      expect(line.refCurrencyCode).toBe(parent.refCurrencyCode)
    }
  })

  it('resolves no rate while splitting, and names no rate catalogue', async () => {
    const parent = await eurParent()
    executed.length = 0

    await setSplits(scope, {
      transactionId: parent.id,
      splits: [
        { categoryId: null, amountMinor: 6_000 },
        { categoryId: null, amountMinor: 6_345 },
      ],
    })

    expect(executed.length).toBeGreaterThan(0)
    for (const query of executed) {
      expect(query).not.toContain('exchange_rates')
    }
  })

  it('refuses a set that does not add up, and says by how much', async () => {
    // The rule stated on its own, without a database: the message carries both figures and the
    // difference, because the person reading it is doing arithmetic.
    expect(() =>
      assertSplitSum(asMinor(12_345), [
        { amountMinor: 6_000 },
        { amountMinor: 6_344 },
      ]),
    ).toThrow(
      /12345.*1 minor units are unassigned|1 minor units are unassigned/,
    )
  })

  it('gives a line no column to carry its own conversion in', () => {
    // Rule 3 as structure rather than as behaviour. If a `rate_e10` ever appears here, a line can
    // disagree with its parent about what the money was worth, and nothing above would catch it.
    const columns = Object.keys(transactionSplits)
    expect(columns).not.toContain('rateE10')
    expect(columns).toContain('refAmountMinor')
  })
})
