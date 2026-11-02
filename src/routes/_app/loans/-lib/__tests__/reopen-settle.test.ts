import { describe, expect, it } from 'vitest'

import { asCurrencyCode, asMinor, asRateE10 } from '#/lib/money'

import { findReopenedInstalment } from '../reopen-settle'

import type { InstalmentView } from '#/server/repos/loans'

function row(
  sequence: number,
  derivedStatus: InstalmentView['derivedStatus'],
): InstalmentView {
  return {
    organizationId: 'org-a',
    loanId: 'loan-a',
    sequence,
    dueOn: '2026-08-20',
    amountMinor: asMinor(1500),
    currencyCode: asCurrencyCode('JPY'),
    refAmountMinor: asMinor(1500),
    rateE10: asRateE10(10_000_000_000),
    principalMinor: null,
    interestMinor: null,
    closingBalanceMinor: null,
    isBuyout: false,
    status: derivedStatus === 'paid' ? 'paid' : 'upcoming',
    settledTransactionId: derivedStatus === 'paid' ? 'tx-a' : null,
    note: null,
    createdAt: new Date('2026-01-15T00:00:00.000Z'),
    updatedAt: new Date('2026-01-15T00:00:00.000Z'),
    derivedStatus,
  }
}

describe('findReopenedInstalment', () => {
  const schedule = [row(1, 'paid'), row(2, 'upcoming'), row(3, 'overdue')]

  it('names the unpaid instalment the address asked for', () => {
    expect(findReopenedInstalment(schedule, 2)?.sequence).toBe(2)
    expect(findReopenedInstalment(schedule, 3)?.derivedStatus).toBe('overdue')
  })

  it('ignores a paid row, a missing sequence and a blank address', () => {
    expect(findReopenedInstalment(schedule, 1)).toBeNull()
    expect(findReopenedInstalment(schedule, 99)).toBeNull()
    expect(findReopenedInstalment(schedule, undefined)).toBeNull()
  })
})
