/**
 * The loan register: imported schedules, quota, paid-requires-a-transaction, and the
 * terms-locked refusal.
 *
 * A real SQLite built from `drizzle/*.sql`. Figures are synthetic (Loan A, Lender A) — never
 * owner amounts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import {
  accounts,
  exchangeRates,
  loanInstalments,
  transactions,
} from '#/server/db/schema'
import { createBudgetWorld, executed, seedTransaction } from './budget-harness'

import { setLimitResolver } from '../base'
import { ConflictError } from '../errors'
import {
  LoanInstalmentSettledError,
  LoanSettlementRefusedError,
  LoanTermsLockedError,
  MAX_INSTALMENTS,
  createLoan,
  deleteLoan,
  derivedInstalmentStatus,
  getLoan,
  listInstalments,
  listLoans,
  listSettledTransactionIds,
  markInstalmentPaid,
  updateLoan,
} from '../loans'

import type { UpdateLoanInput } from '../loans'
import type { BudgetWorld } from './budget-harness'
import type { TenantScope } from '../base'

let world: BudgetWorld
let scope: TenantScope

beforeEach(async () => {
  world = await createBudgetWorld()
  scope = world.scope
  setLimitResolver(null)
})

afterEach(() => {
  setLimitResolver(null)
})

function importedInput() {
  return {
    name: 'Loan A',
    lender: 'Lender A',
    currencyCode: 'PLN' as const,
    principalMinor: 500_00,
    instalmentMinor: 100_00,
    paymentDay: 20,
    openedOn: '2026-01-15',
    endsOn: '2026-04-20',
    book: 'business' as const,
    kind: 'credit' as const,
    instalments: [
      { dueOn: '2026-02-20', amountMinor: 120_00 },
      { dueOn: '2026-03-20', amountMinor: 90_00 },
      { dueOn: '2026-04-20', amountMinor: 70_00, isBuyout: true },
    ],
  }
}

describe('createLoan writes the loan and its imported schedule together', () => {
  it('assigns sequence by due date and keeps unequal amounts', async () => {
    const loan = await createLoan(scope, importedInput())
    expect(loan.book).toBe('business')
    expect(loan.lender).toBe('Lender A')
    expect(loan.kind).toBe('credit')
    expect(loan.repaymentShape).toBe('imported')
    expect(loan.paymentDay).toBe(20)
    expect(loan.refPrincipalMinor).toBe(500_00)

    const rows = await listInstalments(scope, {
      loanId: loan.id,
      today: '2026-03-21',
    })
    expect(
      rows.map((row) => [row.sequence, row.amountMinor, row.isBuyout]),
    ).toEqual([
      [1, 120_00, false],
      [2, 90_00, false],
      [3, 70_00, true],
    ])
    expect(rows.map((row) => row.derivedStatus)).toEqual([
      'overdue',
      'overdue',
      'upcoming',
    ])
  })

  it('refuses a second buyout on the same loan', async () => {
    await expect(
      createLoan(scope, {
        ...importedInput(),
        instalments: [
          { dueOn: '2026-02-20', amountMinor: 10_00, isBuyout: true },
          { dueOn: '2026-03-20', amountMinor: 10_00, isBuyout: true },
        ],
      }),
    ).rejects.toThrow(/at most one buyout/)
  })

  it('splits a long schedule across statements that stay under the D1 parameter ceiling', async () => {
    const months = Array.from({ length: 14 }, (_, index) => ({
      dueOn: new Date(Date.UTC(2027, index, 20)).toISOString().slice(0, 10),
      amountMinor: 100_00 + index,
    }))
    executed.length = 0
    const loan = await createLoan(scope, {
      ...importedInput(),
      endsOn: '2028-02-20',
      instalments: months,
    })

    const inserts = executed.filter((query) =>
      query.startsWith('insert into "loan_instalments"'),
    )
    expect(inserts.length).toBeGreaterThan(1)
    for (const query of inserts) {
      expect((query.match(/\?/gu) ?? []).length).toBeLessThanOrEqual(100)
    }
    const rows = await listInstalments(scope, { loanId: loan.id })
    expect(rows.map((row) => row.sequence)).toEqual(
      Array.from({ length: 14 }, (_, index) => index + 1),
    )
  })

  it('refuses a schedule longer than the longest term', async () => {
    const instalments = Array.from({ length: MAX_INSTALMENTS + 1 }, () => ({
      dueOn: '2027-01-20',
      amountMinor: 1_00,
    }))
    await expect(
      createLoan(scope, { ...importedInput(), instalments }),
    ).rejects.toThrow()
    expect(await listLoans(scope, { includeClosed: true })).toEqual([])
  })

  it('filters the list by book without leaking the other book', async () => {
    await createLoan(scope, importedInput())
    await createLoan(scope, {
      ...importedInput(),
      name: 'Loan P',
      book: 'personal',
    })
    const business = await listLoans(scope, { book: 'business' })
    expect(business.map((row) => row.name)).toEqual(['Loan A'])
    const personal = await listLoans(scope, { book: 'personal' })
    expect(personal.map((row) => row.name)).toEqual(['Loan P'])
  })
})

describe('the loans quota', () => {
  it('is asserted before the insert, so a refusal leaves no row behind', async () => {
    setLimitResolver(async () => 1)
    await createLoan(scope, importedInput())
    await expect(
      createLoan(scope, { ...importedInput(), name: 'Loan Two' }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', metric: 'loans' })
    expect(await listLoans(scope, { includeClosed: true })).toHaveLength(1)
  })

  it('counts closed loans, and deletion is what frees a slot', async () => {
    setLimitResolver(async () => 1)
    const first = await createLoan(scope, importedInput())
    await updateLoan(scope, first.id, { status: 'closed' })
    await expect(
      createLoan(scope, { ...importedInput(), name: 'Loan Two' }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })
    await deleteLoan(scope, first.id)
    await expect(
      createLoan(scope, { ...importedInput(), name: 'Loan Two' }),
    ).resolves.toMatchObject({ name: 'Loan Two' })
  })
})

describe('paid instalments bind a transaction', () => {
  it('locks term edits once any instalment is paid', async () => {
    const loan = await createLoan(scope, importedInput())
    await seedTransaction(world.db, {
      id: 'tx-a',
      refAmountMinor: 120_00,
      bookedOn: '2026-02-20',
    })
    await markInstalmentPaid(scope, {
      loanId: loan.id,
      sequence: 1,
      transactionId: 'tx-a',
    })

    await expect(
      updateLoan(scope, loan.id, { principalMinor: 400_00 }),
    ).rejects.toBeInstanceOf(LoanTermsLockedError)
    await expect(
      updateLoan(scope, loan.id, { name: 'Loan A renamed' }),
    ).resolves.toMatchObject({ name: 'Loan A renamed' })
  })

  it('refuses a second settlement against a different transaction', async () => {
    const loan = await createLoan(scope, importedInput())
    await seedTransaction(world.db, {
      id: 'tx-a',
      refAmountMinor: 120_00,
      bookedOn: '2026-02-20',
    })
    await seedTransaction(world.db, {
      id: 'tx-a2',
      refAmountMinor: 120_00,
      bookedOn: '2026-02-21',
    })
    await markInstalmentPaid(scope, {
      loanId: loan.id,
      sequence: 1,
      transactionId: 'tx-a',
    })
    await expect(
      markInstalmentPaid(scope, {
        loanId: loan.id,
        sequence: 1,
        transactionId: 'tx-a2',
      }),
    ).rejects.toBeInstanceOf(LoanInstalmentSettledError)
  })

  it('refuses term edits when an instalment is settled during the edit', async () => {
    const loan = await createLoan(scope, importedInput())
    await seedTransaction(world.db, {
      id: 'tx-a',
      refAmountMinor: 120_00,
      bookedOn: '2026-02-20',
    })

    const [settlement, edit] = await Promise.allSettled([
      markInstalmentPaid(scope, {
        loanId: loan.id,
        sequence: 1,
        transactionId: 'tx-a',
      }),
      updateLoan(scope, loan.id, { principalMinor: 400_00 }),
    ])
    expect(settlement).toMatchObject({ status: 'fulfilled' })
    expect(edit).toMatchObject({
      status: 'rejected',
      reason: expect.any(LoanTermsLockedError),
    })
    expect((await getLoan(scope, loan.id)).principalMinor).toBe(500_00)
  })

  it('allows only one transaction to win concurrent settlements', async () => {
    const loan = await createLoan(scope, importedInput())
    for (const id of ['tx-a', 'tx-a2']) {
      await seedTransaction(world.db, {
        id,
        refAmountMinor: 120_00,
        bookedOn: '2026-02-20',
      })
    }

    const results = await Promise.allSettled(
      ['tx-a', 'tx-a2'].map((transactionId) =>
        markInstalmentPaid(scope, {
          loanId: loan.id,
          sequence: 1,
          transactionId,
        }),
      ),
    )
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({
      reason: expect.any(LoanInstalmentSettledError),
    })
    const winner = results.find((result) => result.status === 'fulfilled')
    const rows = await listInstalments(scope, { loanId: loan.id })
    expect(rows[0]?.settledTransactionId).toBe(
      winner?.value.settledTransactionId,
    )
    await expect(
      markInstalmentPaid(scope, {
        loanId: loan.id,
        sequence: 1,
        transactionId: rows[0]?.settledTransactionId ?? '',
      }),
    ).resolves.toMatchObject({
      settledTransactionId: rows[0]?.settledTransactionId,
    })
  })

  it.each([false, true])(
    'allows only one instalment to win the same concurrent settlement (different loan: %s)',
    async (differentLoan) => {
      const loan = await createLoan(scope, importedInput())
      const other = differentLoan
        ? await createLoan(scope, importedInput())
        : loan
      await seedTransaction(world.db, {
        id: 'tx-shared',
        refAmountMinor: 120_00,
        bookedOn: '2026-02-20',
      })
      const results = await Promise.allSettled(
        [1, 2].map((sequence) =>
          markInstalmentPaid(scope, {
            loanId: sequence === 1 ? loan.id : other.id,
            sequence,
            transactionId: 'tx-shared',
          }),
        ),
      )
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1)
      expect(
        results.find((result) => result.status === 'rejected'),
      ).toMatchObject({
        reason: expect.any(LoanSettlementRefusedError),
      })
      expect(
        [
          ...(await listInstalments(scope, { loanId: loan.id })),
          ...(differentLoan
            ? await listInstalments(scope, { loanId: other.id })
            : []),
        ].filter((row) => row.status === 'paid'),
      ).toHaveLength(1)
    },
  )

  it.each([
    { isPlanned: true },
    { isBalanceAdjustment: true },
    { transferKind: 'external_out' as const },
  ])('refuses a non-payment settlement: %j', async (flags) => {
    const loan = await createLoan(scope, importedInput())
    await seedTransaction(world.db, {
      id: 'tx-invalid',
      refAmountMinor: 120_00,
      ...flags,
    })
    await expect(
      markInstalmentPaid(scope, {
        loanId: loan.id,
        sequence: 1,
        transactionId: 'tx-invalid',
      }),
    ).rejects.toMatchObject({ reason: 'not-a-payment' })
    expect((await listInstalments(scope, { loanId: loan.id }))[0]?.status).toBe(
      'upcoming',
    )
  })

  it('refuses a payment from a different account', async () => {
    await world.db.insert(accounts).values({
      id: 'acc-other',
      organizationId: 'org-a',
      name: 'Other',
      currencyCode: 'PLN',
      createdAt: new Date('2026-03-15T10:00:00.000Z'),
      updatedAt: new Date('2026-03-15T10:00:00.000Z'),
    })
    const loan = await createLoan(scope, {
      ...importedInput(),
      accountId: 'acc-a',
    })
    await seedTransaction(world.db, {
      id: 'tx-other',
      accountId: 'acc-other',
      refAmountMinor: 120_00,
    })
    await expect(
      markInstalmentPaid(scope, {
        loanId: loan.id,
        sequence: 1,
        transactionId: 'tx-other',
      }),
    ).rejects.toMatchObject({ reason: 'account-mismatch' })
  })

  it('refuses a transaction that already settles another instalment', async () => {
    const loan = await createLoan(scope, importedInput())
    await seedTransaction(world.db, {
      id: 'tx-a',
      refAmountMinor: 120_00,
      bookedOn: '2026-02-20',
    })
    await markInstalmentPaid(scope, {
      loanId: loan.id,
      sequence: 1,
      transactionId: 'tx-a',
    })
    expect([...(await listSettledTransactionIds(scope))]).toEqual(['tx-a'])

    await expect(
      markInstalmentPaid(scope, {
        loanId: loan.id,
        sequence: 2,
        transactionId: 'tx-a',
      }),
    ).rejects.toMatchObject({
      constructor: LoanSettlementRefusedError,
      reason: 'already-linked',
    })
    // Re-linking the same pair stays idempotent.
    await expect(
      markInstalmentPaid(scope, {
        loanId: loan.id,
        sequence: 1,
        transactionId: 'tx-a',
      }),
    ).resolves.toMatchObject({ status: 'paid' })
  })

  it('refuses an income transaction as the settlement', async () => {
    const loan = await createLoan(scope, importedInput())
    await seedTransaction(world.db, {
      id: 'tx-in',
      direction: 'income',
      refAmountMinor: 120_00,
      bookedOn: '2026-02-20',
    })
    await expect(
      markInstalmentPaid(scope, {
        loanId: loan.id,
        sequence: 1,
        transactionId: 'tx-in',
      }),
    ).rejects.toMatchObject({
      constructor: LoanSettlementRefusedError,
      reason: 'not-an-expense',
    })
  })

  it('refuses a settlement in another currency without changing the instalment', async () => {
    const loan = await createLoan(scope, importedInput())
    await seedTransaction(world.db, { id: 'tx-eur', refAmountMinor: 120_00 })
    await world.db
      .update(transactions)
      .set({ currencyCode: 'EUR' })
      .where(eq(transactions.id, 'tx-eur'))
    const before = await listInstalments(scope, { loanId: loan.id })
    await expect(
      markInstalmentPaid(scope, {
        loanId: loan.id,
        sequence: 1,
        transactionId: 'tx-eur',
      }),
    ).rejects.toMatchObject({ reason: 'currency-mismatch' })
    expect(await listInstalments(scope, { loanId: loan.id })).toEqual(before)
  })

  it('lets the database refuse a paid row with no transaction id', async () => {
    const loan = await createLoan(scope, importedInput())
    await expect(
      world.db.insert(loanInstalments).values({
        organizationId: 'org-a',
        loanId: loan.id,
        sequence: 9,
        dueOn: '2026-12-20',
        amountMinor: 1_00,
        currencyCode: 'PLN',
        refAmountMinor: 1_00,
        rateE10: 10_000_000_000,
        status: 'paid',
        settledTransactionId: null,
        createdAt: new Date('2026-03-15T10:00:00.000Z'),
        updatedAt: new Date('2026-03-15T10:00:00.000Z'),
      }),
    ).rejects.toThrow()
  })
})

async function seedEurRates() {
  const stamp = new Date('2026-03-15T10:00:00.000Z')
  await world.db.insert(exchangeRates).values(
    [
      ['2026-01-15', 40_000_000_000],
      ['2026-02-15', 50_000_000_000],
      ['2026-03-20', 50_000_000_000],
    ].map(([date, rateE10]) => ({
      baseCode: 'EUR',
      quoteCode: 'PLN',
      date: String(date),
      rateE10: Number(rateE10),
      source: 'manual' as const,
      fetchedAt: stamp,
    })),
  )
}

describe('updateLoan keeps the loan, its account and its schedule in one currency', () => {
  it('refuses to point the loan at an account held in another currency', async () => {
    await world.db.insert(accounts).values({
      id: 'acc-a-eur',
      organizationId: 'org-a',
      name: 'Euro account',
      currencyCode: 'EUR',
      createdAt: new Date('2026-03-15T10:00:00.000Z'),
      updatedAt: new Date('2026-03-15T10:00:00.000Z'),
    })
    const loan = await createLoan(scope, {
      ...importedInput(),
      accountId: 'acc-a',
    })

    await expect(
      updateLoan(scope, loan.id, { accountId: 'acc-a-eur' }),
    ).rejects.toThrow(/does not match account/)
    expect((await getLoan(scope, loan.id)).accountId).toBe('acc-a')
  })

  it('does not rewrite the currency under instalments that carry the old one', async () => {
    await seedEurRates()
    const loan = await createLoan(scope, importedInput())

    await expect(
      // A caller that casts around the type still meets the strict schema.
      updateLoan(scope, loan.id, { currencyCode: 'EUR' } as UpdateLoanInput),
    ).rejects.toThrow()
    const rows = await listInstalments(scope, { loanId: loan.id })
    expect(new Set(rows.map((row) => row.currencyCode))).toEqual(
      new Set(['PLN']),
    )
  })

  it('keeps openedOn out of the patch: every ref amount was priced at it', async () => {
    const loan = await createLoan(scope, importedInput())

    await expect(
      updateLoan(scope, loan.id, { openedOn: '2026-02-15' } as UpdateLoanInput),
    ).rejects.toThrow()
    expect((await getLoan(scope, loan.id)).openedOn).toBe('2026-01-15')
  })

  it('refuses a first payment or an end date before the stored openedOn with a typed error', async () => {
    const loan = await createLoan(scope, importedInput())

    await expect(
      updateLoan(scope, loan.id, { firstPaymentOn: '2026-01-01' }),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      updateLoan(scope, loan.id, { endsOn: '2026-01-01' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('a foreign-currency schedule is priced at openedOn', () => {
  it('accepts instalments dated beyond the newest rate and prices them all at the opening rate', async () => {
    await seedEurRates()
    const loan = await createLoan(scope, {
      ...importedInput(),
      currencyCode: 'EUR',
      principalMinor: 100_00,
      instalmentMinor: 10_00,
      instalments: [
        { dueOn: '2026-03-20', amountMinor: 10_00 },
        { dueOn: '2027-03-20', amountMinor: 10_00 },
      ],
    })

    const rows = await listInstalments(scope, { loanId: loan.id })
    expect(rows.map((row) => row.refAmountMinor)).toEqual([40_00, 40_00])
    expect(new Set(rows.map((row) => row.rateE10))).toEqual(
      new Set([loan.rateE10]),
    )
  })

  it('looks the opening rate up once for the whole schedule', async () => {
    await seedEurRates()
    executed.length = 0
    await createLoan(scope, {
      ...importedInput(),
      currencyCode: 'EUR',
      instalments: Array.from({ length: 12 }, (_, index) => ({
        dueOn: new Date(Date.UTC(2027, index, 20)).toISOString().slice(0, 10),
        amountMinor: 10_00,
      })),
    })

    const rateReads = executed.filter((query) =>
      query.startsWith('select "rate_e10" from "exchange_rates"'),
    )
    expect(rateReads.length).toBeLessThanOrEqual(4)
  })

  it('accepts a schedule of exactly MAX_INSTALMENTS rows', async () => {
    const loan = await createLoan(scope, {
      ...importedInput(),
      instalments: Array.from({ length: MAX_INSTALMENTS }, (_, index) => ({
        dueOn: new Date(Date.UTC(2027, 0, 1 + index))
          .toISOString()
          .slice(0, 10),
        amountMinor: 1_00,
      })),
    })

    expect((await listInstalments(scope, { loanId: loan.id })).length).toBe(
      MAX_INSTALMENTS,
    )
  })
})

describe('derived overdue is not stored', () => {
  it('is upcoming on the due day and overdue the day after', () => {
    expect(
      derivedInstalmentStatus('upcoming', '2026-03-20', '2026-03-20'),
    ).toBe('upcoming')
    expect(
      derivedInstalmentStatus('upcoming', '2026-03-20', '2026-03-21'),
    ).toBe('overdue')
    expect(derivedInstalmentStatus('paid', '2026-03-20', '2026-03-21')).toBe(
      'paid',
    )
  })
})

describe('getLoan', () => {
  it('returns the row the workspace created', async () => {
    const created = await createLoan(scope, importedInput())
    expect((await getLoan(scope, created.id)).id).toBe(created.id)
  })
})
