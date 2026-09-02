/**
 * Refunds, against a real SQLite database built from `drizzle/*.sql`.
 *
 * Four things are being checked and they are different in kind.
 *
 * **The four refusals** — opposite directions, one currency, the receipt's ceiling and one line's
 * ceiling. Every one of them is a rule about *two or more rows*, which is exactly the class a
 * schema cannot hold and a mock will always agree with, so they run against the real DDL including
 * the `CHECK` constraints that back them from the other side.
 *
 * **That the original is not written.** The point of the feature is a figure that is *derived*: a
 * refund reduces what a purchase ended up costing and changes nothing about what was paid. The
 * assertions read the **stored row** back after linking rather than the return value, because the
 * stored row is what every report will sum.
 *
 * **The suggestion ranking**, which is a heuristic and therefore has to be pinned exactly: the
 * order, the window boundary, and the fact that a suggestion writes nothing.
 *
 * **The tenant boundary**, in its own block below, covering all four exports — the convention
 * `categories`, `accounts`, `recurring`, `payees`, `transfers` and `splits` all follow.
 *
 * Every expected number below is hand-computed and the arithmetic is in the comment beside it. A
 * figure copied out of a run proves only that the code agrees with itself, which is a property a
 * conversion bug has too.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { beforeEach, describe, expect, it } from 'vitest'

import { organization, user } from '#/server/db/auth-schema'
import {
  accounts,
  currencies,
  payees,
  refunds,
  transactionSplits,
  transactions,
} from '#/server/db/schema'

import { ConflictError, NotFoundError } from '../errors'
import {
  OverRefundError,
  RefundCurrencyError,
  RefundDirectionError,
  linkRefund,
  listRefundsFor,
  suggestRefundTargets,
  unlinkRefund,
} from '../refunds'
import { createScope } from '../scope'
import { deleteTransaction } from '../transactions'

import type { Database, TenantScope } from '../base'
import type { TransactionPolicies } from '../transactions'

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

const MIGRATIONS = fileURLToPath(
  new URL('../../../../drizzle/', import.meta.url),
)

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
      if (trimmed.length > 0) {
        sqlite.exec(trimmed)
      }
    }
  }
  return drizzle(async (query, params, method) => {
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

/** The refund's own day. Every fixture below is dated relative to it, by hand. */
const REFUND_DAY = '2026-03-15'

/** 1 EUR = 4,3218 PLN on {@link REFUND_DAY}. Used only by the cross-currency refusal. */
const EUR_RATE_E10 = 43_218_000_000

const NOW = new Date('2026-03-15T10:00:00.000Z')

let db: Database
let scope: TenantScope
let otherScope: TenantScope

beforeEach(async () => {
  db = openTestDb()

  // `.onConflictDoNothing()` because `drizzle/0002_seed_currency_catalogue.sql` already holds the
  // whole ISO-4217 catalogue; the fixture stays so each test states which currencies it depends on.
  await db
    .insert(currencies)
    .values([
      { code: 'PLN', name: 'Polish Zloty', digits: 2, numericCode: 985 },
      { code: 'EUR', name: 'Euro', digits: 2, numericCode: 978 },
    ])
    .onConflictDoNothing()
  await db.insert(user).values(
    ['a', 'b'].map((key) => ({
      id: `user-${key}`,
      name: key,
      email: `${key}@example.com`,
      emailVerified: true,
      createdAt: NOW,
      updatedAt: NOW,
    })),
  )
  await db.insert(organization).values([
    { id: 'org-a', name: 'A', slug: 'a', createdAt: NOW },
    { id: 'org-b', name: 'B', slug: 'b', createdAt: NOW },
  ])
  await db.insert(accounts).values(
    (
      [
        ['acc-a', 'org-a', 'PLN'],
        ['acc-a-eur', 'org-a', 'EUR'],
        ['acc-b', 'org-b', 'PLN'],
      ] as const
    ).map(([id, organizationId, currencyCode]) => ({
      id,
      organizationId,
      name: id,
      currencyCode,
      createdAt: NOW,
      updatedAt: NOW,
    })),
  )
  // The same payee name in both workspaces, so a suggestion that leaked could not be excused as
  // "a different payee".
  await db.insert(payees).values([
    {
      id: 'payee-a',
      organizationId: 'org-a',
      name: 'Shop',
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'payee-b',
      organizationId: 'org-b',
      name: 'Shop',
      createdAt: NOW,
      updatedAt: NOW,
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
})

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

interface SeedTransaction {
  readonly id: string
  readonly organizationId?: string
  readonly accountId?: string
  readonly payeeId?: string | null
  readonly direction: 'income' | 'expense'
  readonly amountMinor: number
  readonly currencyCode?: 'PLN' | 'EUR'
  readonly bookedOn?: string
  readonly isPlanned?: boolean
}

/**
 * Writes a transaction directly, so the fixture states its own reference figures.
 *
 * A PLN row is its own conversion — `ref_amount_minor = amount_minor` at the identity rate, which
 * `transactions_base_currency_identity_check` requires. A EUR row is converted by hand in the one
 * test that needs one.
 */
async function seed(row: SeedTransaction): Promise<string> {
  const isEur = row.currencyCode === 'EUR'
  await db.insert(transactions).values({
    id: row.id,
    organizationId: row.organizationId ?? 'org-a',
    accountId: row.accountId ?? (isEur ? 'acc-a-eur' : 'acc-a'),
    direction: row.direction,
    amountMinor: row.amountMinor,
    currencyCode: row.currencyCode ?? 'PLN',
    // 100,00 € × 4,3218 = 432,18 zł. The one EUR fixture below is exactly 100,00 €.
    refAmountMinor: isEur ? 43_218 : row.amountMinor,
    refCurrencyCode: 'PLN',
    rateE10: isEur ? EUR_RATE_E10 : 10_000_000_000,
    bookedOn: row.bookedOn ?? REFUND_DAY,
    bookedAt: NOW,
    payeeId: row.payeeId === undefined ? 'payee-a' : row.payeeId,
    isPlanned: row.isPlanned ?? false,
    createdByUserId: null,
    createdAt: NOW,
    updatedAt: NOW,
  })
  return row.id
}

/** Two split lines on a parent, summing to it exactly — which is `11-S1`'s invariant, not this one's. */
async function seedSplits(
  transactionId: string,
  lines: ReadonlyArray<{ readonly id: string; readonly amountMinor: number }>,
): Promise<void> {
  await db.insert(transactionSplits).values(
    lines.map((line, index) => ({
      id: line.id,
      organizationId: 'org-a',
      transactionId,
      amountMinor: line.amountMinor,
      currencyCode: 'PLN',
      refAmountMinor: line.amountMinor,
      refCurrencyCode: 'PLN',
      position: index,
      createdAt: NOW,
      updatedAt: NOW,
    })),
  )
}

/** The stored transaction row, read outside every scope, which is what a report would see. */
async function storedTransaction(id: string) {
  const rows = await db
    .select({
      id: transactions.id,
      amountMinor: transactions.amountMinor,
      refAmountMinor: transactions.refAmountMinor,
      rateE10: transactions.rateE10,
      currencyCode: transactions.currencyCode,
      refundLinked: transactions.refundLinked,
    })
    .from(transactions)
    .where(eq(transactions.id, id))
  return rows[0]
}

/** Every `refunds` row in the database, regardless of workspace. */
async function allLinks() {
  return db
    .select({
      id: refunds.id,
      organizationId: refunds.organizationId,
      originalTransactionId: refunds.originalTransactionId,
      refundTransactionId: refunds.refundTransactionId,
      splitId: refunds.splitId,
      amountMinor: refunds.amountMinor,
      currencyCode: refunds.currencyCode,
    })
    .from(refunds)
}

/** The stored split rows of one parent, to prove nothing here writes to them. */
async function storedSplits(transactionId: string) {
  return db
    .select({
      id: transactionSplits.id,
      amountMinor: transactionSplits.amountMinor,
    })
    .from(transactionSplits)
    .where(eq(transactionSplits.transactionId, transactionId))
}

/* -------------------------------------------------------------------------- */

describe('linking a refund', () => {
  it('reduces the effective amount and leaves the original exactly as it was', async () => {
    // 240,00 zł paid, 90,00 zł back: 24 000 − 9 000 = 15 000 minor units effective.
    await seed({ id: 'orig', direction: 'expense', amountMinor: 24_000 })
    await seed({ id: 'back', direction: 'income', amountMinor: 9_000 })

    await linkRefund(scope, {
      target: 'transaction',
      refundTransactionId: 'back',
      originalTransactionId: 'orig',
    })

    const stored = await storedTransaction('orig')
    expect(stored.amountMinor).toBe(24_000)
    expect(stored.refAmountMinor).toBe(24_000)
    expect(stored.rateE10).toBe(10_000_000_000)

    const summary = await listRefundsFor(scope, { transactionId: 'orig' })
    expect(summary.amountMinor).toBe(24_000)
    expect(summary.refundedMinor).toBe(9_000)
    expect(summary.effectiveMinor).toBe(15_000)
    expect(summary.received).toHaveLength(1)
    expect(summary.received[0].transaction.id).toBe('back')
  })

  it('takes the link’s amount and currency from the refund transaction', async () => {
    await seed({ id: 'orig', direction: 'expense', amountMinor: 24_000 })
    await seed({ id: 'back', direction: 'income', amountMinor: 9_000 })

    const link = await linkRefund(scope, {
      target: 'transaction',
      refundTransactionId: 'back',
      originalTransactionId: 'orig',
    })

    // Not the caller's to state: `refund_transaction_id` is unique, so the refund transaction's own
    // amount *is* the amount of the link, and there is no second place for it to disagree.
    expect(link.amountMinor).toBe(9_000)
    expect(link.currencyCode).toBe('PLN')
    expect(link.originalTransactionId).toBe('orig')
    expect(link.splitId).toBeNull()
  })

  it('refuses two transactions that point the same way', async () => {
    await seed({ id: 'orig', direction: 'expense', amountMinor: 24_000 })
    await seed({ id: 'also', direction: 'expense', amountMinor: 9_000 })

    await expect(
      linkRefund(scope, {
        target: 'transaction',
        refundTransactionId: 'also',
        originalTransactionId: 'orig',
      }),
    ).rejects.toBeInstanceOf(RefundDirectionError)
    expect(await allLinks()).toHaveLength(0)
  })

  it('refuses a refund in a different currency, and names both', async () => {
    await seed({ id: 'orig', direction: 'expense', amountMinor: 24_000 })
    // 100,00 €, which is 432,18 zł at the day's rate — and irrelevant, because netting across
    // currencies would need a rate and a date the person never chose.
    await seed({
      id: 'back',
      direction: 'income',
      amountMinor: 10_000,
      currencyCode: 'EUR',
    })

    const error = await linkRefund(scope, {
      target: 'transaction',
      refundTransactionId: 'back',
      originalTransactionId: 'orig',
    }).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(RefundCurrencyError)
    expect((error as RefundCurrencyError).message).toContain('EUR')
    expect((error as RefundCurrencyError).message).toContain('PLN')
    expect(await allLinks()).toHaveLength(0)
  })

  it('refuses the refund that would give back more than was paid', async () => {
    await seed({ id: 'orig', direction: 'expense', amountMinor: 24_000 })
    await seed({ id: 'back-1', direction: 'income', amountMinor: 20_000 })
    await seed({ id: 'back-2', direction: 'income', amountMinor: 5_000 })

    await linkRefund(scope, {
      target: 'transaction',
      refundTransactionId: 'back-1',
      originalTransactionId: 'orig',
    })

    // 20 000 already back, 5 000 more, against 24 000 paid: 1 000 minor units too many.
    const error = await linkRefund(scope, {
      target: 'transaction',
      refundTransactionId: 'back-2',
      originalTransactionId: 'orig',
    }).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(OverRefundError)
    expect((error as OverRefundError).message).toContain('1000')

    const summary = await listRefundsFor(scope, { transactionId: 'orig' })
    expect(summary.refundedMinor).toBe(20_000)
    expect(summary.effectiveMinor).toBe(4_000)
  })

  it('allows refunds that come back to exactly the amount paid', async () => {
    await seed({ id: 'orig', direction: 'expense', amountMinor: 24_000 })
    await seed({ id: 'back-1', direction: 'income', amountMinor: 20_000 })
    await seed({ id: 'back-2', direction: 'income', amountMinor: 4_000 })

    for (const refundTransactionId of ['back-1', 'back-2']) {
      await linkRefund(scope, {
        target: 'transaction',
        refundTransactionId,
        originalTransactionId: 'orig',
      })
    }

    // 20 000 + 4 000 = 24 000, which is the whole purchase and not one unit more.
    const summary = await listRefundsFor(scope, { transactionId: 'orig' })
    expect(summary.refundedMinor).toBe(24_000)
    expect(summary.effectiveMinor).toBe(0)
    expect(summary.received).toHaveLength(2)
  })

  it('refuses a transaction that is already a refund of something', async () => {
    await seed({ id: 'orig-1', direction: 'expense', amountMinor: 24_000 })
    await seed({ id: 'orig-2', direction: 'expense', amountMinor: 24_000 })
    await seed({ id: 'back', direction: 'income', amountMinor: 9_000 })

    await linkRefund(scope, {
      target: 'transaction',
      refundTransactionId: 'back',
      originalTransactionId: 'orig-1',
    })

    await expect(
      linkRefund(scope, {
        target: 'transaction',
        refundTransactionId: 'back',
        originalTransactionId: 'orig-2',
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(await allLinks()).toHaveLength(1)
  })
})

describe('a refund of something outside the system', () => {
  it('is linked with no original and is netted against nothing', async () => {
    await seed({ id: 'back', direction: 'income', amountMinor: 9_000 })

    const link = await linkRefund(scope, {
      target: 'external',
      refundTransactionId: 'back',
    })
    expect(link.originalTransactionId).toBeNull()
    expect(link.splitId).toBeNull()
    expect(link.amountMinor).toBe(9_000)

    // Its own summary says what it refunds — nothing in this workspace — and its own figures are
    // untouched: it is income like any other and reduces no effective amount anywhere.
    const summary = await listRefundsFor(scope, { transactionId: 'back' })
    expect(summary.refundOf?.original).toBeNull()
    expect(summary.amountMinor).toBe(9_000)
    expect(summary.refundedMinor).toBe(0)
    expect(summary.effectiveMinor).toBe(9_000)
  })
})

describe('refunding one line of a split', () => {
  /** 240,00 zł across two lines: 100,00 zł and 140,00 zł. 10 000 + 14 000 = 24 000. */
  async function splitReceipt() {
    await seed({ id: 'orig', direction: 'expense', amountMinor: 24_000 })
    await seedSplits('orig', [
      { id: 'line-1', amountMinor: 10_000 },
      { id: 'line-2', amountMinor: 14_000 },
    ])
  }

  it('reduces the receipt and leaves the split rows alone', async () => {
    await splitReceipt()
    await seed({ id: 'back', direction: 'income', amountMinor: 9_000 })

    await linkRefund(scope, {
      target: 'split',
      refundTransactionId: 'back',
      splitId: 'line-1',
    })

    // The lines still add up to the parent — 10 000 + 14 000 = 24 000 — because nothing here
    // writes to them. That invariant is `11-S1`'s; this case asserts the two compose.
    const lines = await storedSplits('orig')
    expect(lines.map((line) => line.amountMinor).sort((a, b) => a - b)).toEqual(
      [10_000, 14_000],
    )

    // 24 000 − 9 000 = 15 000: a line-level refund still comes off the receipt.
    const summary = await listRefundsFor(scope, { transactionId: 'orig' })
    expect(summary.refundedMinor).toBe(9_000)
    expect(summary.effectiveMinor).toBe(15_000)
    expect(summary.received[0].link.splitId).toBe('line-1')
  })

  it('refuses a refund larger than the line it points at', async () => {
    await splitReceipt()
    // 120,00 zł back against a 100,00 zł line: legal against the 240,00 zł receipt, and not
    // against the line, which is why the line has its own ceiling.
    await seed({ id: 'back', direction: 'income', amountMinor: 12_000 })

    const error = await linkRefund(scope, {
      target: 'split',
      refundTransactionId: 'back',
      splitId: 'line-1',
    }).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(OverRefundError)
    expect((error as OverRefundError).limitMinor).toBe(10_000)
    expect(await allLinks()).toHaveLength(0)
  })

  it('adds up the refunds already on a line before allowing another', async () => {
    await splitReceipt()
    await seed({ id: 'back-1', direction: 'income', amountMinor: 6_000 })
    await seed({ id: 'back-2', direction: 'income', amountMinor: 5_000 })

    await linkRefund(scope, {
      target: 'split',
      refundTransactionId: 'back-1',
      splitId: 'line-1',
    })

    // 6 000 + 5 000 = 11 000 against a 10 000 line. The receipt could absorb it — 11 000 of
    // 24 000 — so only a per-line tally refuses this, which is why the tally is per line.
    const error = await linkRefund(scope, {
      target: 'split',
      refundTransactionId: 'back-2',
      splitId: 'line-1',
    }).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(OverRefundError)
    expect((error as OverRefundError).limitMinor).toBe(10_000)
    expect((error as OverRefundError).linkedMinor).toBe(6_000)
  })

  it('counts a line refund against the receipt’s own ceiling too', async () => {
    await splitReceipt()
    await seed({ id: 'back-line', direction: 'income', amountMinor: 9_000 })
    await seed({ id: 'back-whole', direction: 'income', amountMinor: 16_000 })

    await linkRefund(scope, {
      target: 'split',
      refundTransactionId: 'back-line',
      splitId: 'line-1',
    })

    // 9 000 on a line plus 16 000 on the receipt is 25 000 against 24 000 paid. Each is legal on
    // its own; together they are one minor unit past the two ceilings' common subject.
    const error = await linkRefund(scope, {
      target: 'transaction',
      refundTransactionId: 'back-whole',
      originalTransactionId: 'orig',
    }).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(OverRefundError)
    expect((error as OverRefundError).limitMinor).toBe(24_000)
  })
})

describe('unlinking a refund', () => {
  it('clears the flag that blocks deleting the two rows', async () => {
    await seed({ id: 'orig', direction: 'expense', amountMinor: 24_000 })
    await seed({ id: 'back', direction: 'income', amountMinor: 9_000 })

    const link = await linkRefund(scope, {
      target: 'transaction',
      refundTransactionId: 'back',
      originalTransactionId: 'orig',
    })

    expect((await storedTransaction('orig')).refundLinked).toBe(true)
    expect((await storedTransaction('back')).refundLinked).toBe(true)
    // `07-S1`'s refusal, which this stage owns the other half of.
    await expect(
      deleteTransaction({ scope, policies: EVERYTHING, id: 'orig' }),
    ).rejects.toBeInstanceOf(ConflictError)

    await unlinkRefund(scope, { refundId: link.id })

    expect(await allLinks()).toHaveLength(0)
    expect((await storedTransaction('orig')).refundLinked).toBe(false)
    expect((await storedTransaction('back')).refundLinked).toBe(false)
    await expect(
      deleteTransaction({ scope, policies: EVERYTHING, id: 'orig' }),
    ).resolves.toBeUndefined()
  })

  it('leaves the flag on an original that still has another refund', async () => {
    await seed({ id: 'orig', direction: 'expense', amountMinor: 24_000 })
    await seed({ id: 'back-1', direction: 'income', amountMinor: 9_000 })
    await seed({ id: 'back-2', direction: 'income', amountMinor: 5_000 })

    const first = await linkRefund(scope, {
      target: 'transaction',
      refundTransactionId: 'back-1',
      originalTransactionId: 'orig',
    })
    await linkRefund(scope, {
      target: 'transaction',
      refundTransactionId: 'back-2',
      originalTransactionId: 'orig',
    })

    await unlinkRefund(scope, { refundId: first.id })

    // The flag is recomputed from the rows that are actually there, never cleared on faith.
    expect((await storedTransaction('orig')).refundLinked).toBe(true)
    expect((await storedTransaction('back-1')).refundLinked).toBe(false)

    // 24 000 − 5 000 = 19 000 once the first refund is gone.
    const summary = await listRefundsFor(scope, { transactionId: 'orig' })
    expect(summary.refundedMinor).toBe(5_000)
    expect(summary.effectiveMinor).toBe(19_000)
  })

  it('reports a refund id that is not there as not found', async () => {
    await expect(
      unlinkRefund(scope, { refundId: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('suggesting what a refund refunds', () => {
  /**
   * One 90,00 zł refund on 15 March, and three candidates at the same payee.
   *
   * The dates are counted by hand from 15 March: the 12th is 3 days earlier, the 14th is 1, and
   * the 5th is 10.
   */
  async function world() {
    await seed({ id: 'back', direction: 'income', amountMinor: 9_000 })
    await seed({
      id: 'exact',
      direction: 'expense',
      amountMinor: 9_000,
      bookedOn: '2026-03-12',
    })
    await seed({
      id: 'near',
      direction: 'expense',
      amountMinor: 9_500,
      bookedOn: '2026-03-14',
    })
    await seed({
      id: 'far',
      direction: 'expense',
      amountMinor: 12_000,
      bookedOn: '2026-03-05',
    })
  }

  it('ranks by closeness of amount, then of date', async () => {
    await world()

    const targets = await suggestRefundTargets(scope, {
      refundTransactionId: 'back',
    })

    // Surpluses: 9 000 − 9 000 = 0, 9 500 − 9 000 = 500, 12 000 − 9 000 = 3 000. The 14th is the
    // closest date and is second anyway, which is the whole point of "amount first".
    expect(targets.map((target) => target.transaction.id)).toEqual([
      'exact',
      'near',
      'far',
    ])
    expect(targets.map((target) => target.surplusMinor)).toEqual([
      0, 500, 3_000,
    ])
  })

  it('counts whole calendar days, and counts them from the refund backwards', async () => {
    await world()

    const targets = await suggestRefundTargets(scope, {
      refundTransactionId: 'back',
    })
    const daysById = new Map(
      targets.map((target) => [target.transaction.id, target.daysApart]),
    )

    // 15 − 12 = 3, 15 − 14 = 1, 15 − 5 = 10. Pinned because the sentence the dialog builds says
    // "booked 3 days earlier", and a unit that silently became milliseconds would still sort.
    expect(daysById.get('exact')).toBe(3)
    expect(daysById.get('near')).toBe(1)
    expect(daysById.get('far')).toBe(10)
  })

  it('reaches exactly 90 days back and no further', async () => {
    await seed({ id: 'back', direction: 'income', amountMinor: 9_000 })
    // 15 Dec 2025 → 15 Mar 2026 is 31 + 31 + 28 = 90 days (2026 is not a leap year). The 14th is
    // 91 and is out.
    await seed({
      id: 'inside',
      direction: 'expense',
      amountMinor: 9_000,
      bookedOn: '2025-12-15',
    })
    await seed({
      id: 'outside',
      direction: 'expense',
      amountMinor: 9_000,
      bookedOn: '2025-12-14',
    })

    const targets = await suggestRefundTargets(scope, {
      refundTransactionId: 'back',
    })
    expect(targets.map((target) => target.transaction.id)).toEqual(['inside'])
    expect(targets[0].daysApart).toBe(90)
  })

  it('offers nothing it would then refuse', async () => {
    await seed({ id: 'back', direction: 'income', amountMinor: 9_000 })
    // Smaller than the refund.
    await seed({ id: 'too-small', direction: 'expense', amountMinor: 8_999 })
    // Another payee.
    await seed({
      id: 'other-payee',
      direction: 'expense',
      amountMinor: 24_000,
      payeeId: null,
    })
    // Another currency: the link would be refused, so the suggestion would be a trap.
    await seed({
      id: 'other-currency',
      direction: 'expense',
      amountMinor: 24_000,
      currencyCode: 'EUR',
    })
    // The same direction as the refund.
    await seed({ id: 'same-way', direction: 'income', amountMinor: 24_000 })
    // A future entry that has not happened.
    await seed({
      id: 'planned',
      direction: 'expense',
      amountMinor: 24_000,
      isPlanned: true,
    })
    // Large enough, and already refunded down to 6 000, which cannot absorb 9 000.
    await seed({ id: 'used-up', direction: 'expense', amountMinor: 10_000 })
    await seed({ id: 'earlier-back', direction: 'income', amountMinor: 4_000 })
    await linkRefund(scope, {
      target: 'transaction',
      refundTransactionId: 'earlier-back',
      originalTransactionId: 'used-up',
    })

    const targets = await suggestRefundTargets(scope, {
      refundTransactionId: 'back',
    })
    expect(targets).toEqual([])
  })

  it('suggests nothing for a refund with no payee', async () => {
    await seed({
      id: 'back',
      direction: 'income',
      amountMinor: 9_000,
      payeeId: null,
    })
    await seed({ id: 'orig', direction: 'expense', amountMinor: 24_000 })

    expect(
      await suggestRefundTargets(scope, { refundTransactionId: 'back' }),
    ).toEqual([])
  })

  it('suggests and never links', async () => {
    await world()
    await suggestRefundTargets(scope, { refundTransactionId: 'back' })
    expect(await allLinks()).toHaveLength(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Tenant isolation                                                            */
/* -------------------------------------------------------------------------- */

describe('tenant isolation', () => {
  /** A purchase, its refund and a split line, all inside workspace B. */
  async function othersWorld() {
    await seed({
      id: 'b-orig',
      organizationId: 'org-b',
      accountId: 'acc-b',
      payeeId: 'payee-b',
      direction: 'expense',
      amountMinor: 24_000,
    })
    await seed({
      id: 'b-back',
      organizationId: 'org-b',
      accountId: 'acc-b',
      payeeId: 'payee-b',
      direction: 'income',
      amountMinor: 9_000,
    })
    await db.insert(transactionSplits).values({
      id: 'b-line',
      organizationId: 'org-b',
      transactionId: 'b-orig',
      amountMinor: 24_000,
      currencyCode: 'PLN',
      refAmountMinor: 24_000,
      refCurrencyCode: 'PLN',
      position: 0,
      createdAt: NOW,
      updatedAt: NOW,
    })
  }

  it('refuses A a link aimed at B’s original', async () => {
    await othersWorld()
    await seed({ id: 'a-back', direction: 'income', amountMinor: 9_000 })

    await expect(
      linkRefund(scope, {
        target: 'transaction',
        refundTransactionId: 'a-back',
        originalTransactionId: 'b-orig',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(await allLinks()).toHaveLength(0)
    expect((await storedTransaction('b-orig')).refundLinked).toBe(false)
  })

  it('refuses A a link aimed at B’s split line', async () => {
    await othersWorld()
    await seed({ id: 'a-back', direction: 'income', amountMinor: 9_000 })

    await expect(
      linkRefund(scope, {
        target: 'split',
        refundTransactionId: 'a-back',
        splitId: 'b-line',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(await allLinks()).toHaveLength(0)
  })

  it('refuses A a link whose refund transaction is B’s', async () => {
    await othersWorld()
    await seed({ id: 'a-orig', direction: 'expense', amountMinor: 24_000 })

    await expect(
      linkRefund(scope, {
        target: 'transaction',
        refundTransactionId: 'b-back',
        originalTransactionId: 'a-orig',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(await allLinks()).toHaveLength(0)
  })

  it('refuses A the removal of B’s link, and leaves it there', async () => {
    await othersWorld()
    const theirs = await linkRefund(otherScope, {
      target: 'transaction',
      refundTransactionId: 'b-back',
      originalTransactionId: 'b-orig',
    })

    await expect(
      unlinkRefund(scope, { refundId: theirs.id }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const links = await allLinks()
    expect(links).toHaveLength(1)
    expect(links[0].organizationId).toBe('org-b')
    expect((await storedTransaction('b-orig')).refundLinked).toBe(true)
  })

  it('refuses A a reading of B’s refunds', async () => {
    await othersWorld()
    await expect(
      listRefundsFor(scope, { transactionId: 'b-orig' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses A a suggestion scan for B’s transaction', async () => {
    await othersWorld()
    await expect(
      suggestRefundTargets(scope, { refundTransactionId: 'b-back' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('never suggests B’s transactions to A, however well they match', async () => {
    // B's purchase is a perfect match on every axis the scan looks at — same day, same amount,
    // same payee name, opposite direction — and differs only in the workspace that owns it.
    await othersWorld()
    await seed({ id: 'a-back', direction: 'income', amountMinor: 24_000 })

    const targets = await suggestRefundTargets(scope, {
      refundTransactionId: 'a-back',
    })
    expect(targets).toEqual([])
  })
})
