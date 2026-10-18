import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { asMinor } from '#/lib/money'
import {
  createBudgetWorld,
  seedTransaction,
} from '#/server/repos/__tests__/budget-harness'
import { setLimitResolver } from '#/server/repos/base'
import { createLoan, markInstalmentPaid } from '#/server/repos/loans'
import {
  CALENDAR_START_YEAR,
  assembleCalendar,
  obligationCalendarFor,
  yearsThrough,
} from '#/server/loans/calendar'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

describe('yearsThrough', () => {
  it('starts at 2025 and runs through today when nothing is due later', () => {
    expect(yearsThrough('2026-08-20', [])).toEqual([2025, 2026])
  })

  it('extends through the last due year, not a hard-coded 2028', () => {
    expect(yearsThrough('2026-01-01', ['2029-03-01', '2024-12-01'])).toEqual([
      2025, 2026, 2027, 2028, 2029,
    ])
  })
})

describe('assembleCalendar', () => {
  it('sums paid vs remaining from stored ref amounts, never a formatted subtraction', () => {
    const calendar = assembleCalendar(
      [
        {
          dueOn: '2026-02-20',
          derivedStatus: 'paid',
          refAmountMinor: asMinor(120_00),
        },
        {
          dueOn: '2026-02-20',
          derivedStatus: 'upcoming',
          refAmountMinor: asMinor(80_00),
        },
        {
          dueOn: '2026-07-20',
          derivedStatus: 'overdue',
          refAmountMinor: asMinor(50_00),
        },
        {
          dueOn: '2024-12-01',
          derivedStatus: 'upcoming',
          refAmountMinor: asMinor(9_99),
        },
      ],
      '2026-08-20',
      'PLN',
    )

    expect(calendar.years[0]).toBe(CALENDAR_START_YEAR)
    expect(calendar.cells).toHaveLength(24)
    const february = calendar.cells.find((cell) => cell.key === '2026-02')
    expect(february?.paidRefMinor).toBe(asMinor(120_00))
    expect(february?.remainingRefMinor).toBe(asMinor(80_00))
    expect(february?.overdueCount).toBe(0)
    const july = calendar.cells.find((cell) => cell.key === '2026-07')
    expect(july?.paidRefMinor).toBe(asMinor(0))
    expect(july?.remainingRefMinor).toBe(asMinor(50_00))
    expect(july?.overdueCount).toBe(1)
    const empty = calendar.cells.find((cell) => cell.key === '2025-01')
    expect(empty?.paidRefMinor).toBe(asMinor(0))
    expect(empty?.remainingRefMinor).toBe(asMinor(0))
    expect(
      calendar.cells.find((cell) => cell.key === '2024-12'),
    ).toBeUndefined()
  })
})

let world: BudgetWorld

beforeEach(async () => {
  world = await createBudgetWorld()
  setLimitResolver(null)
})

afterEach(() => {
  setLimitResolver(null)
})

describe('obligationCalendarFor', () => {
  it('keeps the book filter on the loan, not on a mixed total', async () => {
    const business = await createLoan(world.scope, {
      name: 'Loan A',
      currencyCode: 'PLN',
      instalmentMinor: 100_00,
      paymentDay: 20,
      openedOn: '2026-01-15',
      book: 'business',
      instalments: [{ dueOn: '2026-02-20', amountMinor: 100_00 }],
    })
    await createLoan(world.scope, {
      name: 'Loan B',
      currencyCode: 'PLN',
      instalmentMinor: 40_00,
      paymentDay: 15,
      openedOn: '2026-01-15',
      book: 'personal',
      instalments: [{ dueOn: '2026-02-15', amountMinor: 40_00 }],
    })
    await seedTransaction(world.db, {
      id: 'tx-cal-a',
      refAmountMinor: 100_00,
      bookedOn: '2026-02-20',
    })
    await markInstalmentPaid(world.scope, {
      loanId: business.id,
      sequence: 1,
      transactionId: 'tx-cal-a',
    })

    const all = await obligationCalendarFor(world.scope, '2026-03-01', {})
    const februaryAll = all.cells.find((cell) => cell.key === '2026-02')
    expect(februaryAll?.paidRefMinor).toBe(asMinor(100_00))
    expect(februaryAll?.remainingRefMinor).toBe(asMinor(40_00))

    const businessOnly = await obligationCalendarFor(
      world.scope,
      '2026-03-01',
      {
        book: 'business',
      },
    )
    const februaryBusiness = businessOnly.cells.find(
      (cell) => cell.key === '2026-02',
    )
    expect(februaryBusiness?.paidRefMinor).toBe(asMinor(100_00))
    expect(februaryBusiness?.remainingRefMinor).toBe(asMinor(0))
  })
})
