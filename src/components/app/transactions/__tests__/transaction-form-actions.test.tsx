import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { asCurrencyCode, asMinor } from '#/lib/money'

import { TransactionForm, emptyFormValues } from '../transaction-form'

import type { Catalogue } from '#/lib/i18n'
import type { TransactionReference } from '../types'

const REFERENCE: TransactionReference = {
  accounts: [
    {
      id: 'acc-pln',
      name: 'Current',
      currencyCode: asCurrencyCode('PLN'),
      isArchived: false,
    },
  ],
  accountGroups: [],
  categories: [],
  payees: [],
  tags: [],
  baseCurrencyCode: asCurrencyCode('PLN'),
}

afterEach(cleanup)

describe('TransactionForm phone actions', () => {
  it('pins Cancel and Save and add another above the bottom bar, without shrinking hitboxes', () => {
    render(
      <I18nProvider locale="en" messages={en as Catalogue}>
        <TransactionForm
          values={{
            ...emptyFormValues('acc-pln', '2026-03-15'),
            amountMinor: asMinor(1_000),
          }}
          onChange={() => {}}
          reference={REFERENCE}
          onSubmit={() => {}}
          onCancel={() => {}}
          isSubmitting={false}
          allowRepeat
          submitLabel="Save"
        />
      </I18nProvider>,
    )

    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const saveAndNew = screen.getByRole('button', {
      name: 'Save and add another',
    })
    const footer = cancel.parentElement?.parentElement
    expect(footer).toBeTruthy()
    expect(footer?.className).toContain(
      'max-lg:[@media(min-height:21rem)]:fixed',
    )
    expect(footer?.className).toContain(
      'max-lg:[@media(min-height:21rem)]:bottom-[calc(var(--nav-h)+var(--safe-bottom))]',
    )
    expect(footer?.contains(saveAndNew)).toBe(true)
    expect(cancel.className).toMatch(/\bh-11\b/)
    expect(saveAndNew.className).toMatch(/\bh-11\b/)
  })
})
