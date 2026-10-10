/**
 * The transfer write path, against a real SQLite database built from `drizzle/*.sql`.
 *
 * Three things are being checked and they are different in kind.
 *
 * **The five pairing refusals** (`docs/MONEY.md` §4.1) — each is a rule about *two rows*, which is
 * exactly the class of rule a schema cannot hold and a mock will always agree with. They run
 * against the real DDL, including the `CHECK` constraints that back them from the other side.
 *
 * **The zero-net property** — the reason this stage exists. An internal transfer's effect on net
 * worth in the base currency is `Σ(income ref) − Σ(expense ref)` over its legs, and it is exactly
 * zero whenever either leg is in base. The cases below assert that over the **stored rows**, not
 * over the return value, because the stored rows are what every report will sum.
 *
 * **The tenant boundary** — and the sharp case in particular: a transfer aimed at another
 * workspace's account must create *nothing*, not a one-legged expense in the caller's own.
 *
 * The isolation and money cases are grouped under their own `describe` blocks because they belong
 * to `tenant-isolation.test.ts` and `money-invariants.test.ts` and are held here only while three
 * agents share one tree.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { asCurrencyCode, asRateE10 } from '#/lib/money'
import { organization, user } from '#/server/db/auth-schema'
import {
  accounts,
  currencies,
  transactionSplits,
  transactions,
} from '#/server/db/schema'
import { runWithLedgerBatch, setLedgerBatchPorts } from '#/server/ledger/batch'

import { ConflictError, NotFoundError } from '../errors'
import { createScope } from '../scope'
import { deleteTransaction, findTransaction } from '../transactions'
import {
  convertToTransfer,
  createTransfer,
  deleteTransfer,
  getTransferPair,
  unlinkTransfer,
  updateTransfer,
} from '../transfers'

import type { RateE10 } from '#/lib/money'
import type { CreateTransferInput } from '#/server/transfers/create'
import type { Database, TenantScope } from '../base'
import type { ConversionContext, TransactionPolicies } from '../transactions'
import type { UpdateTransferInput } from '../transfers'

/** The `internal` member of the create union, which is what every fixture below builds. */
type InternalInput = Extract<CreateTransferInput, { kind: 'internal' }>

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

const MARCH = '2026-03-15'
const APRIL = '2026-04-15'

/** March: 1 EUR = 4,3218 PLN and 1 USD = 3,9500 PLN. April: both exactly 4,0000. */
const RATES = new Map<string, RateE10>([
  [`EUR:PLN:${MARCH}`, asRateE10(43_218_000_000)],
  [`USD:PLN:${MARCH}`, asRateE10(39_500_000_000)],
  [`EUR:PLN:${APRIL}`, asRateE10(40_000_000_000)],
  [`USD:PLN:${APRIL}`, asRateE10(40_000_000_000)],
])

const conversion: ConversionContext = {
  baseCurrencyCode: asCurrencyCode('PLN'),
  resolveRate: async ({ base, quote, date }) =>
    RATES.get(`${base}:${quote}:${date}`) ?? null,
}

/** Every account the ledger batch asked to rebuild, in the order the flush reached them. */
let rebuilt: Array<string> = []

let db: Database
let scope: TenantScope
let otherScope: TenantScope

beforeEach(async () => {
  db = openTestDb()
  rebuilt = []
  const now = new Date('2026-03-15T10:00:00.000Z')

  // `.onConflictDoNothing()` because `drizzle/0002_seed_currency_catalogue.sql` already holds the
  // whole ISO-4217 catalogue; the fixture stays so each test states which currencies it depends on.
  await db
    .insert(currencies)
    .values([
      { code: 'PLN', name: 'Polish Zloty', digits: 2, numericCode: 985 },
      { code: 'EUR', name: 'Euro', digits: 2, numericCode: 978 },
      { code: 'USD', name: 'US Dollar', digits: 2, numericCode: 840 },
    ])
    .onConflictDoNothing()
  await db.insert(user).values(
    ['a', 'b'].map((key) => ({
      id: `user-${key}`,
      name: key,
      email: `${key}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })),
  )
  await db.insert(organization).values([
    { id: 'org-a', name: 'A', slug: 'a', createdAt: now },
    { id: 'org-b', name: 'B', slug: 'b', createdAt: now },
  ])
  await db.insert(accounts).values(
    (
      [
        ['acc-a-pln', 'org-a', 'PLN'],
        ['acc-a-pln2', 'org-a', 'PLN'],
        ['acc-a-eur', 'org-a', 'EUR'],
        ['acc-a-usd', 'org-a', 'USD'],
        ['acc-b-pln', 'org-b', 'PLN'],
        ['acc-b-pln2', 'org-b', 'PLN'],
      ] as const
    ).map(([id, organizationId, currencyCode]) => ({
      id,
      organizationId,
      name: id,
      currencyCode,
      createdAt: now,
      updatedAt: now,
    })),
  )

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

  // The real batch, with the Durable Object replaced by a recorder. Asserting on the flush rather
  // than on `touchLedgerAccount` is what makes "two rebuilds, one per account, once each" a claim
  // about the batch's `Set` and not about how many times the repository happened to call.
  setLedgerBatchPorts({
    namespace: () => ({
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => ({
        fetch: async (request: Request) => {
          const accountId = new URL(request.url).searchParams.get('accountId')
          if (accountId !== null) rebuilt.push(accountId)
          return new Response(null, { status: 204 })
        },
      }),
    }),
  })
})

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** An internal PLN → PLN transfer of 100,00 zł within workspace A. */
function internalInput(over: Partial<InternalInput> = {}): InternalInput {
  return {
    kind: 'internal',
    sourceAccountId: 'acc-a-pln',
    destinationAccountId: 'acc-a-pln2',
    sourceAmountMinor: 10_000,
    destinationAmountMinor: 10_000,
    bookedOn: MARCH,
    ...over,
  }
}

/** The stored rows of one transfer, whatever scope wrote them. */
async function storedLegs(transferId: string) {
  return db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      direction: transactions.direction,
      amountMinor: transactions.amountMinor,
      currencyCode: transactions.currencyCode,
      refAmountMinor: transactions.refAmountMinor,
      rateE10: transactions.rateE10,
      bookedOn: transactions.bookedOn,
      note: transactions.note,
      transferKind: transactions.transferKind,
      organizationId: transactions.organizationId,
    })
    .from(transactions)
    .where(eq(transactions.transferId, transferId))
}

/**
 * What a transfer did to net worth in the base currency: income adds, expense subtracts.
 *
 * Computed from the **stored** `ref_amount_minor` columns, in integer minor units, because that is
 * the arithmetic every report will do over these rows.
 */
async function netEffectMinor(transferId: string): Promise<number> {
  const legs = await storedLegs(transferId)
  return legs.reduce(
    (total, leg) =>
      total +
      (leg.direction === 'income' ? leg.refAmountMinor : -leg.refAmountMinor),
    0,
  )
}

/** Rows on an account, regardless of transfer kind. */
async function transactionsOn(accountId: string) {
  return db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
}

/* -------------------------------------------------------------------------- */

describe('creating a transfer', () => {
  it('writes two legs sharing one transfer id, in opposite directions', async () => {
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput({ note: 'To savings' }),
    })

    expect(pair.kind).toBe('internal')
    expect(pair.source?.accountId).toBe('acc-a-pln')
    expect(pair.source?.direction).toBe('expense')
    expect(pair.destination?.accountId).toBe('acc-a-pln2')
    expect(pair.destination?.direction).toBe('income')

    const legs = await storedLegs(pair.transferId)
    expect(legs).toHaveLength(2)
    expect(legs.every((leg) => leg.transferKind === 'internal')).toBe(true)
    expect(legs.every((leg) => leg.bookedOn === MARCH)).toBe(true)
    expect(legs.every((leg) => leg.note === 'To savings')).toBe(true)
  })

  it("takes each leg's currency from the account it lands on", async () => {
    // The rebuild sums `amount_minor` per account and reads the total as native units of that
    // account's currency (§5.1), so the currency is not the caller's to state.
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput({
        destinationAccountId: 'acc-a-eur',
        destinationAmountMinor: 2_500,
      }),
    })

    expect(pair.source?.currencyCode).toBe('PLN')
    expect(pair.destination?.currencyCode).toBe('EUR')
  })

  it('writes one leg for `external_out`, and it is the expense', async () => {
    const pair = await createTransfer({
      scope,
      conversion,
      input: {
        kind: 'external_out',
        sourceAccountId: 'acc-a-pln',
        sourceAmountMinor: 10_000,
        bookedOn: MARCH,
      },
    })

    expect(pair.kind).toBe('external_out')
    expect(pair.destination).toBeNull()
    expect(pair.source?.direction).toBe('expense')
    expect(await storedLegs(pair.transferId)).toHaveLength(1)
  })

  it('writes one leg for `external_in`, and it is the income', async () => {
    const pair = await createTransfer({
      scope,
      conversion,
      input: {
        kind: 'external_in',
        destinationAccountId: 'acc-a-pln',
        destinationAmountMinor: 10_000,
        bookedOn: MARCH,
      },
    })

    expect(pair.kind).toBe('external_in')
    expect(pair.source).toBeNull()
    expect(pair.destination?.direction).toBe('income')
  })
})

describe('the create payload makes an impossible transfer unrepresentable', () => {
  it('has no field for a second account on a one-leg kind', () => {
    const payload: CreateTransferInput = {
      kind: 'external_out',
      sourceAccountId: 'acc-a-pln',
      sourceAmountMinor: 10_000,
      bookedOn: MARCH,
      // @ts-expect-error — `external_out` has one account, and the shape is what says so.
      destinationAccountId: 'acc-a-pln2',
    }
    expect(payload.kind).toBe('external_out')
  })

  it('has no field for a source amount on an `external_in`', () => {
    const payload: CreateTransferInput = {
      kind: 'external_in',
      destinationAccountId: 'acc-a-pln',
      destinationAmountMinor: 10_000,
      bookedOn: MARCH,
      // @ts-expect-error — money entering the tracked world left no account inside it.
      sourceAmountMinor: 10_000,
    }
    expect(payload.kind).toBe('external_in')
  })

  it('refuses an internal transfer between an account and itself', async () => {
    // The one rule the shape cannot carry: a relationship between two fields of the same object.
    await expect(
      createTransfer({
        scope,
        conversion,
        input: internalInput({ destinationAccountId: 'acc-a-pln' }),
      }),
    ).rejects.toThrow(/two different accounts/)
    expect(await transactionsOn('acc-a-pln')).toHaveLength(0)
  })
})

describe('the pairing rules', () => {
  it('1. propagates an edit of the pair to both legs, in one call', async () => {
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput(),
    })

    await updateTransfer({
      scope,
      conversion,
      transferId: pair.transferId,
      patch: {
        note: 'Rent float',
        sourceAmountMinor: 12_000,
        destinationAmountMinor: 12_000,
      },
    })

    const legs = await storedLegs(pair.transferId)
    expect(legs.every((leg) => leg.note === 'Rent float')).toBe(true)
    expect(legs.every((leg) => leg.amountMinor === 12_000)).toBe(true)
  })

  it('2. lets the two amounts differ and moves both dates together', async () => {
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput({
        destinationAccountId: 'acc-a-eur',
        destinationAmountMinor: 2_500,
      }),
    })

    // Amounts may differ — the accounts are in different currencies, and 100,00 zł is €25,00.
    const differing = await storedLegs(pair.transferId)
    expect(new Set(differing.map((leg) => leg.amountMinor))).toEqual(
      new Set([10_000, 2_500]),
    )

    await updateTransfer({
      scope,
      conversion,
      transferId: pair.transferId,
      patch: { bookedOn: APRIL },
    })

    // Dates may not. There is no per-leg date in the patch at all, so a payload that moved one
    // leg's day is not something a caller can express.
    const moved = await storedLegs(pair.transferId)
    expect(moved.every((leg) => leg.bookedOn === APRIL)).toBe(true)
  })

  it('2b. has no per-leg date field to express a pair straddling two days', () => {
    const patch: UpdateTransferInput = {
      bookedOn: APRIL,
      // @ts-expect-error — §4.1.2: the legs of a transfer share one day.
      destinationBookedOn: MARCH,
    }
    expect(patch.bookedOn).toBe(APRIL)
  })

  it('3. deletes both legs together, and refuses a bare single-leg delete', async () => {
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput(),
    })

    await expect(
      deleteTransaction({
        scope,
        policies: EVERYTHING,
        id: pair.source?.id ?? '',
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(await storedLegs(pair.transferId)).toHaveLength(2)

    await deleteTransfer(scope, pair.transferId)
    expect(await storedLegs(pair.transferId)).toHaveLength(0)
  })

  it('4. refuses to turn a transaction with splits into a transfer', async () => {
    const plain = await createTransfer({
      scope,
      conversion,
      input: {
        kind: 'external_out',
        sourceAccountId: 'acc-a-pln',
        sourceAmountMinor: 10_000,
        bookedOn: MARCH,
      },
    })
    const unlinked = await unlinkTransfer(scope, plain.transferId)
    const id = unlinked[0].id

    await db.insert(transactionSplits).values({
      id: 'split-1',
      organizationId: 'org-a',
      transactionId: id,
      amountMinor: 10_000,
      currencyCode: 'PLN',
      refAmountMinor: 10_000,
      refCurrencyCode: 'PLN',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(
      convertToTransfer({
        scope,
        input: {
          transactionId: id,
          kind: 'internal',
          counterAccountId: 'acc-a-pln2',
        },
      }),
    ).rejects.toThrow(/split across categories/)
  })

  it('5. refuses to unlink or delete a leg a refund still points at', async () => {
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput(),
    })
    await db
      .update(transactions)
      .set({ refundLinked: true })
      .where(eq(transactions.id, pair.destination?.id ?? ''))

    await expect(unlinkTransfer(scope, pair.transferId)).rejects.toThrow(
      /Remove the refund link/,
    )
    await expect(deleteTransfer(scope, pair.transferId)).rejects.toThrow(
      /Remove the refund link/,
    )
    expect(await storedLegs(pair.transferId)).toHaveLength(2)
  })

  it('6. refuses to change a leg’s nature in place — unlink first', async () => {
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput(),
    })

    await expect(
      convertToTransfer({
        scope,
        input: { transactionId: pair.source?.id ?? '', kind: 'external_out' },
      }),
    ).rejects.toThrow(/Unlink it before changing what it is/)
  })
})

describe('unlinking and converting', () => {
  it('turns both legs back into ordinary transactions without recomputing a thing', async () => {
    // Case 2, so the source's stored reference amount is the *mirrored* one rather than the
    // catalogue conversion. Unlinking is not an edit of the amount, the currency or the day
    // (§3.1), so the historical figure survives it byte for byte.
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput({
        sourceAccountId: 'acc-a-eur',
        sourceAmountMinor: 10_000,
        destinationAmountMinor: 42_850,
      }),
    })
    const before = await storedLegs(pair.transferId)

    const unlinked = await unlinkTransfer(scope, pair.transferId)

    expect(unlinked).toHaveLength(2)
    expect(unlinked.every((leg) => leg.transferKind === 'none')).toBe(true)
    expect(unlinked.every((leg) => leg.transferId === null)).toBe(true)
    for (const leg of unlinked) {
      const was = before.find((row) => row.id === leg.id)
      expect(leg.refAmountMinor).toBe(was?.refAmountMinor)
      expect(leg.rateE10).toBe(was?.rateE10)
    }
  })

  it('promotes a transaction and mints its counter leg', async () => {
    const plain = await createTransfer({
      scope,
      conversion,
      input: {
        kind: 'external_out',
        sourceAccountId: 'acc-a-pln',
        sourceAmountMinor: 10_000,
        bookedOn: MARCH,
      },
    })
    const [ordinary] = await unlinkTransfer(scope, plain.transferId)

    const pair = await convertToTransfer({
      scope,
      input: {
        transactionId: ordinary.id,
        kind: 'internal',
        counterAccountId: 'acc-a-pln2',
      },
    })

    expect(pair.source?.id).toBe(ordinary.id)
    expect(pair.destination?.accountId).toBe('acc-a-pln2')
    // The counter leg copies the conversion triple rather than recomputing it, so the pair nets to
    // exactly zero by construction and needs no rate at all.
    expect(await netEffectMinor(pair.transferId)).toBe(0)
  })

  it('refuses to mint a counter leg in a different currency', async () => {
    const plain = await createTransfer({
      scope,
      conversion,
      input: {
        kind: 'external_out',
        sourceAccountId: 'acc-a-pln',
        sourceAmountMinor: 10_000,
        bookedOn: MARCH,
      },
    })
    const [ordinary] = await unlinkTransfer(scope, plain.transferId)

    // The counter leg's native amount would have to be invented at the catalogue rate, and a
    // native amount nobody stated is a balance that is wrong forever.
    await expect(
      convertToTransfer({
        scope,
        input: {
          transactionId: ordinary.id,
          kind: 'internal',
          counterAccountId: 'acc-a-eur',
        },
      }),
    ).rejects.toThrow(/Create the transfer with both amounts/)
    expect(await transactionsOn('acc-a-eur')).toHaveLength(0)
  })

  it('refuses to promote a balance adjustment', async () => {
    const plain = await createTransfer({
      scope,
      conversion,
      input: {
        kind: 'external_out',
        sourceAccountId: 'acc-a-pln',
        sourceAmountMinor: 10_000,
        bookedOn: MARCH,
      },
    })
    const [ordinary] = await unlinkTransfer(scope, plain.transferId)
    await db
      .update(transactions)
      .set({ isBalanceAdjustment: true })
      .where(eq(transactions.id, ordinary.id))

    // Without the guard this reaches the schema CHECK and surfaces as a raw SQLite error, which a
    // surface cannot turn into a sentence a person can read.
    await expect(
      convertToTransfer({
        scope,
        input: {
          transactionId: ordinary.id,
          kind: 'internal',
          counterAccountId: 'acc-a-pln2',
        },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(await transactionsOn('acc-a-pln2')).toHaveLength(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Ledger batching                                                             */
/* -------------------------------------------------------------------------- */

describe('the ledger batch', () => {
  it('enqueues two rebuilds for a two-leg create — one per account, once each', async () => {
    await runWithLedgerBatch(() =>
      createTransfer({ scope, conversion, input: internalInput() }),
    )

    expect(rebuilt).toHaveLength(2)
    expect(new Set(rebuilt)).toEqual(new Set(['acc-a-pln', 'acc-a-pln2']))
  })

  it('enqueues one rebuild for a one-leg create', async () => {
    await runWithLedgerBatch(() =>
      createTransfer({
        scope,
        conversion,
        input: {
          kind: 'external_out',
          sourceAccountId: 'acc-a-pln',
          sourceAmountMinor: 10_000,
          bookedOn: MARCH,
        },
      }),
    )

    expect(rebuilt).toEqual(['acc-a-pln'])
  })

  it('enqueues two rebuilds for a two-leg edit', async () => {
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput(),
    })
    rebuilt = []

    await runWithLedgerBatch(() =>
      updateTransfer({
        scope,
        conversion,
        transferId: pair.transferId,
        patch: { sourceAmountMinor: 12_000, destinationAmountMinor: 12_000 },
      }),
    )

    expect(rebuilt).toHaveLength(2)
    expect(new Set(rebuilt)).toEqual(new Set(['acc-a-pln', 'acc-a-pln2']))
  })
})

/* -------------------------------------------------------------------------- */
/* Tenant isolation                                                            */
/* -------------------------------------------------------------------------- */

describe('tenant isolation', () => {
  /** A pair inside workspace B, for A to fail to reach. */
  async function othersPair() {
    return createTransfer({
      scope: otherScope,
      conversion,
      input: {
        kind: 'internal',
        sourceAccountId: 'acc-b-pln',
        destinationAccountId: 'acc-b-pln2',
        sourceAmountMinor: 10_000,
        destinationAmountMinor: 10_000,
        bookedOn: MARCH,
      },
    })
  }

  it("createTransfer with another workspace's destination creates nothing at all", async () => {
    // **The sharp case.** Both accounts are proved before anything is written, so the failure
    // cannot leave a one-legged expense behind in the caller's own workspace — which would be a
    // transfer that took money out of an account and put it nowhere.
    await expect(
      createTransfer({
        scope,
        conversion,
        input: internalInput({ destinationAccountId: 'acc-b-pln' }),
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(await transactionsOn('acc-a-pln')).toHaveLength(0)
    expect(await transactionsOn('acc-b-pln')).toHaveLength(0)
  })

  it("createTransfer with another workspace's source creates nothing at all", async () => {
    await expect(
      createTransfer({
        scope,
        conversion,
        input: internalInput({ sourceAccountId: 'acc-b-pln' }),
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(await transactionsOn('acc-b-pln')).toHaveLength(0)
    expect(await transactionsOn('acc-a-pln2')).toHaveLength(0)
  })

  it("getTransferPair does not find another workspace's transfer", async () => {
    const theirs = await othersPair()
    await expect(
      getTransferPair(scope, theirs.transferId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("updateTransfer leaves another workspace's pair untouched", async () => {
    const theirs = await othersPair()

    await expect(
      updateTransfer({
        scope,
        conversion,
        transferId: theirs.transferId,
        patch: { sourceAmountMinor: 1, destinationAmountMinor: 1 },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const legs = await storedLegs(theirs.transferId)
    expect(legs).toHaveLength(2)
    expect(legs.every((leg) => leg.amountMinor === 10_000)).toBe(true)
  })

  it("deleteTransfer leaves another workspace's pair intact", async () => {
    const theirs = await othersPair()

    await expect(
      deleteTransfer(scope, theirs.transferId),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(await storedLegs(theirs.transferId)).toHaveLength(2)
  })

  it("unlinkTransfer leaves another workspace's pair linked", async () => {
    const theirs = await othersPair()

    await expect(
      unlinkTransfer(scope, theirs.transferId),
    ).rejects.toBeInstanceOf(NotFoundError)
    const legs = await storedLegs(theirs.transferId)
    expect(legs.every((leg) => leg.transferKind === 'internal')).toBe(true)
  })

  it("convertToTransfer does not reach another workspace's transaction", async () => {
    const theirs = await othersPair()
    const unlinked = await unlinkTransfer(otherScope, theirs.transferId)

    await expect(
      convertToTransfer({
        scope,
        input: {
          transactionId: unlinked[0].id,
          kind: 'internal',
          counterAccountId: 'acc-a-pln',
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const still = await db
      .select({ transferKind: transactions.transferKind })
      .from(transactions)
      .where(eq(transactions.id, unlinked[0].id))
    expect(still[0].transferKind).toBe('none')
  })

  it("convertToTransfer with another workspace's counter account promotes nothing", async () => {
    // The counter account is proved before the row being converted is touched, so this failure
    // cannot leave a one-legged `internal` transfer behind either.
    const plain = await createTransfer({
      scope,
      conversion,
      input: {
        kind: 'external_out',
        sourceAccountId: 'acc-a-pln',
        sourceAmountMinor: 10_000,
        bookedOn: MARCH,
      },
    })
    const [ordinary] = await unlinkTransfer(scope, plain.transferId)

    await expect(
      convertToTransfer({
        scope,
        input: {
          transactionId: ordinary.id,
          kind: 'internal',
          counterAccountId: 'acc-b-pln',
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const after = await db
      .select({
        transferKind: transactions.transferKind,
        transferId: transactions.transferId,
      })
      .from(transactions)
      .where(eq(transactions.id, ordinary.id))
    expect(after[0]).toEqual({ transferKind: 'none', transferId: null })
    expect(await transactionsOn('acc-b-pln')).toHaveLength(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Money invariants — belong in `money-invariants.test.ts`                      */
/* -------------------------------------------------------------------------- */

describe('money invariants', () => {
  it('case 1: source in base — the destination takes the source’s figure, and the net is zero', async () => {
    // 100,00 zł leaves a PLN account and €25,00 lands. The destination's ref is the source's
    // 10 000 exactly, at a back-derived 1e14 / 2 500 = 40 000 000 000.
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput({
        destinationAccountId: 'acc-a-eur',
        destinationAmountMinor: 2_500,
      }),
    })

    const legs = await storedLegs(pair.transferId)
    expect(legs.map((leg) => leg.refAmountMinor)).toEqual([10_000, 10_000])
    expect(legs.find((leg) => leg.currencyCode === 'EUR')?.rateE10).toBe(
      40_000_000_000,
    )
    expect(await netEffectMinor(pair.transferId)).toBe(0)
  })

  it('case 2: destination in base — the source’s figure is updated, and the net is zero', async () => {
    // §4.2's worked example. €100,00 leaves and 428,50 zł lands: the source's ref becomes 42 850
    // at 4,2850, not the catalogue's 4,3218 — which would have moved net worth by 368 grosz.
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput({
        sourceAccountId: 'acc-a-eur',
        sourceAmountMinor: 10_000,
        destinationAmountMinor: 42_850,
      }),
    })

    const source = (await storedLegs(pair.transferId)).find(
      (leg) => leg.direction === 'expense',
    )
    expect(source?.refAmountMinor).toBe(42_850)
    expect(source?.rateE10).toBe(42_850_000_000)
    expect(await netEffectMinor(pair.transferId)).toBe(0)
  })

  it('case 3: both in base — both equal, and the net is zero', async () => {
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput(),
    })

    const legs = await storedLegs(pair.transferId)
    expect(legs.every((leg) => leg.refAmountMinor === 10_000)).toBe(true)
    expect(legs.every((leg) => leg.rateE10 === 10_000_000_000)).toBe(true)
    expect(await netEffectMinor(pair.transferId)).toBe(0)
  })

  it('case 4: neither in base — each converts alone, and the difference is correct', async () => {
    // €100,00 at 4,3218 = 43 218; $110,00 at 3,9500 = 43 450. The residual is 232 grosz and it is
    // a real FX difference between two conversions on the same day, not a rounding artefact. This
    // case asserts the difference is **correct**, not that it is absent.
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput({
        sourceAccountId: 'acc-a-eur',
        sourceAmountMinor: 10_000,
        destinationAccountId: 'acc-a-usd',
        destinationAmountMinor: 11_000,
      }),
    })

    const legs = await storedLegs(pair.transferId)
    expect(legs.find((leg) => leg.currencyCode === 'EUR')?.refAmountMinor).toBe(
      43_218,
    )
    expect(legs.find((leg) => leg.currencyCode === 'USD')?.refAmountMinor).toBe(
      43_450,
    )
    expect(await netEffectMinor(pair.transferId)).toBe(43_450 - 43_218)
    expect(await netEffectMinor(pair.transferId)).toBe(232)
  })

  it('a transfer never appears where a category total looks', async () => {
    // Both legs carry `transfer_kind <> 'none'`, so the `transfers: 'exclude'` policy every
    // category aggregation reads with cannot see either of them.
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput(),
    })

    for (const leg of [pair.source, pair.destination]) {
      await expect(
        findTransaction({
          scope,
          policies: { ...EVERYTHING, transfers: 'exclude' },
          id: leg?.id ?? '',
        }),
      ).resolves.toBeNull()
      await expect(
        findTransaction({ scope, policies: EVERYTHING, id: leg?.id ?? '' }),
      ).resolves.not.toBeNull()
    }
  })

  it('a date edit moves both legs and recomputes both at the new day’s rate', async () => {
    // Case 4, so both legs have a rate to re-anchor. March: 4,3218 and 3,9500 → 43 218 and
    // 43 450. April: both 4,0000 → 10 000 × 4 = 40 000 and 11 000 × 4 = 44 000. The pair never
    // straddles two rate days, which is why the date is one field rather than two.
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput({
        sourceAccountId: 'acc-a-eur',
        sourceAmountMinor: 10_000,
        destinationAccountId: 'acc-a-usd',
        destinationAmountMinor: 11_000,
      }),
    })

    await updateTransfer({
      scope,
      conversion,
      transferId: pair.transferId,
      patch: { bookedOn: APRIL },
    })

    const legs = await storedLegs(pair.transferId)
    expect(legs.every((leg) => leg.bookedOn === APRIL)).toBe(true)
    expect(legs.find((leg) => leg.currencyCode === 'EUR')?.refAmountMinor).toBe(
      40_000,
    )
    expect(legs.find((leg) => leg.currencyCode === 'USD')?.refAmountMinor).toBe(
      44_000,
    )
    expect(await netEffectMinor(pair.transferId)).toBe(4_000)
  })

  it('an edit that moves neither amount nor day leaves both figures byte-identical', async () => {
    // `ref_amount_minor` is history (§3.1). A save that changes a note must not re-anchor a March
    // pair to today's rate, and a no-op save must not write a new figure at all.
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput({
        sourceAccountId: 'acc-a-eur',
        sourceAmountMinor: 10_000,
        destinationAmountMinor: 42_850,
      }),
    })
    const before = await storedLegs(pair.transferId)

    await updateTransfer({
      scope,
      conversion,
      transferId: pair.transferId,
      patch: { note: 'Renamed' },
    })

    const after = await storedLegs(pair.transferId)
    for (const leg of after) {
      const was = before.find((row) => row.id === leg.id)
      expect(leg.refAmountMinor).toBe(was?.refAmountMinor)
      expect(leg.rateE10).toBe(was?.rateE10)
    }
  })

  it('a note-only edit of a one-leg transfer resolves no rate at all', async () => {
    // The sharp version of the case above: a leg the transfer does not have has not moved, so an
    // `external_out` in a foreign currency must not re-anchor on a note save. The edit runs
    // against a conversion context that can resolve nothing — if anything reached for a rate it
    // would be a `RateUnavailableError` rather than a silently identical figure.
    const pair = await createTransfer({
      scope,
      conversion,
      input: {
        kind: 'external_out',
        sourceAccountId: 'acc-a-eur',
        sourceAmountMinor: 10_000,
        bookedOn: MARCH,
      },
    })

    await updateTransfer({
      scope,
      conversion: {
        baseCurrencyCode: asCurrencyCode('PLN'),
        resolveRate: async () => null,
      },
      transferId: pair.transferId,
      patch: { note: 'Cash withdrawal' },
    })

    const legs = await storedLegs(pair.transferId)
    expect(legs[0].refAmountMinor).toBe(43_218)
    expect(legs[0].note).toBe('Cash withdrawal')
  })

  it('deleting one leg deletes both and enqueues two rebuilds', async () => {
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput(),
    })
    rebuilt = []

    await runWithLedgerBatch(() => deleteTransfer(scope, pair.transferId))

    expect(await storedLegs(pair.transferId)).toHaveLength(0)
    expect(new Set(rebuilt)).toEqual(new Set(['acc-a-pln', 'acc-a-pln2']))
    expect(rebuilt).toHaveLength(2)
  })
})

/* -------------------------------------------------------------------------- */
/* The booking date                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A transfer leg is a settled row, so it takes the same booking rule as a transaction
 * (`#/server/booking-rule`). `NOW` is 10:00 UTC on the 15th, so the cutoff day is the 16th. Only
 * `Date` is faked: the in-memory database needs its timers.
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
    return (await db.select({ id: transactions.id }).from(transactions)).length
  }

  /** A legacy pair: written when no rule looked, so its settled legs are dated after the cutoff. */
  async function legacyFuturePair() {
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput({ note: 'before' }),
    })
    await db
      .update(transactions)
      .set({ bookedOn: FAR_FUTURE })
      .where(eq(transactions.transferId, pair.transferId))
    return pair
  }

  it('creates a transfer up to the cutoff day', async () => {
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput({ bookedOn: CUTOFF_DAY }),
    })

    expect(pair.source?.bookedOn).toBe(CUTOFF_DAY)
  })

  it('refuses every kind of transfer after the cutoff, writing no leg', async () => {
    const inputs: Array<CreateTransferInput> = [
      internalInput({ bookedOn: BEYOND }),
      {
        kind: 'external_out',
        sourceAccountId: 'acc-a-pln',
        sourceAmountMinor: 10_000,
        bookedOn: FAR_FUTURE,
      },
      {
        kind: 'external_in',
        destinationAccountId: 'acc-a-pln',
        destinationAmountMinor: 10_000,
        bookedOn: FAR_FUTURE,
      },
    ]

    for (const input of inputs) {
      await expect(
        createTransfer({ scope, conversion, input }),
      ).rejects.toBeInstanceOf(z.ZodError)
    }
    expect(await rowCount()).toBe(0)
  })

  it('refuses a date edit after the cutoff and leaves both legs where they were', async () => {
    const pair = await createTransfer({
      scope,
      conversion,
      input: internalInput(),
    })

    await expect(
      updateTransfer({
        scope,
        conversion,
        transferId: pair.transferId,
        patch: { bookedOn: BEYOND },
      }),
    ).rejects.toBeInstanceOf(z.ZodError)

    const legs = await storedLegs(pair.transferId)
    expect(legs.every((leg) => leg.bookedOn === MARCH)).toBe(true)
  })

  describe('a legacy pair dated after the cutoff', () => {
    it('still takes a note-only and an amount-only edit', async () => {
      const pair = await legacyFuturePair()

      await updateTransfer({
        scope,
        conversion,
        transferId: pair.transferId,
        patch: { note: 'after' },
      })
      await updateTransfer({
        scope,
        conversion: {
          ...conversion,
          resolveRate: async () => asRateE10(10_000_000_000),
        },
        transferId: pair.transferId,
        patch: { sourceAmountMinor: 5_000, destinationAmountMinor: 5_000 },
      })

      const legs = await storedLegs(pair.transferId)
      expect(legs.map((leg) => leg.note)).toEqual(['after', 'after'])
      expect(legs.map((leg) => leg.amountMinor)).toEqual([5_000, 5_000])
    })

    it('still takes a save that re-sends the stored date', async () => {
      const pair = await legacyFuturePair()

      await expect(
        updateTransfer({
          scope,
          conversion,
          transferId: pair.transferId,
          patch: { bookedOn: FAR_FUTURE, note: 'resent' },
        }),
      ).resolves.toBeDefined()
    })

    it('refuses a move to a different future date and takes a move back to a bookable one', async () => {
      const pair = await legacyFuturePair()

      await expect(
        updateTransfer({
          scope,
          conversion,
          transferId: pair.transferId,
          patch: { bookedOn: '2999-01-02' },
        }),
      ).rejects.toBeInstanceOf(z.ZodError)

      const moved = await updateTransfer({
        scope,
        conversion,
        transferId: pair.transferId,
        patch: { bookedOn: CUTOFF_DAY },
      })
      expect(moved.source?.bookedOn).toBe(CUTOFF_DAY)
    })
  })

  describe('converting a transaction', () => {
    async function ordinaryRowOn(bookedOn: string, isPlanned: boolean) {
      const plain = await createTransfer({
        scope,
        conversion,
        input: {
          kind: 'external_out',
          sourceAccountId: 'acc-a-pln',
          sourceAmountMinor: 10_000,
          bookedOn: MARCH,
        },
      })
      const [ordinary] = await unlinkTransfer(scope, plain.transferId)
      await db
        .update(transactions)
        .set({ bookedOn, isPlanned })
        .where(eq(transactions.id, ordinary.id))
      return ordinary
    }

    it('refuses an internal transfer whose counter leg would be settled after the cutoff, promoting nothing', async () => {
      const planned = await ordinaryRowOn(FAR_FUTURE, true)

      await expect(
        convertToTransfer({
          scope,
          input: {
            transactionId: planned.id,
            kind: 'internal',
            counterAccountId: 'acc-a-pln2',
          },
        }),
      ).rejects.toThrow(ConflictError)

      const [row] = await db
        .select({ transferKind: transactions.transferKind })
        .from(transactions)
        .where(eq(transactions.id, planned.id))
      expect(row.transferKind).toBe('none')
      expect(await transactionsOn('acc-a-pln2')).toHaveLength(0)
    })

    it('leaves an external conversion of a future-dated planned row alone', async () => {
      const planned = await ordinaryRowOn(FAR_FUTURE, true)

      const pair = await convertToTransfer({
        scope,
        input: { transactionId: planned.id, kind: 'external_out' },
      })

      expect(pair.source?.bookedOn).toBe(FAR_FUTURE)
    })

    it('converts an internal transfer on a bookable date', async () => {
      const settled = await ordinaryRowOn(CUTOFF_DAY, false)

      const pair = await convertToTransfer({
        scope,
        input: {
          transactionId: settled.id,
          kind: 'internal',
          counterAccountId: 'acc-a-pln2',
        },
      })

      expect(pair.destination?.bookedOn).toBe(CUTOFF_DAY)
    })
  })
})
