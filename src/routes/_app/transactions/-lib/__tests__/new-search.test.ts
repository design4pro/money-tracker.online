import { describe, expect, it } from 'vitest'

import { asCurrencyCode } from '#/lib/money'

import {
  applyPrefill,
  newTransactionSearchSchema,
  returnTargetOf,
} from '../new-search'

import type {
  TransactionFormValues,
  TransactionReference,
} from '#/components/app/transactions'

/**
 * `/transactions/new` takes a starting point and a way back from its address, and the address is
 * written by anybody: a link, a bookmark, a hand edit. These are the properties that make that
 * safe - a malformed parameter degrades to the blank form, an id from the URL is applied only when
 * the workspace already knows it, the amount is applied only where it means what it says, and the
 * way back can only ever name a screen of this app.
 */

const parse = (input: Record<string, unknown>) =>
  newTransactionSearchSchema.parse(input)

const REFERENCE: TransactionReference = {
  accounts: [
    {
      id: 'acc-pln',
      name: 'Current',
      currencyCode: asCurrencyCode('PLN'),
      isArchived: false,
    },
    {
      id: 'acc-jpy',
      name: 'Yen wallet',
      currencyCode: asCurrencyCode('JPY'),
      isArchived: false,
    },
    {
      id: 'acc-kwd',
      name: 'Dinar',
      currencyCode: asCurrencyCode('KWD'),
      isArchived: false,
    },
  ],
  accountGroups: [],
  categories: [{ id: 'cat-1', name: 'Housing', parentId: null, color: '#000' }],
  payees: [{ id: 'pay-1', name: 'Landlord' }],
  tags: [],
  baseCurrencyCode: asCurrencyCode('PLN'),
}

const BLANK: TransactionFormValues = {
  direction: 'expense',
  amountMinor: null,
  accountId: 'acc-pln',
  bookedOn: '2026-10-04',
  categoryId: null,
  payeeId: null,
  paymentMethod: null,
  note: '',
  isPlanned: false,
}

describe('newTransactionSearchSchema', () => {
  it('keeps the existing `from` parameter as it was', () => {
    expect(parse({ from: ' tx-1 ' }).from).toBe('tx-1')
    expect(parse({ from: '' }).from).toBeUndefined()
    expect(parse({ from: 'x'.repeat(65) }).from).toBeUndefined()
  })

  it('accepts a well-formed prefill', () => {
    expect(
      parse({
        direction: 'expense',
        amount: 250000,
        currency: 'pln',
        date: '2026-03-01',
        account: 'acc-pln',
        category: 'cat-1',
        payee: 'pay-1',
      }),
    ).toEqual({
      direction: 'expense',
      amount: 250000,
      currency: 'PLN',
      date: '2026-03-01',
      account: 'acc-pln',
      category: 'cat-1',
      payee: 'pay-1',
    })
  })

  it('reads the amount as integer minor units and nothing else', () => {
    expect(parse({ amount: '250000' }).amount).toBe(250000)
    for (const bad of [
      0,
      -5,
      12.5,
      '12.50',
      '1e3',
      1e20,
      2 ** 53,
      'abc',
      true,
      null,
      '',
    ]) {
      expect(parse({ amount: bad }).amount).toBeUndefined()
    }
  })

  it('drops a currency that is not a three-letter code', () => {
    for (const bad of ['PL', 'PLNN', 'P1N', '', 12]) {
      expect(parse({ currency: bad }).currency).toBeUndefined()
    }
  })

  it('drops a date that is not a calendar date', () => {
    for (const bad of [
      '2026-02-30',
      '2026-13-01',
      '01/03/2026',
      '2026-03-01T00:00:00Z',
      '',
    ]) {
      expect(parse({ date: bad }).date).toBeUndefined()
    }
  })

  it('drops a direction outside income and expense, and a blank or oversized id', () => {
    expect(parse({ direction: 'transfer' }).direction).toBeUndefined()
    expect(parse({ account: '   ' }).account).toBeUndefined()
    expect(parse({ category: 'c'.repeat(65) }).category).toBeUndefined()
    expect(parse({ payee: 42 }).payee).toBeUndefined()
  })

  it('never carries a planned flag, whatever the URL says', () => {
    const parsed = parse({ isPlanned: true, planned: 'yes', amount: 100 })
    expect(parsed).not.toHaveProperty('isPlanned')
    expect(parsed).not.toHaveProperty('planned')
  })

  it('cannot throw: a hostile query string degrades to the blank form', () => {
    const parsed = parse({
      direction: {},
      amount: [],
      currency: {},
      date: 7,
      account: {},
      returnTo: 'https://evil.example',
      returnPeriod: '/accounts',
    })
    expect(Object.values(parsed).every((value) => value === undefined)).toBe(
      true,
    )
  })
})

describe('returnTargetOf', () => {
  const series = { returnTo: 'series', returnSeries: 'ser-1' } as const

  it('names a screen and the period it came from', () => {
    expect(
      returnTargetOf(parse({ ...series, returnPeriod: '2026-03-01' })),
    ).toEqual({ to: 'series', seriesId: 'ser-1', periodStart: '2026-03-01' })
    expect(
      returnTargetOf(
        parse({
          returnTo: 'list',
          returnSeries: 'ser-1',
          returnPeriod: '2026-03-01',
        }),
      ),
    ).toEqual({ to: 'list', seriesId: 'ser-1', periodStart: '2026-03-01' })
    expect(
      returnTargetOf(
        parse({
          returnTo: 'planned',
          returnSeries: 'ser-1',
          returnPeriod: '2026-03-01',
        }),
      ),
    ).toEqual({ to: 'planned', seriesId: 'ser-1', periodStart: '2026-03-01' })
  })

  it('is undefined unless every part is present', () => {
    expect(returnTargetOf(parse({}))).toBeUndefined()
    expect(returnTargetOf(parse(series))).toBeUndefined()
    expect(
      returnTargetOf(
        parse({ returnSeries: 'ser-1', returnPeriod: '2026-03-01' }),
      ),
    ).toBeUndefined()
    expect(
      returnTargetOf(parse({ returnTo: 'series', returnPeriod: '2026-03-01' })),
    ).toBeUndefined()
  })

  it.each([
    'https://evil.example',
    '//evil.example',
    '/accounts',
    'javascript:1',
  ])('ignores %s as a destination', (value) => {
    expect(
      returnTargetOf(
        parse({
          returnTo: value,
          returnSeries: 'ser-1',
          returnPeriod: '2026-03-01',
        }),
      ),
    ).toBeUndefined()
  })
})

describe('applyPrefill', () => {
  const full = {
    direction: 'income',
    amount: 250000,
    currency: 'PLN',
    date: '2026-03-01',
    account: 'acc-pln',
    category: 'cat-1',
    payee: 'pay-1',
  } as const

  it('fills every field the period carries', () => {
    expect(applyPrefill(BLANK, parse(full), REFERENCE)).toEqual({
      ...BLANK,
      direction: 'income',
      amountMinor: 250000,
      bookedOn: '2026-03-01',
      accountId: 'acc-pln',
      categoryId: 'cat-1',
      payeeId: 'pay-1',
    })
  })

  it('is the blank form when there is nothing to apply', () => {
    expect(applyPrefill(BLANK, parse({}), REFERENCE)).toEqual(BLANK)
  })

  it('leaves the default account when the id is foreign or garbage', () => {
    for (const account of ['acc-of-another-workspace', '<script>', 'x']) {
      const values = applyPrefill(BLANK, parse({ ...full, account }), REFERENCE)
      expect(values.accountId).toBe(BLANK.accountId)
    }
  })

  it('leaves a category or payee the workspace does not know unset', () => {
    const values = applyPrefill(
      BLANK,
      parse({ ...full, category: 'cat-foreign', payee: 'pay-foreign' }),
      REFERENCE,
    )
    expect(values.categoryId).toBeNull()
    expect(values.payeeId).toBeNull()
  })

  it('invents nothing for an account, category or payee the series does not have', () => {
    const values = applyPrefill(
      BLANK,
      parse({ direction: 'expense', amount: 1000, currency: 'PLN' }),
      REFERENCE,
    )
    expect(values.accountId).toBe(BLANK.accountId)
    expect(values.categoryId).toBeNull()
    expect(values.payeeId).toBeNull()
  })

  it('leaves the amount empty when the account is in another currency', () => {
    const values = applyPrefill(
      BLANK,
      parse({ ...full, account: 'acc-jpy' }),
      REFERENCE,
    )
    expect(values.accountId).toBe('acc-jpy')
    expect(values.amountMinor).toBeNull()
  })

  it('leaves the amount empty when the account fell back to the default in another currency', () => {
    const values = applyPrefill(
      BLANK,
      parse({ ...full, account: 'acc-foreign', currency: 'EUR' }),
      REFERENCE,
    )
    expect(values.amountMinor).toBeNull()
  })

  it('leaves the amount empty when the period names no currency', () => {
    expect(
      applyPrefill(BLANK, parse({ amount: 1000 }), REFERENCE).amountMinor,
    ).toBeNull()
  })

  it.each([
    ['JPY', 'acc-jpy', 1500],
    ['KWD', 'acc-kwd', 1_500_123],
    ['PLN', 'acc-pln', 250_000],
  ])(
    'round-trips %s as the same integer minor units, whatever its scale',
    (currency, account, amount) => {
      const values = applyPrefill(
        BLANK,
        parse({ account, currency, amount }),
        REFERENCE,
      )
      expect(values.amountMinor).toBe(amount)
    },
  )

  it('never marks the entry planned', () => {
    const values = applyPrefill(
      BLANK,
      parse({ ...full, isPlanned: true }),
      REFERENCE,
    )
    expect(values.isPlanned).toBe(false)
  })
})
