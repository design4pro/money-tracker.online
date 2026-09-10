import { describe, expect, it } from 'vitest'

import En from '#/lib/i18n/messages/en'
import { createTranslator } from '#/lib/i18n'
import { asCurrencyCode } from '#/lib/money'

import {
  countActiveFilters,
  describeFilters,
  isSameFilterView,
} from '../filter-chips'
import { emptyReference } from '../types'

import type { LedgerFilters, TransactionReference } from '../types'

/**
 * A filter the reader cannot see is a filter they will blame on the data.
 *
 * These assertions are about the two properties a chip has to hold: its label names its **value**,
 * and removing it hands back a filter set with that narrowing — and only that narrowing — gone.
 */

const t = createTranslator('en', En)
const PLN = asCurrencyCode('PLN')

const reference: TransactionReference = {
  ...emptyReference(PLN),
  accounts: [
    { id: 'acc_1', name: 'Wallet', currencyCode: PLN, isArchived: false },
    { id: 'acc_2', name: 'Cash', currencyCode: PLN, isArchived: false },
  ],
}

function chips(filters: LedgerFilters) {
  return describeFilters({ filters, reference, t, locale: 'en' })
}

describe('countActiveFilters', () => {
  it('is zero for an unnarrowed ledger', () => {
    expect(countActiveFilters({})).toBe(0)
  })

  it('counts the amount window once, however many bounds it has', () => {
    expect(countActiveFilters({ amountMinMinor: 100 })).toBe(1)
    expect(
      countActiveFilters({ amountMinMinor: 100, amountMaxMinor: 900 }),
    ).toBe(1)
  })

  it('counts every other narrowing separately', () => {
    expect(
      countActiveFilters({
        text: 'lidl',
        accountIds: ['acc_1'],
        direction: 'expense',
        hasAttachment: true,
      }),
    ).toBe(4)
  })
})

describe('describeFilters', () => {
  it('puts the value in the label, so the remove button reads on its own', () => {
    const [chip] = chips({ accountIds: ['acc_1', 'acc_2'] })
    expect(chip.label).toContain('Wallet, Cash')
  })

  it('falls back to a word rather than printing a raw id', () => {
    const [chip] = chips({ accountIds: ['acc_missing'] })
    expect(chip.label).toContain(t('common.unknown'))
    expect(chip.label).not.toContain('acc_missing')
  })

  it('removes one narrowing and leaves the rest in force', () => {
    const [chip] = chips({ accountIds: ['acc_1'], direction: 'expense' })
    expect(chip.next).toEqual({ direction: 'expense' })
  })

  it('takes the whole amount window off together', () => {
    const chip = chips({
      amountCurrency: 'PLN',
      amountMinMinor: 1000,
      amountMaxMinor: 5000,
      text: 'fuel',
    }).find((entry) => entry.id === 'amount')
    expect(chip?.next).toEqual({ text: 'fuel' })
  })

  it('says which side of the date range is open', () => {
    const [chip] = chips({ from: '2026-03-01' })
    expect(chip.label).toContain(t('transactions.chip.anyDate'))
  })

  it('describes both states of the receipt filter', () => {
    expect(chips({ hasAttachment: true })[0].label).toBe(
      t('transactions.chip.withReceipt'),
    )
    expect(chips({ hasAttachment: false })[0].label).toBe(
      t('transactions.chip.withoutReceipt'),
    )
  })
})

/**
 * The comparison behind the filter panel's unsaved-changes guard.
 *
 * The panel's draft is rebuilt from `filters` at every open, so a reference comparison would call
 * an untouched panel dirty and ask about work nobody did. The array fields are the other half: an
 * id list is a new array on every edit, and one that ends up holding the same ids is not a change.
 */
describe('isSameFilterView', () => {
  it('reads a rebuilt but equal filter set as the same view', () => {
    const opened: LedgerFilters = {
      text: 'fuel',
      accountIds: ['acc_1', 'acc_2'],
      paymentMethods: ['card'],
    }
    expect(
      isSameFilterView(opened, {
        text: 'fuel',
        accountIds: ['acc_1', 'acc_2'],
        paymentMethods: ['card'],
      }),
    ).toBe(true)
  })

  it('treats an absent key and an undefined one as the same narrowing', () => {
    expect(isSameFilterView({ text: 'fuel' }, { text: 'fuel', from: undefined }))
      .toBe(true)
  })

  it('sees a changed scalar', () => {
    expect(isSameFilterView({ text: 'fuel' }, { text: 'rent' })).toBe(false)
    expect(isSameFilterView({}, { hasAttachment: false })).toBe(false)
  })

  for (const key of [
    'accountIds',
    'accountGroupIds',
    'categoryIds',
    'tagIds',
    'payeeIds',
  ] as const) {
    it(`compares ${key} element-wise`, () => {
      expect(isSameFilterView({ [key]: ['a'] }, { [key]: ['a'] })).toBe(true)
      expect(isSameFilterView({ [key]: ['a'] }, { [key]: ['b'] })).toBe(false)
      expect(isSameFilterView({ [key]: ['a'] }, { [key]: ['a', 'b'] })).toBe(
        false,
      )
    })
  }

  it('compares paymentMethods element-wise, order included', () => {
    expect(
      isSameFilterView(
        { paymentMethods: ['card', 'cash'] },
        { paymentMethods: ['card', 'cash'] },
      ),
    ).toBe(true)
    expect(
      isSameFilterView(
        { paymentMethods: ['card', 'cash'] },
        { paymentMethods: ['cash', 'card'] },
      ),
    ).toBe(false)
  })

  it('sees a narrowing that was added or dropped', () => {
    expect(isSameFilterView({}, { accountIds: ['acc_1'] })).toBe(false)
    expect(isSameFilterView({ accountIds: ['acc_1'] }, {})).toBe(false)
  })
})
