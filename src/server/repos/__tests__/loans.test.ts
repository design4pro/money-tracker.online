/**
 * The loan register: imported schedules, quota, paid-requires-a-transaction, and the
 * terms-locked refusal.
 *
 * A real SQLite built from `drizzle/*.sql`. Figures are synthetic (Loan A, Lender A) — never
 * owner amounts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loanInstalments } from '#/server/db/schema'
import { createBudgetWorld, seedTransaction } from './budget-harness'

import { setLimitResolver } from '../base'
import {
  LoanInstalmentSettledError,
  LoanTermsLockedError,
  createLoan,
  deleteLoan,
  derivedInstalmentStatus,
  getLoan,
  listInstalments,
  listLoans,
  markInstalmentPaid,
  updateLoan,
} from '../loans'

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
