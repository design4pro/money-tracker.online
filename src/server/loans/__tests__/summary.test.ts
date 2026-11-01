import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { asMinor } from '#/lib/money'
import {
  createBudgetWorld,
  seedTransaction,
} from '#/server/repos/__tests__/budget-harness'
import { setLimitResolver } from '#/server/repos/base'
import { createLoan, markInstalmentPaid } from '#/server/repos/loans'
import { summariseLoan, summariseLoans } from '#/server/loans/summary'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

let world: BudgetWorld

beforeEach(async () => {
  world = await createBudgetWorld()
  setLimitResolver(null)
})

afterEach(() => {
  setLimitResolver(null)
})

describe('summariseLoans', () => {
  it('sums remaining from unpaid instalment ref amounts, never a formatted subtraction', async () => {
    const loan = await createLoan(world.scope, {
      name: 'Loan A',
      lender: 'Lender A',
      currencyCode: 'PLN',
      instalmentMinor: 100_00,
      paymentDay: 20,
      openedOn: '2026-01-15',
      book: 'business',
      instalments: [
        { dueOn: '2026-02-20', amountMinor: 120_00 },
        { dueOn: '2026-03-20', amountMinor: 90_00 },
        { dueOn: '2026-04-20', amountMinor: 70_00, isBuyout: true },
      ],
    })
    await seedTransaction(world.db, {
      id: 'tx-a-loan',
      refAmountMinor: 120_00,
      bookedOn: '2026-02-20',
    })
    await markInstalmentPaid(world.scope, {
      loanId: loan.id,
      sequence: 1,
      transactionId: 'tx-a-loan',
    })

    const overview = await summariseLoans(world.scope, '2026-03-21', {})
    expect(overview.rows).toHaveLength(1)
    const row = overview.rows[0]
    expect(row?.paidMinor).toBe(asMinor(120_00))
    expect(row?.remainingMinor).toBe(asMinor(160_00))
    expect(row?.totalMinor).toBe(asMinor(280_00))
    expect(row?.overdueCount).toBe(1)
    expect(row?.isOverdue).toBe(true)
    expect(overview.remainingRefMinor).toBe(asMinor(160_00))
    expect(overview.overdueCount).toBe(1)
  })

  it('treats a paid-only schedule as remaining zero, not a dash or a guessed 0%', async () => {
    const loan = await createLoan(world.scope, {
      name: 'Loan B',
      currencyCode: 'PLN',
      instalmentMinor: 50_00,
      paymentDay: 1,
      openedOn: '2026-01-01',
      instalments: [{ dueOn: '2026-02-01', amountMinor: 50_00 }],
    })
    await seedTransaction(world.db, {
      id: 'tx-b-loan',
      refAmountMinor: 50_00,
      bookedOn: '2026-02-01',
    })
    await markInstalmentPaid(world.scope, {
      loanId: loan.id,
      sequence: 1,
      transactionId: 'tx-b-loan',
    })
    const overview = await summariseLoans(world.scope, '2026-03-01', {})
    expect(overview.rows[0]?.remainingMinor).toBe(asMinor(0))
    expect(overview.rows[0]?.ratio).toBe(1)
    expect(summariseLoan(overview.rows[0]!.loan, []).remainingMinor).toBe(
      asMinor(0),
    )
  })
})
