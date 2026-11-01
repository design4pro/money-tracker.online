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

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  asCurrencyCode,
  asMinor,
  asRateE10,
  minorUnitDigits,
  parseMoney,
  subtractMinor,
} from '#/lib/money'
import { listEnabledCurrencies } from '#/server/catalog/currencies'
import { projectCompletion } from '#/server/goals/project'
import { runAutoRecord } from '#/server/recurring/auto-record'
import { medianOf } from '#/server/recurring/detect'
import { autoRecordMarkerKey } from '#/server/recurring/markers'
import { forecastSeries } from '#/server/recurring/forecast'
import { materializeSeries } from '#/server/recurring/materialize'
import { matchesPeriod } from '#/server/recurring/match'
import { organization, user } from '#/server/db/auth-schema'
import {
  accountBalances,
  accounts,
  budgetCategories,
  currencies,
  exchangeRates,
  loanInstalments,
  organizationCurrencies,
  transactionSplits,
  transactions,
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
import { goalReachedDedupeKey } from '#/server/notify/dedupe'
import { notify } from '#/server/notify/dispatch'
import { pageForReader } from '#/server/repos/notifications'

import { plannedScreenFor } from '#/routes/_app/transactions/-server/planned-data'
import { createLogger, createMemorySink } from '#/server/observability/logger'

import { adjustAccountBalance, updateAccount } from '../accounts'
import { touchLedgerAccount } from '../base'
import { budgetSpend, getBudget } from '../budgets'
import {
  archiveCategory,
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  moveCategory,
  reorderCategories,
  restoreCategory,
  spendingByCategory,
  updateCategory,
} from '../categories'
import { ConflictError } from '../errors'
import {
  createSeries,
  listPeriods as listSeriesPeriods,
  periodVarianceMinor,
} from '../recurring'
import {
  listPeriods,
  materializePeriods,
  periodCorrections,
} from '../budget-periods'
import {
  OverRefundError,
  RefundCurrencyError,
  linkRefund,
  listRefundsFor,
} from '../refunds'
import { createScope } from '../scope'
import { assertSplitSum, setSplits } from '../splits'
import {
  executed as budgetExecuted,
  createBudgetWorld,
  seedBudget,
  seedCategory,
  seedPeriod,
  seedSplit,
  seedTransaction,
} from './budget-harness'
import { seedSeries } from './planned-harness'
import { ledgerPageFor } from '#/server/transactions/ledger-page'
import {
  countTransactions,
  pageTransactions,
  sumTransactions,
} from '../transaction-queries'
import {
  computeRefAmount,
  createTransaction,
  findAccountCurrencyMismatches,
  getTransaction,
  updateTransaction,
} from '../transactions'
import { createLoan, listInstalments, markInstalmentPaid } from '../loans'

import type { RateE10 } from '#/lib/money'
import type { MatchSubject } from '#/server/recurring/match'
import type { BudgetWorld, TestDb } from './budget-harness'
import type { PlannedScreenInput } from '#/routes/_app/transactions/-server/planned-data'
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
  vi.mocked(touchLedgerAccount).mockClear()
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
      id: 'acc-eur',
      organizationId: 'org-a',
      name: 'Euro wallet',
      currencyCode: 'EUR',
      createdAt: now,
      updatedAt: now,
    },
  ])

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
      input: { ...INPUT, accountId: 'acc-eur', currencyCode: 'EUR' },
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
      input: {
        ...INPUT,
        accountId: 'acc-eur',
        currencyCode: 'EUR',
        bookedOn: BOOKED_ON,
      },
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
      input: {
        ...INPUT,
        accountId: 'acc-eur',
        currencyCode: 'EUR',
        amountMinor: 12_345,
      },
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
      input: { ...INPUT, accountId: 'acc-eur', currencyCode: 'EUR' },
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
      input: { ...INPUT, accountId: 'acc-eur', currencyCode: 'EUR' },
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

  it('forecasts spent, rest of year and next twelve months as integer minor units', () => {
    const forecast = forecastSeries({
      direction: 'expense',
      schedule: {
        frequency: 'monthly',
        anchorDay: 20,
        startDate: '2026-01-20',
      },
      expectedAmountMinor: 100_00,
      expectedCurrencyCode: 'PLN',
      isActive: true,
      today: '2026-06-15',
      links: [
        {
          direction: 'expense',
          bookedOn: '2026-01-20',
          amountMinor: 100_00,
          currencyCode: 'PLN',
          status: 'active',
        },
        {
          direction: 'expense',
          bookedOn: '2026-02-20',
          amountMinor: 40_00,
          currencyCode: 'EUR',
          status: 'active',
        },
        {
          // Money in is never "spent": `amount_minor` is non-negative, the direction column decides.
          direction: 'income',
          bookedOn: '2026-03-20',
          amountMinor: 25_00,
          currencyCode: 'PLN',
          status: 'active',
        },
      ],
      periods: [
        { periodStart: '2026-01-01', derivedStatus: 'paid' },
        { periodStart: '2026-02-01', derivedStatus: 'paid' },
        { periodStart: '2026-03-01', derivedStatus: 'paid' },
        { periodStart: '2026-04-01', derivedStatus: 'paid' },
        { periodStart: '2026-05-01', derivedStatus: 'paid' },
      ],
    })
    expect(forecast.spentThisYearMinor).toBe(100_00)
    expect(forecast.restOfYearMinor).toBe(700_00)
    expect(forecast.next12MonthsMinor).toBe(1_200_00)
    expect(Number.isInteger(forecast.spentThisYearMinor)).toBe(true)
    expect(Number.isInteger(forecast.restOfYearMinor)).toBe(true)
    expect(Number.isInteger(forecast.next12MonthsMinor)).toBe(true)
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
      input: { ...INPUT, accountId: 'acc-eur', currencyCode: 'EUR' },
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

/* -------------------------------------------------------------------------- */
/* 13 — refunds                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The refund invariants named by `docs/plans/10-transfers-and-refunds.md`.
 *
 * The scenario coverage — the direction refusal, the external origin, the suggestion ranking, the
 * unlink and the isolation cases — lives in `repos/__tests__/refunds.test.ts`. What is restated
 * here is the arithmetic contract, which is rules 1 and 7 applied to a figure that is **derived on
 * read** rather than stored:
 *
 * - the original's `amount_minor` and `ref_amount_minor` are what they were, because the effective
 *   amount is a subtraction and never a rewrite;
 * - that subtraction happens in the **original's own currency**, so the ceiling that bounds it is
 *   in that currency too — a refund can be larger than its original in euro while being smaller in
 *   zloty, and it is the euro that decides;
 * - two currencies are never netted at all: that would need a rate on a date nobody chose, and the
 *   answer would move every time the catalogue was corrected;
 * - and a line-level refund leaves `Σ splits = parent` exactly where section 12 left it.
 */
describe('13 — a refund is subtracted on read and never written to the original', () => {
  /** 123,45 € booked at 4,3218 — the same parent section 12 splits, so 533,53 zł. */
  const MARCH_AND_APRIL = () =>
    conversionOf('PLN', [
      [`EUR:PLN:${BOOKED_ON}`, 43_218_000_000],
      [`EUR:PLN:${LATER}`, 40_000_000_000],
    ])

  async function eurExpense() {
    return createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: MARCH_AND_APRIL(),
      input: { ...INPUT, accountId: 'acc-eur', currencyCode: 'EUR' },
    })
  }

  async function eurIncome(amountMinor: number, bookedOn: string) {
    return createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: MARCH_AND_APRIL(),
      input: {
        ...INPUT,
        accountId: 'acc-eur',
        direction: 'income',
        currencyCode: 'EUR',
        amountMinor,
        bookedOn,
      },
    })
  }

  it('leaves both of the original’s figures alone, and resolves no rate', async () => {
    const original = await eurExpense()
    expect(original.amountMinor).toBe(12_345)
    // 123,45 × 4,3218 = 533,5262…, half-even to 533,53 zł.
    expect(original.refAmountMinor).toBe(53_353)

    // 40,00 € back, at March's rate: 40,00 × 4,3218 = 172,872 → 172,87 zł. Its own figures, on its
    // own row; nothing about the original is re-converted to make room for it.
    const refund = await eurIncome(4_000, BOOKED_ON)
    expect(refund.refAmountMinor).toBe(17_287)

    executed.length = 0
    await linkRefund(scope, {
      target: 'transaction',
      refundTransactionId: refund.id,
      originalTransactionId: original.id,
    })

    const reread = await getTransaction({
      scope,
      policies: EVERYTHING,
      id: original.id,
    })
    expect(reread.amountMinor).toBe(12_345)
    expect(reread.refAmountMinor).toBe(53_353)
    expect(reread.rateE10).toBe(43_218_000_000)

    // 12 345 − 4 000 = 8 345 minor units, in euro: the effective amount is in the transaction's
    // own currency and no reference figure is netted against another.
    const summary = await listRefundsFor(scope, {
      transactionId: original.id,
    })
    expect(summary.currencyCode).toBe('EUR')
    expect(summary.refundedMinor).toBe(4_000)
    expect(summary.effectiveMinor).toBe(8_345)

    expect(executed.length).toBeGreaterThan(0)
    for (const query of executed) {
      expect(query).not.toContain('exchange_rates')
      expect(query).not.toContain('organization_exchange_rates')
    }
  })

  it('checks the ceiling in the original’s currency and not in base', async () => {
    const original = await eurExpense()
    // 124,00 € back in April, when 1 € is 4,0000 zł: 124,00 × 4 = 496,00 zł.
    const refund = await eurIncome(12_400, LATER)
    expect(refund.refAmountMinor).toBe(49_600)

    // In base this refund is *smaller* than the purchase — 496,00 zł against 533,53 zł — so a
    // ceiling checked on `ref_amount_minor` would wave it through. In the currency the money
    // actually moved in it is 12 400 against 12 345, which is 55 minor units more than was paid.
    const error = await linkRefund(scope, {
      target: 'transaction',
      refundTransactionId: refund.id,
      originalTransactionId: original.id,
    }).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(OverRefundError)
    expect((error as OverRefundError).message).toContain('55')
  })

  it('refuses to net two currencies at all, and names both', async () => {
    const original = await eurExpense()
    const refund = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: MARCH_AND_APRIL(),
      input: { ...INPUT, direction: 'income', amountMinor: 4_000 },
    })
    expect(refund.currencyCode).toBe('PLN')

    const error = await linkRefund(scope, {
      target: 'transaction',
      refundTransactionId: refund.id,
      originalTransactionId: original.id,
    }).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(RefundCurrencyError)
    expect((error as RefundCurrencyError).message).toContain('PLN')
    expect((error as RefundCurrencyError).message).toContain('EUR')
  })

  it('composes with section 12: the lines still add up to the parent', async () => {
    const parent = await eurExpense()
    const lines = await setSplits(scope, {
      transactionId: parent.id,
      splits: [
        { categoryId: null, amountMinor: 4_000 },
        { categoryId: null, amountMinor: 8_345 },
      ],
    })
    const refund = await eurIncome(1_000, BOOKED_ON)

    await linkRefund(scope, {
      target: 'split',
      refundTransactionId: refund.id,
      splitId: lines[0].id,
    })

    const reread = await getTransaction({
      scope,
      policies: EVERYTHING,
      id: parent.id,
    })
    const summary = await listRefundsFor(scope, { transactionId: parent.id })

    // 4 000 + 8 345 = 12 345, before the refund and after it: refunding a line writes to no split
    // row. 12 345 − 1 000 = 11 345 effective on the receipt.
    expect(reread.amountMinor).toBe(12_345)
    expect(summary.refundedMinor).toBe(1_000)
    expect(summary.effectiveMinor).toBe(11_345)
  })
})

/**
 * A notification is a sentence about money written at a moment, and the moment is what it is for.
 * So the row carries the figures rather than a pointer to the budget: re-reading the budget when
 * somebody opens the list would print a different sentence about a different day. What it must
 * never carry is those figures already turned into words — the household this product is built for
 * has members who do not share a locale, and a stored `"1 234,56 zł"` reads wrongly to one of them
 * forever.
 */
describe('14 — a notification stores figures, never a rendered amount', () => {
  const AT = new Date('2026-03-15T10:00:00.000Z')

  let notifyWorld: BudgetWorld

  beforeEach(async () => {
    notifyWorld = await createBudgetWorld()
  })

  it('writes payload_json holding integers and a currency code, and no formatted string', async () => {
    const payload = {
      v: 1,
      budgetId: 'budget-1',
      budgetName: 'Groceries',
      periodStart: '2026-03-01',
      threshold: 100,
      spentMinor: 205_000,
      availableMinor: 200_000,
      overspentMinor: 5_000,
      currencyCode: 'PLN',
    } as const

    const outcome = await notify(
      notifyWorld.scope,
      {
        userId: 'user-a',
        kind: 'budget.exceeded',
        payload,
        dedupeKey: 'budget:threshold:v1:budget-1:2026-03-01:100',
      },
      AT,
    )
    expect(outcome).toBe('written')

    const rows = (await pageForReader(notifyWorld.scope)).items
    expect(rows).toHaveLength(1)

    const stored = JSON.parse(rows[0].payloadJson) as Record<string, unknown>
    for (const field of [
      'spentMinor',
      'availableMinor',
      'overspentMinor',
    ] as const) {
      expect(Number.isInteger(stored[field])).toBe(true)
    }
    expect(stored.currencyCode).toBe('PLN')

    // No grouping separator, no decimal comma, no symbol anywhere in what was written.
    expect(rows[0].payloadJson).not.toMatch(/[€$£]|zł|\d[  ]\d|\d,\d/)
  })

  it('carries overspentMinor as subtractMinor computes it, a positive magnitude', () => {
    // The same arithmetic `#/server/budgets/utilisation` does, in the same units, with the helper
    // that keeps it integer. A bare `-` would pass today and be the float bug the moment somebody
    // widened one of the operands.
    const spent = asMinor(205_000)
    const available = asMinor(200_000)

    expect(subtractMinor(spent, available)).toBe(5_000)
    expect(subtractMinor(spent, available)).toBeGreaterThan(0)
    expect(Number.isInteger(subtractMinor(spent, available))).toBe(true)
  })

  it('keeps a zero-decimal currency at its own scale, never a hard-coded 2', async () => {
    // JPY has `digits: 0`, so 4 000 yen is `4000`. Writing 400000 "to be safe" would store a
    // hundred times the amount, and every reader downstream would believe it.
    await notify(
      notifyWorld.scope,
      {
        userId: 'user-a',
        kind: 'goal.reached',
        payload: {
          v: 1,
          goalId: 'goal-1',
          name: 'Kyoto',
          targetMinor: 4_000,
          contributedMinor: 4_000,
          currencyCode: 'JPY',
          transactionId: 'txn-1',
        },
        dedupeKey: goalReachedDedupeKey({ goalId: 'goal-1' }),
      },
      AT,
    )

    const rows = (await pageForReader(notifyWorld.scope)).items
    const stored = JSON.parse(rows[0].payloadJson) as Record<string, unknown>
    expect(stored.targetMinor).toBe(4_000)
    expect(stored.currencyCode).toBe('JPY')
  })
})

/* -------------------------------------------------------------------------- */
/* 15 — expectations on the planned screen                                     */
/* -------------------------------------------------------------------------- */

/**
 * The planned transactions screen shows what recurring series expect beside what the ledger holds,
 * and an expected amount is **never** an addend of the ledger's totals.
 *
 * `docs/plans/13-recurring.md` (`13-S1`) is the rule: an expected amount has no `ref_amount_minor`
 * because it has no rate and no booking date until it settles, and a plan converted at today's rate
 * and shown alone is how a person's expectations quietly change with the exchange rate. The design
 * prevents the mistake three ways - the row type has no reference field, the totals read is never
 * handed an expectation, and these cases run the real composition and compare what it returns.
 */
describe('15 — an expectation is shown beside the totals and never in them', () => {
  const TODAY = '2026-04-15'
  const POLICIES: PlannedScreenInput['policies'] = {
    planned: 'only',
    adjustments: 'exclude',
    transfers: 'include',
    completeness: 'any',
  }
  let planned: BudgetWorld

  function screen() {
    return plannedScreenFor(
      planned.scope,
      {
        policies: POLICIES,
        filters: {},
        sort: { field: 'bookedOn', direction: 'desc' },
        cursor: null,
      },
      TODAY,
      {
        readLedger: ledgerPageFor,
        logger: createLogger({ sink: createMemorySink() }),
      },
    )
  }

  beforeEach(async () => {
    planned = await createBudgetWorld()
    await seedTransaction(planned.db, {
      id: 'plan-out',
      refAmountMinor: 120_00,
      bookedOn: '2026-04-20',
      isPlanned: true,
    })
    await seedTransaction(planned.db, {
      id: 'plan-in',
      refAmountMinor: 900_00,
      bookedOn: '2026-04-21',
      direction: 'income',
      isPlanned: true,
    })
  })

  it('returns the same totals, and the same count, with and without expectations', async () => {
    const without = await screen()
    expect(without.expectations).toMatchObject({ state: 'shown', rows: [] })

    await seedSeries(planned.scope, TODAY, {
      name: 'Rent',
      expectedAmountMinor: 2_500_00,
    })
    await seedSeries(planned.scope, TODAY, {
      name: 'Salary',
      direction: 'income',
      expectedAmountMinor: 9_000_00,
      startDate: '2026-04-25',
    })
    const withExpectations = await screen()

    if (withExpectations.expectations.state !== 'shown') {
      throw new Error('the group was not shown')
    }
    expect(withExpectations.expectations.rows.length).toBeGreaterThan(0)
    expect(withExpectations.totals).toEqual(without.totals)
    expect(withExpectations.total).toBe(without.total)
    // Byte for byte, so a field that is merely deep-equal under a different key order or type
    // does not pass.
    expect(JSON.stringify(withExpectations.totals)).toBe(
      JSON.stringify(without.totals),
    )
    expect(withExpectations.totals).toMatchObject({
      incomeMinor: 900_00,
      expenseMinor: 120_00,
    })
  })

  it('keeps each currency at its own scale, unconverted, and runs no rate lookup', async () => {
    await seedSeries(planned.scope, TODAY, {
      name: 'Tokyo',
      expectedAmountMinor: 4_000,
      expectedCurrencyCode: 'JPY',
    })
    await seedSeries(planned.scope, TODAY, {
      name: 'Kuwait',
      expectedAmountMinor: 12_345,
      expectedCurrencyCode: 'KWD',
      startDate: '2026-04-11',
    })
    budgetExecuted.length = 0

    const { expectations } = await screen()

    if (expectations.state !== 'shown') {
      throw new Error('the group was not shown')
    }
    const figures = expectations.rows.map((row) => [
      row.currencyCode,
      row.expectedAmountMinor,
    ])
    // 4 000 yen is `4000` and 12,345 dinar is `12345`: neither is rescaled to two decimals.
    expect(figures).toEqual(
      expect.arrayContaining([
        ['JPY', 4_000],
        ['KWD', 12_345],
      ]),
    )
    for (const row of expectations.rows) {
      expect(Number.isInteger(row.expectedAmountMinor)).toBe(true)
    }
    for (const query of budgetExecuted) {
      expect(query).not.toMatch(/exchange_rates/i)
    }
  })

  it('leaves an expected income and an expected expense as two rows, never netted', async () => {
    await seedSeries(planned.scope, TODAY, {
      name: 'Rent',
      expectedAmountMinor: 2_500_00,
    })
    await seedSeries(planned.scope, TODAY, {
      name: 'Salary',
      direction: 'income',
      expectedAmountMinor: 9_000_00,
    })

    const { expectations } = await screen()

    if (expectations.state !== 'shown') {
      throw new Error('the group was not shown')
    }
    const directions = new Set(expectations.rows.map((row) => row.direction))
    expect(directions).toEqual(new Set(['income', 'expense']))
    for (const row of expectations.rows) {
      expect(row.expectedAmountMinor).toBeGreaterThan(0)
      expect(Object.keys(row)).not.toContain('netMinor')
    }
  })
})

/**
 * A figure is scaled by the currency's `digits`, and the catalogue is where `digits` comes from.
 * The money functions read the static table in `src/lib/money/currencies.ts`; the `currencies` row
 * in D1 is its mirror, which no arithmetic reads. So the invariant is held by this pair of facts
 * being one: the row a listing returns carries the scale the formatter and the parser use. A mirror
 * that drifted would show the yen at two decimals in a picker and store it at none.
 */
describe('16 — the catalogue’s digits is the scale the arithmetic uses', () => {
  it('lists JPY at 0, KWD at 3 and EUR at 2, each equal to the scale the money functions use', async () => {
    // Opened here, not taken from the file's `beforeEach`: its `db` is local to that callback and
    // this case needs no `scope`.
    const listed = await listEnabledCurrencies(openTestDb())
    const digitsOf = (code: string) =>
      listed.find((row) => row.code === code)?.digits

    expect(digitsOf('JPY')).toBe(0)
    expect(digitsOf('KWD')).toBe(3)
    expect(digitsOf('EUR')).toBe(2)
    for (const code of ['JPY', 'KWD', 'EUR']) {
      expect(digitsOf(code)).toBe(minorUnitDigits(code))
    }

    // 1234 yen is 1234 minor units; 1.234 dinars is 1234 fils. Neither is scaled by a literal 2.
    expect(parseMoney('en', '1234', 'JPY')).toBe(1234)
    expect(parseMoney('en', '1.234', 'KWD')).toBe(1234)
  })

  it('excludes non-currencies from the listing', async () => {
    const codes = (await listEnabledCurrencies(openTestDb())).map(
      (row) => row.code,
    )

    // A metal with `digits: 0` would silently behave like the yen.
    for (const code of ['XAU', 'XAG', 'XPT', 'XPD', 'XDR', 'XXX', 'XTS']) {
      expect(codes).not.toContain(code)
    }
  })
})

/**
 * A correction is a transaction, not a property of the account. The person states a target; the
 * system writes the difference as one ordinary row, measured on the booking date, in the
 * account's own currency, converted once at that date's rate. Nothing here writes the cached
 * balance: the ledger rebuilds it from the rows.
 */
describe('17 — a correction is a transaction, never an overwrite', () => {
  const APRIL = '2026-04-15'

  async function rows() {
    return scope.db.select().from(transactions)
  }

  it('writes exactly one balance-adjustment row and no direct write of the cached balance', async () => {
    const conversion = conversionOf('PLN', [])
    executed.length = 0

    const result = await adjustAccountBalance(
      scope,
      { accountId: 'acc-a', targetMinor: 120_00, bookedOn: BOOKED_ON },
      conversion,
    )

    expect(result).toMatchObject({ status: 'recorded', amountMinor: 120_00 })
    const written = await rows()
    expect(written).toHaveLength(1)
    expect(written[0]?.isBalanceAdjustment).toBe(true)
    expect(written[0]?.direction).toBe('income')
    // No statement set the cache column: only the ledger rebuild may, and it is not this path.
    expect(
      executed.filter((query) =>
        /update\s+"accounts"[\s\S]*current_balance_minor/i.test(query),
      ),
    ).toEqual([])
    const [account] = await scope.db.select().from(accounts)
    expect(account?.currentBalanceMinor).toBe(0)
  })

  it('measures the delta on the booking date, and later transactions still apply on top', async () => {
    const conversion = conversionOf('PLN', [])
    await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: { ...INPUT, direction: 'income', amountMinor: 100_00 },
    })
    await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: {
        ...INPUT,
        direction: 'expense',
        amountMinor: 30_00,
        bookedOn: APRIL,
      },
    })

    const result = await adjustAccountBalance(
      scope,
      { accountId: 'acc-a', targetMinor: 150_00, bookedOn: BOOKED_ON },
      conversion,
    )

    // 100,00 on the day, so the correction is 50,00 — not 150,00 − 70,00 (today's balance).
    expect(result).toMatchObject({
      status: 'recorded',
      direction: 'income',
      amountMinor: 50_00,
      balanceMinor: 100_00,
    })
    const signed = (await rows()).reduce(
      (sum, row) =>
        sum + (row.direction === 'income' ? row.amountMinor : -row.amountMinor),
      0,
    )
    // 100,00 + 50,00 − 30,00: the April expense is untouched and still counts.
    expect(signed).toBe(120_00)
  })

  it('writes no row and leaves the balance alone when the booking date is beyond the latest day on Earth', async () => {
    const conversion = conversionOf('PLN', [])
    await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: { ...INPUT, direction: 'income', amountMinor: 75_00 },
    })
    executed.length = 0

    await expect(
      adjustAccountBalance(
        scope,
        { accountId: 'acc-a', targetMinor: 500_00, bookedOn: '2999-01-01' },
        conversion,
      ),
    ).rejects.toThrow()

    // The refusal is the schema's, so not even a read ran, and the one existing row is the only row.
    expect(executed).toEqual([])
    expect(await rows()).toHaveLength(1)
  })

  it('writes nothing when the balance is already the target', async () => {
    const conversion = conversionOf('PLN', [])
    await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: { ...INPUT, direction: 'income', amountMinor: 75_00 },
    })

    const result = await adjustAccountBalance(
      scope,
      { accountId: 'acc-a', targetMinor: 75_00, bookedOn: BOOKED_ON },
      conversion,
    )

    expect(result).toEqual({ status: 'unchanged', balanceMinor: 75_00 })
    expect(await rows()).toHaveLength(1)
  })

  it('is in the account’s own currency, with the reference amount at the booking date’s rate', async () => {
    const conversion = conversionOf('PLN', [
      [`EUR:PLN:${BOOKED_ON}`, 43_218_000_000],
      [`EUR:PLN:${APRIL}`, 40_000_000_000],
    ])

    await adjustAccountBalance(
      scope,
      { accountId: 'acc-eur', targetMinor: 100_00, bookedOn: APRIL },
      conversion,
    )

    const [written] = await rows()
    expect(written?.currencyCode).toBe('EUR')
    expect(written?.amountMinor).toBe(100_00)
    // April's rate, not March's: 100,00 € at 4,0000 is 400,00 zł.
    expect(written?.rateE10).toBe(40_000_000_000)
    expect(written?.refAmountMinor).toBe(400_00)
  })
})

describe('18 — no settled row is dated after the latest calendar day on Earth', () => {
  // 10:00 UTC on the 15th is the first instant UTC+14 is on the 16th, so the cutoff day is the
  // 16th. Only `Date` is faked: the in-memory database needs its timers.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-15T10:00:00.000Z'))
    return () => vi.useRealTimers()
  })

  it('writes no row, resolves no rate and reads nothing when a create is refused', async () => {
    const conversion = conversionOf('PLN', [])
    executed.length = 0

    await expect(
      createTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        input: {
          ...INPUT,
          accountId: 'acc-eur',
          currencyCode: 'EUR',
          bookedOn: '2026-03-17',
        },
      }),
    ).rejects.toThrow()

    // The refusal is the rule's, so not even a parent lookup ran.
    expect(executed).toEqual([])
    expect(await scope.db.select().from(transactions)).toHaveLength(0)
  })

  it('leaves the stored row, its figures and its date untouched when an update is refused', async () => {
    const conversion = conversionOf('PLN', [
      [`EUR:PLN:${BOOKED_ON}`, 43_218_000_000],
    ])
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: { ...INPUT, accountId: 'acc-eur', currencyCode: 'EUR' },
    })

    await expect(
      updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion,
        id: created.id,
        patch: { bookedOn: '2999-01-01' },
      }),
    ).rejects.toThrow()

    const [stored] = await scope.db.select().from(transactions)
    expect(stored).toMatchObject({
      bookedOn: BOOKED_ON,
      refAmountMinor: created.refAmountMinor,
      rateE10: created.rateE10,
    })
  })

  describe('a legacy settled row stored with a future date', () => {
    const LEGACY_DATE = '2999-01-01'

    /** A row saved before the booking rule existed: written straight into the table. */
    async function seedLegacy(
      currencyCode: 'PLN' | 'EUR',
      amountMinor: number,
    ) {
      const at = new Date('2026-03-01T00:00:00.000Z')
      await scope.db.insert(transactions).values({
        id: 'tx-legacy',
        organizationId: 'org-a',
        accountId: currencyCode === 'EUR' ? 'acc-eur' : 'acc-a',
        direction: 'expense',
        amountMinor,
        currencyCode,
        // Stored at the rate the look-back found for the stored date, then.
        refAmountMinor: currencyCode === 'PLN' ? amountMinor : 4_000,
        refCurrencyCode: 'PLN',
        rateE10: currencyCode === 'PLN' ? 10_000_000_000 : 40_000_000_000,
        bookedOn: LEGACY_DATE,
        bookedAt: new Date(`${LEGACY_DATE}T12:00:00.000Z`),
        isPlanned: false,
        createdAt: at,
        updatedAt: at,
      })
    }

    it('keeps the identity conversion exact when the amount of a base-currency row is edited', async () => {
      await seedLegacy('PLN', 5_000)

      const updated = await updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion: conversionOf('PLN', []),
        id: 'tx-legacy',
        patch: { amountMinor: 7_000 },
      })

      expect(updated).toMatchObject({
        bookedOn: LEGACY_DATE,
        amountMinor: 7_000,
        refAmountMinor: 7_000,
        rateE10: 10_000_000_000,
      })
    })

    it('re-anchors a foreign row at the stored date’s look-back rate, not at another day’s', async () => {
      await seedLegacy('EUR', 1_000)

      const updated = await updateTransaction({
        scope,
        policies: EVERYTHING,
        // The stored date resolves to 4.3218 (the look-back's answer); today's rate is different,
        // so a re-anchor at the wrong day would show in the figure.
        conversion: conversionOf('PLN', [
          [`EUR:PLN:${LEGACY_DATE}`, 43_218_000_000],
          [`EUR:PLN:${BOOKED_ON}`, 45_000_000_000],
        ]),
        id: 'tx-legacy',
        patch: { amountMinor: 10_000 },
      })

      // 100.00 EUR at 4.3218 = 432.18 PLN, worked by hand.
      expect(updated).toMatchObject({
        bookedOn: LEGACY_DATE,
        amountMinor: 10_000,
        refAmountMinor: 43_218,
        rateE10: 43_218_000_000,
      })
    })
  })

  it('keeps a planned forecast bookable on any date, since it counts in no balance', async () => {
    const conversion = conversionOf('PLN', [])

    const planned = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion,
      input: { ...INPUT, isPlanned: true, bookedOn: '2999-01-01' },
    })

    expect(planned).toMatchObject({ isPlanned: true, bookedOn: '2999-01-01' })
  })
})

describe('19 — a transaction is in its account’s currency', () => {
  /** 1 EUR = 4.3218 PLN on the booking day: enough for every case that is allowed to convert. */
  const book = () =>
    conversionOf('PLN', [[`EUR:PLN:${BOOKED_ON}`, 43_218_000_000]])

  /** A row written straight into the table, the way a legacy one got there: EUR in a PLN account. */
  async function seedLegacyMismatch() {
    const at = new Date('2026-03-01T00:00:00.000Z')
    await scope.db.insert(transactions).values({
      id: 'tx-legacy-mismatch',
      organizationId: 'org-a',
      accountId: 'acc-a',
      direction: 'expense',
      amountMinor: 1_000,
      currencyCode: 'EUR',
      refAmountMinor: 4_322,
      refCurrencyCode: 'PLN',
      rateE10: 43_218_000_000,
      bookedOn: BOOKED_ON,
      bookedAt: new Date(`${BOOKED_ON}T12:00:00.000Z`),
      isPlanned: false,
      createdAt: at,
      updatedAt: at,
    })
    return 'tx-legacy-mismatch'
  }

  async function storedRows() {
    return scope.db.select().from(transactions).orderBy(transactions.id)
  }

  it('refuses a create whose currency is not the account’s, naming both, before any rate or write', async () => {
    const resolveRate = vi.fn(async () => asRateE10(43_218_000_000))
    executed.length = 0

    const failure = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: { baseCurrencyCode: asCurrencyCode('PLN'), resolveRate },
      input: { ...INPUT, accountId: 'acc-a', currencyCode: 'EUR' },
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ConflictError)
    expect((failure as ConflictError).message).toContain('EUR')
    expect((failure as ConflictError).message).toContain('PLN')
    // No rate was asked for, no row exists, and the ledger was not told anything moved.
    expect(resolveRate).not.toHaveBeenCalled()
    expect(executed.filter((query) => /^\s*insert/i.test(query))).toEqual([])
    expect(await storedRows()).toEqual([])
    expect(touchLedgerAccount).not.toHaveBeenCalled()
  })

  it('refuses the same mismatch whatever the policies say', async () => {
    await expect(
      createTransaction({
        scope,
        policies: {
          planned: 'exclude',
          adjustments: 'exclude',
          transfers: 'exclude',
          completeness: 'complete',
        },
        conversion: book(),
        input: { ...INPUT, accountId: 'acc-eur', currencyCode: 'PLN' },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('accepts a foreign-currency account written in its own currency, converted at booked_on’s rate', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: book(),
      input: { ...INPUT, accountId: 'acc-eur', currencyCode: 'EUR' },
    })

    expect(created).toMatchObject({
      accountId: 'acc-eur',
      currencyCode: 'EUR',
      refAmountMinor: 53_353,
      rateE10: 43_218_000_000,
    })
  })

  it('refuses an update that moves a row onto an account in another currency, and leaves the row alone', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: book(),
      input: INPUT,
    })
    const before = await storedRows()
    vi.mocked(touchLedgerAccount).mockClear()

    const failure = await updateTransaction({
      scope,
      policies: EVERYTHING,
      conversion: book(),
      id: created.id,
      patch: { accountId: 'acc-eur' },
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ConflictError)
    expect((failure as ConflictError).message).toContain('EUR')
    expect((failure as ConflictError).message).toContain('PLN')
    expect(await storedRows()).toEqual(before)
    expect(touchLedgerAccount).not.toHaveBeenCalled()
  })

  it('refuses an update that patches the currency onto an account in another currency', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: book(),
      input: INPUT,
    })
    const before = await storedRows()

    await expect(
      updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion: book(),
        id: created.id,
        patch: { currencyCode: 'EUR' },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(await storedRows()).toEqual(before)
  })

  it('refuses an update that changes the account and the currency to a pair that still disagrees', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: book(),
      input: INPUT,
    })

    await expect(
      updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion: book(),
        id: created.id,
        patch: { accountId: 'acc-eur', currencyCode: 'PLN' },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('takes an update that moves the pair to one that agrees, re-anchoring at booked_on’s rate', async () => {
    const created = await createTransaction({
      scope,
      policies: EVERYTHING,
      conversion: book(),
      input: INPUT,
    })

    const moved = await updateTransaction({
      scope,
      policies: EVERYTHING,
      conversion: book(),
      id: created.id,
      patch: { accountId: 'acc-eur', currencyCode: 'EUR' },
    })

    expect(moved).toMatchObject({
      accountId: 'acc-eur',
      currencyCode: 'EUR',
      refAmountMinor: 53_353,
      rateE10: 43_218_000_000,
    })
  })

  it('lets a legacy mismatched row take an edit that does not move it to a mismatching pair', async () => {
    const id = await seedLegacyMismatch()

    const noted = await updateTransaction({
      scope,
      policies: EVERYTHING,
      conversion: book(),
      id,
      // The detail screen re-sends the pair it already holds on every save.
      patch: { note: 'still here', accountId: 'acc-a', currencyCode: 'EUR' },
    })
    expect(noted).toMatchObject({
      note: 'still here',
      accountId: 'acc-a',
      currencyCode: 'EUR',
      refAmountMinor: 4_322,
    })

    const reamounted = await updateTransaction({
      scope,
      policies: EVERYTHING,
      conversion: book(),
      id,
      patch: { amountMinor: 2_000 },
    })
    // 20.00 EUR × 4.3218 = 86.436 → 86.44 PLN, worked by hand.
    expect(reamounted).toMatchObject({
      amountMinor: 2_000,
      refAmountMinor: 8_644,
    })
  })

  it('still refuses to move a legacy mismatched row to another mismatching account', async () => {
    const id = await seedLegacyMismatch()
    // A second PLN account: the row is EUR, so this pair differs from the stored one and disagrees.
    await scope.db.insert(accounts).values({
      id: 'acc-a2',
      organizationId: 'org-a',
      name: 'Savings',
      currencyCode: 'PLN',
      createdAt: new Date('2026-03-15T10:00:00.000Z'),
      updatedAt: new Date('2026-03-15T10:00:00.000Z'),
    })

    await expect(
      updateTransaction({
        scope,
        policies: EVERYTHING,
        conversion: book(),
        id,
        patch: { accountId: 'acc-a2' },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  describe('the detection of rows that already disagree', () => {
    it('reports nothing when every row agrees with its account', async () => {
      await createTransaction({
        scope,
        policies: EVERYTHING,
        conversion: book(),
        input: INPUT,
      })

      await expect(findAccountCurrencyMismatches(scope)).resolves.toEqual({
        count: 0,
        sample: [],
      })
    })

    it('reports a legacy row by transaction and account id only, with no amount, note or payee', async () => {
      const id = await seedLegacyMismatch()

      const report = await findAccountCurrencyMismatches(scope)

      expect(report).toEqual({
        count: 1,
        sample: [{ transactionId: id, accountId: 'acc-a' }],
      })
    })

    it('caps the sample but not the count', async () => {
      const at = new Date('2026-03-01T00:00:00.000Z')
      await scope.db.insert(transactions).values(
        ['a', 'b', 'c'].map((suffix) => ({
          id: `tx-m-${suffix}`,
          organizationId: 'org-a',
          accountId: 'acc-a',
          direction: 'expense' as const,
          amountMinor: 100,
          currencyCode: 'EUR',
          refAmountMinor: 432,
          refCurrencyCode: 'PLN',
          rateE10: 43_218_000_000,
          bookedOn: BOOKED_ON,
          bookedAt: at,
          createdAt: at,
          updatedAt: at,
        })),
      )

      const report = await findAccountCurrencyMismatches(scope, { limit: 2 })

      expect(report.count).toBe(3)
      expect(report.sample).toHaveLength(2)
    })

    it('rejects a limit outside the allowed range', async () => {
      await expect(
        findAccountCurrencyMismatches(scope, { limit: 0 }),
      ).rejects.toThrow()
      await expect(
        findAccountCurrencyMismatches(scope, { limit: 10_000 }),
      ).rejects.toThrow()
    })
  })
})

describe('20 — changing an account’s currency leaves rows the detection can see', () => {
  it('reports a row booked in the old currency after updateAccount changes the account’s currency', async () => {
    const world = await createBudgetWorld()
    const conversion = conversionOf('PLN', [
      [`EUR:PLN:${BOOKED_ON}`, 43_218_000_000],
    ])
    await createTransaction({
      scope: world.scope,
      policies: EVERYTHING,
      conversion,
      input: { ...INPUT, accountId: 'acc-a', currencyCode: 'PLN' },
    })
    await expect(
      findAccountCurrencyMismatches(world.scope),
    ).resolves.toMatchObject({ count: 0 })

    await updateAccount(
      world.scope,
      'acc-a',
      { currencyCode: 'EUR' },
      conversion,
    )

    const report = await findAccountCurrencyMismatches(world.scope)
    expect(report.count).toBe(1)
    expect(report.sample.at(0)?.accountId).toBe('acc-a')
  })
})

describe('21 — the recurring pass declines a series whose currency is not its account’s', () => {
  const TODAY = '2026-03-15'

  async function seriesFor(
    world: BudgetWorld,
    patch: { name: string; accountId: string; expectedCurrencyCode: string },
  ) {
    const series = await createSeries(world.scope, {
      expectedAmountMinor: 250_000,
      frequency: 'monthly',
      startDate: '2026-03-01',
      autoRecord: true,
      ...patch,
    })
    await materializeSeries(world.scope, {
      seriesId: series.id,
      today: TODAY,
      ahead: 0,
    })
    return series
  }

  async function worldWithEuroAccount() {
    const world = await createBudgetWorld()
    const at = new Date('2026-03-15T10:00:00.000Z')
    await world.db.insert(accounts).values({
      id: 'acc-a-eur',
      organizationId: 'org-a',
      name: 'Euro wallet',
      currencyCode: 'EUR',
      createdAt: at,
      updatedAt: at,
    })
    return world
  }

  it('names the refusal, posts nothing for it, carries on with the healthy series and stays idempotent', async () => {
    const world = await worldWithEuroAccount()
    // The bad series first, so the loop has to survive it to reach the good one.
    const bad = await seriesFor(world, {
      name: 'Euro rent',
      accountId: 'acc-a-eur',
      expectedCurrencyCode: 'PLN',
    })
    const good = await seriesFor(world, {
      name: 'Phone',
      accountId: 'acc-a',
      expectedCurrencyCode: 'PLN',
    })
    const markers = createMemoryMarkerStore()
    const refusals: Array<string> = []
    const run = () =>
      runAutoRecord({
        scope: world.scope,
        markers,
        today: TODAY,
        onRefusal: (outcome) => refusals.push(outcome.skipped ?? ''),
      })

    const first = await run()

    expect(first.posted).toBe(1)
    expect(
      first.outcomes.find((outcome) => outcome.seriesId === bad.id),
    ).toMatchObject({ skipped: 'currency-mismatch', transactionId: null })
    expect(
      first.outcomes.find((outcome) => outcome.seriesId === good.id)
        ?.transactionId,
    ).not.toBeNull()
    expect(refusals).toEqual(['currency-mismatch'])
    const written = await world.db.select().from(transactions)
    expect(written).toHaveLength(1)
    expect(written.at(0)?.accountId).toBe('acc-a')

    // Neither paid nor remembered: the period posts once the series or the account is fixed.
    const badPeriod = (await listSeriesPeriods(world.scope, bad.id, TODAY)).at(
      0,
    )
    expect(badPeriod?.derivedStatus).not.toBe('paid')
    expect(
      await markers.seen(
        autoRecordMarkerKey({
          seriesId: bad.id,
          periodStart: badPeriod?.periodStart ?? '',
        }),
      ),
    ).toBe(false)

    // A redelivery declines again, writes nothing more, and still does not throw.
    const second = await run()
    // The paid period is no longer due, so only the refusal is repeated.
    expect(second.outcomes.map((outcome) => outcome.skipped)).toEqual([
      'currency-mismatch',
    ])
    expect(await world.db.select().from(transactions)).toHaveLength(1)

    // Fix the account, and the very same period posts.
    await world.db
      .update(accounts)
      .set({ currencyCode: 'PLN' })
      .where(eq(accounts.id, 'acc-a-eur'))
    const third = await run()
    expect(third.posted).toBe(1)
    expect(await world.db.select().from(transactions)).toHaveLength(2)
  })
})

describe('22 — a category write never touches an amount', () => {
  /** The five tables a category write must not touch (amounts, balances, rates), as the SQL names them. */
  const AMOUNT_TABLES = [
    '"transactions"',
    '"transaction_splits"',
    '"accounts"',
    '"account_balances"',
    '"exchange_rates"',
  ] as const

  /** The world: a transaction and a split under categories the sequence below will move about. */
  async function worldWithAmounts() {
    const world = await createBudgetWorld()
    await seedCategory(world.db, { id: 'cat-food', name: 'Food' })
    await seedCategory(world.db, {
      id: 'cat-groceries',
      name: 'Groceries',
      parentId: 'cat-food',
    })
    await seedCategory(world.db, { id: 'cat-home', name: 'Home' })
    await seedCategory(world.db, { id: 'cat-unused', name: 'Unused' })

    await seedTransaction(world.db, {
      id: 'tx-filed',
      categoryId: 'cat-groceries',
      refAmountMinor: 123_45,
    })
    await seedTransaction(world.db, {
      id: 'tx-split',
      refAmountMinor: 200_00,
    })
    await seedSplit(world.db, {
      id: 'split-1',
      transactionId: 'tx-split',
      categoryId: 'cat-groceries',
      refAmountMinor: 120_00,
    })
    await seedSplit(world.db, {
      id: 'split-2',
      transactionId: 'tx-split',
      categoryId: 'cat-home',
      refAmountMinor: 80_00,
      position: 1,
    })
    await world.db.insert(accountBalances).values({
      organizationId: 'org-a',
      accountId: 'acc-a',
      date: '2026-03-10',
      nativeMinor: -323_45,
      refMinor: -323_45,
      rateE10: 10_000_000_000,
    })
    await world.db.insert(exchangeRates).values({
      baseCode: 'EUR',
      quoteCode: 'PLN',
      date: '2026-03-10',
      rateE10: 43_000_000_000,
      source: 'manual',
      fetchedAt: new Date('2026-03-10T00:00:00.000Z'),
    })
    return world
  }

  /** Whole rows, every column, of everything that carries an amount, a balance or a rate. */
  async function amountsOf(world: BudgetWorld) {
    return {
      transactions: await world.db
        .select()
        .from(transactions)
        .orderBy(transactions.id),
      splits: await world.db
        .select()
        .from(transactionSplits)
        .orderBy(transactionSplits.id),
      accounts: await world.db.select().from(accounts).orderBy(accounts.id),
      balances: await world.db.select().from(accountBalances),
      rates: await world.db.select().from(exchangeRates),
    }
  }

  it('runs every write export, re-parent, cascade, restore and delete included, over amounts it leaves exactly as they were', async () => {
    const world = await worldWithAmounts()
    const before = await amountsOf(world)
    const mark = budgetExecuted.length

    const created = await createCategory(world.scope, {
      name: 'Dining out',
      parentId: 'cat-food',
    })
    await updateCategory(world.scope, 'cat-food', { color: '#625106' })
    // The re-parent of a row that holds a transaction and a split.
    await moveCategory(world.scope, {
      id: 'cat-groceries',
      parentId: 'cat-home',
    })
    await reorderCategories(world.scope, ['cat-home', 'cat-food'])
    // The archive cascades to the child that was just moved in; the restore revives one row.
    await archiveCategory(world.scope, 'cat-home')
    await restoreCategory(world.scope, 'cat-home')
    await deleteCategory(world.scope, 'cat-unused')
    await deleteCategory(world.scope, created.id)
    await listCategories(world.scope, { includeArchived: true })
    await getCategory(world.scope, 'cat-food')
    await spendingByCategory(world.scope, {
      from: '2026-03-01',
      to: '2026-03-31',
    })

    const log = budgetExecuted.slice(mark)
    const writes = log.filter((query) =>
      /^\s*(update|insert|delete)\b/iu.test(query),
    )
    // A guard on the guard: the sequence did write, so an empty list is not a pass.
    expect(writes.length).toBeGreaterThanOrEqual(8)
    for (const statement of writes) {
      for (const table of AMOUNT_TABLES) expect(statement).not.toContain(table)
    }
    expect(touchLedgerAccount).not.toHaveBeenCalled()

    const after = await amountsOf(world)
    expect(after).toEqual(before)

    // The columns the plan names, stated as numbers so a regression reads as a number.
    const filed = after.transactions.find((row) => row.id === 'tx-filed')
    expect(filed).toMatchObject({
      amountMinor: 123_45,
      currencyCode: 'PLN',
      refAmountMinor: 123_45,
      refCurrencyCode: 'PLN',
      rateE10: 10_000_000_000,
      categoryId: 'cat-groceries',
    })
    expect(
      after.splits.map((row) => [
        row.id,
        row.categoryId,
        row.amountMinor,
        row.refAmountMinor,
      ]),
    ).toEqual([
      ['split-1', 'cat-groceries', 120_00, 120_00],
      ['split-2', 'cat-home', 80_00, 80_00],
    ])
    expect(after.balances).toHaveLength(1)
    expect(after.rates).toHaveLength(1)

    // And the categories did move, so the unchanged amounts are not a no-op sequence.
    expect((await getCategory(world.scope, 'cat-groceries')).parentId).toBe(
      'cat-home',
    )
    await expect(getCategory(world.scope, 'cat-unused')).rejects.toThrow()
  })
})

/* -------------------------------------------------------------------------- */
/* 23 — imported loan schedules                                                */
/* -------------------------------------------------------------------------- */

/**
 * The loan register's money contract (`00-S17` extended for imported amounts).
 *
 * The amortisation engine is a later stage. What this stage must not get wrong: every amount is
 * an integer minor unit, `ref_*` is historical, a paid instalment requires a transaction id, and
 * the imported schedule sums to exactly the amounts that were written.
 */
describe('23 — an imported loan schedule is integer amounts with paid-requires-a-transaction', () => {
  it('writes ref amounts once at identity for the workspace base and never invents a float', async () => {
    const world = await createBudgetWorld()
    const loan = await createLoan(world.scope, {
      name: 'Loan A',
      currencyCode: 'PLN',
      principalMinor: 1_000_00,
      instalmentMinor: 120_00,
      outstandingMinor: 1_000_00,
      paymentDay: 20,
      openedOn: '2026-01-15',
      instalments: [
        { dueOn: '2026-02-20', amountMinor: 120_00 },
        { dueOn: '2026-03-20', amountMinor: 110_00 },
        { dueOn: '2026-04-20', amountMinor: 90_00, isBuyout: true },
      ],
    })

    expect(loan.principalMinor).toBe(1_000_00)
    expect(loan.refPrincipalMinor).toBe(1_000_00)
    expect(loan.instalmentMinor).toBe(120_00)
    expect(loan.refInstalmentMinor).toBe(120_00)
    expect(loan.outstandingMinor).toBe(1_000_00)
    expect(loan.refOutstandingMinor).toBe(1_000_00)
    expect(loan.rateE10).toBe(10_000_000_000)
    expect(Number.isInteger(loan.instalmentMinor)).toBe(true)

    const rows = await listInstalments(world.scope, { loanId: loan.id })
    const written = [120_00, 110_00, 90_00]
    expect(rows.map((row) => row.amountMinor)).toEqual(written)
    expect(rows.map((row) => row.refAmountMinor)).toEqual(written)
    expect(rows.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(
      120_00 + 110_00 + 90_00,
    )
    expect(rows.some((row) => row.isBuyout)).toBe(true)
    expect(rows.every((row) => Number.isSafeInteger(row.amountMinor))).toBe(
      true,
    )
  })

  it('refuses to store paid without a transaction, and accepts paid only by pointing at one', async () => {
    const world = await createBudgetWorld()
    const loan = await createLoan(world.scope, {
      name: 'Loan A',
      currencyCode: 'PLN',
      instalmentMinor: 50_00,
      paymentDay: 20,
      openedOn: '2026-01-15',
      instalments: [{ dueOn: '2026-02-20', amountMinor: 50_00 }],
    })
    await seedTransaction(world.db, {
      id: 'tx-loan-a',
      refAmountMinor: 50_00,
      bookedOn: '2026-02-20',
    })

    await expect(
      world.db.insert(loanInstalments).values({
        organizationId: 'org-a',
        loanId: loan.id,
        sequence: 99,
        dueOn: '2026-12-20',
        amountMinor: 10_00,
        currencyCode: 'PLN',
        refAmountMinor: 10_00,
        rateE10: 10_000_000_000,
        status: 'paid',
        settledTransactionId: null,
        createdAt: new Date('2026-03-15T10:00:00.000Z'),
        updatedAt: new Date('2026-03-15T10:00:00.000Z'),
      }),
    ).rejects.toThrow()

    const paid = await markInstalmentPaid(world.scope, {
      loanId: loan.id,
      sequence: 1,
      transactionId: 'tx-loan-a',
    })
    expect(paid.status).toBe('paid')
    expect(paid.settledTransactionId).toBe('tx-loan-a')
    expect(paid.amountMinor).toBe(50_00)
  })

  it('keeps the digits of the currency: a yen loan is not scaled by 100', async () => {
    const world = await createBudgetWorld()
    await world.db.insert(organizationCurrencies).values({
      organizationId: 'org-a',
      currencyCode: 'JPY',
      isBase: false,
      addedAt: new Date('2026-03-15T10:00:00.000Z'),
    })
    await world.db.insert(exchangeRates).values({
      baseCode: 'JPY',
      quoteCode: 'PLN',
      date: '2026-01-15',
      rateE10: 2_500_000_000,
      source: 'manual',
      fetchedAt: new Date('2026-01-15T00:00:00.000Z'),
    })
    await world.db.insert(accounts).values({
      id: 'acc-a-jpy',
      organizationId: 'org-a',
      name: 'Yen',
      currencyCode: 'JPY',
      createdAt: new Date('2026-03-15T10:00:00.000Z'),
      updatedAt: new Date('2026-03-15T10:00:00.000Z'),
    })

    const loan = await createLoan(world.scope, {
      name: 'Loan JPY',
      accountId: 'acc-a-jpy',
      currencyCode: 'JPY',
      principalMinor: 10_000,
      instalmentMinor: 1_000,
      paymentDay: 20,
      openedOn: '2026-01-15',
      instalments: [
        { dueOn: '2026-01-15', amountMinor: 1_000 },
        { dueOn: '2026-01-20', amountMinor: 1_000 },
      ],
    })

    expect(loan.principalMinor).toBe(10_000)
    expect(loan.instalmentMinor).toBe(1_000)
    const rows = await listInstalments(world.scope, { loanId: loan.id })
    expect(rows.map((row) => row.amountMinor)).toEqual([1_000, 1_000])
    expect(rows.every((row) => Number.isInteger(row.refAmountMinor))).toBe(true)
  })

  it('contains no float arithmetic on an amount in the loans repository', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../loans.ts', import.meta.url)),
      'utf8',
    )
    expect(source).not.toMatch(/\bMath\.(pow|floor|ceil|round)\b/)
    expect(source).not.toMatch(/\/\s*\d*(?:00|100)\b/)
  })
})
