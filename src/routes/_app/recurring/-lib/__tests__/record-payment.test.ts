import { describe, expect, it } from 'vitest'

import { asMinor } from '#/lib/money'
import { newTransactionSearchSchema } from '#/routes/_app/transactions/-lib/new-search'

import { recordPaymentSearch } from '../record-payment'

const RENT = {
  id: 'ser-1',
  direction: 'expense',
  accountId: 'acc-1',
  categoryId: 'cat-1',
  payeeId: 'pay-1',
} as const

const MARCH = {
  periodStart: '2026-03-01',
  dueOn: '2026-03-05',
  expectedAmountMinor: asMinor(2_500_00),
  expectedCurrencyCode: 'PLN',
} as const

describe('recordPaymentSearch', () => {
  it('maps the period and its series onto the entry form, and a way back', () => {
    expect(recordPaymentSearch(RENT, MARCH, 'series')).toEqual({
      direction: 'expense',
      amount: 250_000,
      currency: 'PLN',
      date: '2026-03-05',
      account: 'acc-1',
      category: 'cat-1',
      payee: 'pay-1',
      returnTo: 'series',
      returnSeries: 'ser-1',
      returnPeriod: '2026-03-01',
    })
  })

  it('names the list as the way back when the person started there', () => {
    expect(recordPaymentSearch(RENT, MARCH, 'list').returnTo).toBe('list')
  })

  it("keeps the amount as integer minor units at the currency's own scale", () => {
    const yen = recordPaymentSearch(
      RENT,
      {
        ...MARCH,
        expectedAmountMinor: asMinor(1500),
        expectedCurrencyCode: 'JPY',
      },
      'series',
    )
    expect(yen.amount).toBe(1500)
    expect(yen.currency).toBe('JPY')
  })

  it('passes the due date through as a calendar date', () => {
    expect(recordPaymentSearch(RENT, MARCH, 'series').date).toBe('2026-03-05')
  })

  it('leaves out an account, category or payee the series does not have', () => {
    const search = recordPaymentSearch(
      { ...RENT, accountId: null, categoryId: null, payeeId: null },
      MARCH,
      'series',
    )
    expect(search).not.toHaveProperty('account')
    expect(search).not.toHaveProperty('category')
    expect(search).not.toHaveProperty('payee')
  })

  it('writes an address the entry form reads back unchanged', () => {
    const search = recordPaymentSearch(RENT, MARCH, 'list')
    expect(newTransactionSearchSchema.parse(search)).toEqual(search)
  })
})
