import { describe, expect, it } from 'vitest'

import { asCurrencyCode, asMinor } from '#/lib/money'

import {
  FILTER_EFFECT,
  categoryScopeOf,
  narrowExpectations,
  suppressesExpectations,
} from '../expectation-filters'

import type { ExpectationRow } from '#/components/app/transactions'
import type { TransactionFilters } from '#/server/repos/transaction-queries'

/**
 * Which of the ledger's filters the expected group honours, and which hide it.
 *
 * The group is narrowed in memory over the rows already fetched, so every case below is a plain
 * function over plain rows: no database, no scope. The two sets are exhaustive over the filter type
 * (`FILTER_EFFECT` is `satisfies Record<keyof TransactionFilters, ...>`), which is what makes a new
 * filter key a typecheck failure until somebody decides which set it belongs to.
 */

function expectation(over: Partial<ExpectationRow> = {}): ExpectationRow {
  return {
    kind: 'expectation',
    id: 'ser-1:2026-04-01',
    seriesId: 'ser-1',
    periodStart: '2026-04-01',
    seriesName: 'Rent',
    direction: 'expense',
    expectedAmountMinor: asMinor(250_000),
    currencyCode: asCurrencyCode('PLN'),
    dueOn: '2026-04-10',
    status: 'upcoming',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    payeeId: 'pay-1',
    ...over,
  }
}

function ids(rows: ReadonlyArray<ExpectationRow>): ReadonlyArray<string> {
  return rows.map((row) => row.id)
}

describe('the filters an expectation has no counterpart for', () => {
  const SUPPRESSING: ReadonlyArray<TransactionFilters> = [
    { accountGroupIds: ['grp-1'] },
    { tagIds: ['tag-1'] },
    { paymentMethods: ['card'] },
    { hasAttachment: true },
    { transferKinds: ['internal'] },
  ]

  it.each(SUPPRESSING)('suppresses the whole group under %j', (filters) => {
    expect(suppressesExpectations(filters)).toBe(true)
  })

  it('suppresses it for "has no attachment" as well, because absence is not a match', () => {
    expect(suppressesExpectations({ hasAttachment: false })).toBe(true)
  })

  it('does not suppress under the filters that narrow it', () => {
    expect(
      suppressesExpectations({
        text: 'rent',
        from: '2026-04-01',
        to: '2026-04-30',
        accountIds: ['acc-1'],
        categoryIds: ['cat-1'],
        payeeIds: ['pay-1'],
        direction: 'expense',
        amount: { currencyCode: 'PLN', minMinor: 1 },
      }),
    ).toBe(false)
    expect(suppressesExpectations({})).toBe(false)
  })

  it('classifies every filter key, exactly the five above as suppressing', () => {
    const suppressing = Object.entries(FILTER_EFFECT)
      .filter(([, effect]) => effect === 'suppresses')
      .map(([key]) => key)
      .sort()

    expect(suppressing).toEqual(
      [
        'accountGroupIds',
        'hasAttachment',
        'paymentMethods',
        'tagIds',
        'transferKinds',
      ].sort(),
    )
  })
})

describe('the filters an expectation can honour', () => {
  const rent = expectation()
  const salary = expectation({
    id: 'ser-2:2026-04-05',
    seriesId: 'ser-2',
    seriesName: 'Salary',
    direction: 'income',
    dueOn: '2026-04-05',
    expectedAmountMinor: asMinor(900_000),
    accountId: 'acc-2',
    categoryId: 'cat-2',
    payeeId: 'pay-2',
  })
  const rows = [rent, salary]

  it('returns every row when nothing narrows', () => {
    expect(ids(narrowExpectations(rows, {}))).toEqual(ids(rows))
  })

  it('narrows by text over the series name, ignoring case', () => {
    expect(ids(narrowExpectations(rows, { text: 'sAL' }))).toEqual([salary.id])
  })

  it('reads from and to against the due date, inclusive', () => {
    expect(ids(narrowExpectations(rows, { from: '2026-04-06' }))).toEqual([
      rent.id,
    ])
    expect(ids(narrowExpectations(rows, { to: '2026-04-05' }))).toEqual([
      salary.id,
    ])
    expect(
      ids(narrowExpectations(rows, { from: '2026-04-05', to: '2026-04-10' })),
    ).toEqual(ids(rows))
  })

  it('narrows by account, payee and direction', () => {
    expect(ids(narrowExpectations(rows, { accountIds: ['acc-2'] }))).toEqual([
      salary.id,
    ])
    expect(ids(narrowExpectations(rows, { payeeIds: ['pay-1'] }))).toEqual([
      rent.id,
    ])
    expect(ids(narrowExpectations(rows, { direction: 'income' }))).toEqual([
      salary.id,
    ])
  })

  it('never lets a null account, category or payee match a filter naming ids', () => {
    const bare = expectation({
      id: 'ser-3:2026-04-01',
      accountId: null,
      categoryId: null,
      payeeId: null,
    })

    expect(narrowExpectations([bare], { accountIds: ['acc-1'] })).toEqual([])
    expect(narrowExpectations([bare], { payeeIds: ['pay-1'] })).toEqual([])
    expect(
      narrowExpectations(
        [bare],
        { categoryIds: ['cat-1'] },
        new Set(['cat-1']),
      ),
    ).toEqual([])
  })

  it('matches a category through the resolved scope, which includes its children', () => {
    const child = expectation({
      id: 'ser-4:2026-04-01',
      categoryId: 'cat-child',
    })
    const scope = new Set(['cat-1', 'cat-child'])

    expect(
      ids(
        narrowExpectations(
          [rent, child, salary],
          { categoryIds: ['cat-1'] },
          scope,
        ),
      ),
    ).toEqual([rent.id, child.id])
  })

  it('applies the amount window only in the currency the row is in, and compares nothing else', () => {
    const eur = expectation({
      id: 'ser-5:2026-04-01',
      currencyCode: asCurrencyCode('EUR'),
      expectedAmountMinor: asMinor(50_000),
    })

    // 50 000 EUR-cents is inside a 10 000-60 000 window, and the PLN rows are not asked about it:
    // a window in one currency is never compared against another currency's minor units.
    expect(
      ids(
        narrowExpectations([rent, eur], {
          amount: { currencyCode: 'EUR', minMinor: 10_000, maxMinor: 60_000 },
        }),
      ),
    ).toEqual([eur.id])
    expect(
      ids(
        narrowExpectations([rent, eur], {
          amount: { currencyCode: 'PLN', minMinor: 200_000 },
        }),
      ),
    ).toEqual([rent.id])
    expect(
      narrowExpectations([rent], {
        amount: { currencyCode: 'USD', minMinor: 0 },
      }),
    ).toEqual([])
  })

  it('combines every narrowing with AND', () => {
    expect(
      narrowExpectations(rows, { direction: 'expense', accountIds: ['acc-2'] }),
    ).toEqual([])
  })
})

describe('categoryScopeOf', () => {
  const tree = [
    { id: 'food', parentId: null },
    { id: 'groceries', parentId: 'food' },
    { id: 'dining', parentId: 'food' },
    { id: 'rent', parentId: null },
  ]

  it('adds the children of every named category to the named ones', () => {
    expect([...categoryScopeOf(['food'], tree)].sort()).toEqual([
      'dining',
      'food',
      'groceries',
    ])
  })

  it('keeps a named leaf as it is and lets an unknown id stand', () => {
    expect([...categoryScopeOf(['rent', 'ghost'], tree)].sort()).toEqual([
      'ghost',
      'rent',
    ])
  })
})
