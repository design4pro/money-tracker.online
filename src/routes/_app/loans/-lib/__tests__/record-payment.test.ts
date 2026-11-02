import { describe, expect, it } from 'vitest'

import { asMinor } from '#/lib/money'
import { newTransactionSearchSchema } from '#/routes/_app/transactions/-lib/new-search'

import { recordLoanPaymentSearch } from '../record-payment'

const LOAN = {
  id: 'loan-a',
  accountId: 'acc-a',
} as const

const AUGUST = {
  sequence: 3,
  dueOn: '2026-08-20',
  amountMinor: asMinor(1500),
  currencyCode: 'JPY',
} as const

describe('recordLoanPaymentSearch', () => {
  it('maps the instalment onto the entry form, and a way back to this schedule', () => {
    expect(recordLoanPaymentSearch(LOAN, AUGUST)).toEqual({
      direction: 'expense',
      amount: 1500,
      currency: 'JPY',
      date: '2026-08-20',
      account: 'acc-a',
      returnTo: 'loan',
      returnLoan: 'loan-a',
      returnSequence: 3,
    })
  })

  it('leaves the due date out when the instalment is not due yet, so the form opens on today', () => {
    const early = recordLoanPaymentSearch(LOAN, AUGUST, '2026-08-19')
    expect(early).not.toHaveProperty('date')
    expect(recordLoanPaymentSearch(LOAN, AUGUST, '2026-08-20').date).toBe(
      '2026-08-20',
    )
  })

  it('leaves out an account the liability does not have', () => {
    const search = recordLoanPaymentSearch({ ...LOAN, accountId: null }, AUGUST)
    expect(search).not.toHaveProperty('account')
  })

  it('keeps the amount as integer minor units at the currency’s own scale', () => {
    const zloty = recordLoanPaymentSearch(LOAN, {
      ...AUGUST,
      amountMinor: asMinor(250_000),
      currencyCode: 'PLN',
    })
    expect(zloty.amount).toBe(250_000)
    expect(zloty.currency).toBe('PLN')
  })

  it('writes an address the entry form reads back unchanged', () => {
    const search = recordLoanPaymentSearch(LOAN, AUGUST)
    expect(newTransactionSearchSchema.parse(search)).toEqual(search)
  })
})
