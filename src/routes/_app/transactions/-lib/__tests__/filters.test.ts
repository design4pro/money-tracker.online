import { describe, expect, it } from 'vitest'

import {
  EMPTY_SEARCH,
  toFilters,
  toQueryFilters,
  toSearch,
  toSort,
  transactionSearchSchema,
} from '../filters'

import type { LedgerFilters } from '#/components/app/transactions'

/**
 * The address bar is the state, so these are the properties the back button depends on.
 *
 * `filters → search → filters` has to be the identity, a hand-edited link has to render the ledger
 * it can rather than an error screen, and an empty id list has to leave no trace at all — the
 * repository rejects `[]` rather than reading it as "no narrowing".
 */

const FULL: LedgerFilters = {
  text: 'lidl',
  from: '2026-03-01',
  to: '2026-03-31',
  accountIds: ['acc_1', 'acc_2'],
  accountGroupIds: ['grp_1'],
  categoryIds: ['cat_1'],
  tagIds: ['tag_1'],
  payeeIds: ['pay_1'],
  direction: 'expense',
  paymentMethods: ['card', 'cash'],
  amountCurrency: 'PLN',
  amountMinMinor: 1000,
  amountMaxMinor: 250000,
  hasAttachment: true,
}

describe('the search round trip', () => {
  it('is the identity on a filter set the screen can produce', () => {
    const sort = { field: 'payee', direction: 'asc' } as const
    const search = toSearch(FULL, sort)
    expect(toFilters(search)).toEqual(FULL)
    expect(toSort(search)).toEqual(sort)
  })

  it('leaves no parameter for a narrowing that is not in force', () => {
    const search = toSearch({}, { field: 'bookedOn', direction: 'desc' })
    // Through JSON because that is what "leaves no parameter" means: a key whose value is
    // `undefined` is a key the router never writes into the query string.
    expect(JSON.parse(JSON.stringify(search))).toEqual({})
    expect(toFilters(EMPTY_SEARCH)).toEqual({})
  })

  it('writes multi-value narrowings as a readable comma list', () => {
    const search = toSearch(FULL, { field: 'bookedOn', direction: 'desc' })
    expect(search.accounts).toBe('acc_1,acc_2')
    expect(search.methods).toBe('card,cash')
  })

  it('drops an amount window whose bounds have both gone', () => {
    const search = toSearch(
      { amountCurrency: 'PLN' },
      { field: 'bookedOn', direction: 'desc' },
    )
    expect(search.currency).toBeUndefined()
  })

  it('reads the default sort as the absence of both parameters', () => {
    expect(toSort({})).toEqual({ field: 'bookedOn', direction: 'desc' })
  })
})

describe('a link that has been edited by hand', () => {
  it('narrows by what survived and never throws', () => {
    const parsed = transactionSearchSchema.parse({
      q: 'fuel',
      from: 'the-third-of-march',
      direction: 'sideways',
      min: 'lots',
      receipt: 'true',
      sort: 'colour',
      utm_source: 'newsletter',
    })
    expect(parsed.q).toBe('fuel')
    expect(parsed.from).toBeUndefined()
    expect(parsed.direction).toBeUndefined()
    expect(parsed.min).toBeUndefined()
    expect(parsed.receipt).toBeUndefined()
    expect(parsed.sort).toBeUndefined()
    expect('utm_source' in parsed).toBe(false)
  })

  it('keeps only the payment methods the vocabulary has', () => {
    expect(
      toFilters({ methods: 'card,carrier-pigeon' }).paymentMethods,
    ).toEqual(['card'])
    expect(
      toFilters({ methods: 'carrier-pigeon' }).paymentMethods,
    ).toBeUndefined()
  })

  it('reads an empty id list as no narrowing at all', () => {
    expect(toFilters({ accounts: ',, ,' }).accountIds).toBeUndefined()
  })

  it('normalises a currency written in lower case', () => {
    expect(transactionSearchSchema.parse({ currency: 'pln' }).currency).toBe(
      'PLN',
    )
  })
})

describe('toQueryFilters', () => {
  it('nests the amount window and names its currency', () => {
    expect(
      toQueryFilters({ amountMinMinor: 1000, amountMaxMinor: 5000 }, 'EUR')
        .amount,
    ).toEqual({ currencyCode: 'EUR', minMinor: 1000, maxMinor: 5000 })
    expect(
      toQueryFilters({ amountCurrency: 'PLN', amountMinMinor: 1000 }, 'EUR')
        .amount,
    ).toEqual({ currencyCode: 'PLN', minMinor: 1000, maxMinor: undefined })
  })

  it('omits an empty id list rather than sending one the schema rejects', () => {
    const query = toQueryFilters({ accountIds: [], tagIds: ['tag_1'] }, 'PLN')
    expect('accountIds' in query).toBe(false)
    expect(query.tagIds).toEqual(['tag_1'])
  })

  it('carries nothing at all for an unnarrowed ledger', () => {
    expect(toQueryFilters({}, 'PLN')).toEqual({})
  })
})
