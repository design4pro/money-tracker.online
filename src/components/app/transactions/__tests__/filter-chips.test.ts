import { describe, expect, it } from 'vitest'

import En from '#/lib/i18n/messages/en'
import { createTranslator } from '#/lib/i18n'
import { asCurrencyCode } from '#/lib/money'

import { countActiveFilters, describeFilters } from '../filter-chips'
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
