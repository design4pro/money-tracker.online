import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'
import { asCurrencyCode } from '#/lib/money'

import {
  droppedAmountCurrency,
  newTransactionSearchSchema,
} from '#/routes/_app/transactions/-lib/new-search'

import { TransactionForm, emptyFormValues } from '../transaction-form'

import type { Catalogue } from '#/lib/i18n'
import type { TransactionFormValues } from '../transaction-form'
import type { TransactionReference } from '../types'

/**
 * The note under the amount when the address's amount was dropped: it rides the amount field's
 * description, so it is read when the field takes focus on arrival and never through a live
 * region. Both notes can apply at once (an EUR account on a PLN-base workspace, opened from a PLN
 * period), and they share the one description slot as separate elements.
 */

const REFERENCE: TransactionReference = {
  accounts: [
    {
      id: 'acc-pln',
      name: 'Current',
      currencyCode: asCurrencyCode('PLN'),
      isArchived: false,
    },
    {
      id: 'acc-eur',
      name: 'Euro',
      currencyCode: asCurrencyCode('EUR'),
      isArchived: false,
    },
  ],
  accountGroups: [],
  categories: [],
  payees: [],
  tags: [],
  baseCurrencyCode: asCurrencyCode('PLN'),
}

function renderForm(
  locale: 'en' | 'pl',
  accountId: string,
  amountNote: string | undefined,
) {
  return render(
    <I18nProvider
      locale={locale}
      messages={(locale === 'pl' ? pl : en) as Catalogue}
    >
      <TransactionForm
        values={emptyFormValues(accountId, '2026-03-15')}
        onChange={() => {}}
        reference={REFERENCE}
        onSubmit={() => {}}
        onCancel={() => {}}
        isSubmitting={false}
        submitLabel="Save"
        amountNote={amountNote}
      />
    </I18nProvider>,
  )
}

/** The text of every element the amount input is described by, one entry each. */
function descriptionParts(): string[] {
  const input = screen.getByRole('textbox', { name: /^(Amount|Kwota)/ })
  const ids = (input.getAttribute('aria-describedby') ?? '').split(/\s+/)
  return ids.flatMap((id) => {
    const element = document.getElementById(id)
    return element === null
      ? []
      : [...element.children].map((child) => child.textContent ?? '')
  })
}

describe('TransactionForm amount note', () => {
  afterEach(cleanup)

  it('puts the note in the amount description and nowhere live', () => {
    const { container } = renderForm('en', 'acc-pln', 'Note text')

    expect(descriptionParts()).toEqual(['Note text'])
    expect(container.querySelector('[aria-live]')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('renders no description when neither note applies', () => {
    renderForm('en', 'acc-pln', undefined)

    expect(descriptionParts()).toEqual([])
  })

  it('renders the conversion note and the dropped-amount note as two elements', () => {
    renderForm('pl', 'acc-eur', 'Note text')

    const parts = descriptionParts()
    expect(parts).toHaveLength(2)
    expect(parts).toContain('Note text')
    expect(parts.some((part) => part.includes('Euro'))).toBe(true)
  })
})

/**
 * The route's wiring in miniature: the note is derived from the values on every render, so what
 * the person does to the form is what takes it away.
 */
function Wired() {
  const search = newTransactionSearchSchema.parse({
    amount: 1000,
    currency: 'EUR',
  })
  const [values, setValues] = useState<TransactionFormValues>(() =>
    emptyFormValues('acc-pln', '2026-03-15'),
  )
  const dropped = droppedAmountCurrency(search, REFERENCE, values)
  return (
    <TransactionForm
      values={values}
      onChange={setValues}
      reference={REFERENCE}
      onSubmit={() => {}}
      onCancel={() => {}}
      isSubmitting={false}
      submitLabel="Save"
      autoFocusAmount
      amountNote={dropped === undefined ? undefined : `dropped ${dropped}`}
    />
  )
}

describe('the note across an entry', () => {
  afterEach(cleanup)

  it('is described on arrival, with focus on the amount, and clears once an amount is typed', async () => {
    render(
      <I18nProvider locale="en" messages={en as Catalogue}>
        <Wired />
      </I18nProvider>,
    )
    const amount = screen.getByRole('textbox', { name: /^Amount/ })

    expect(document.activeElement).toBe(amount)
    expect(descriptionParts()).toEqual(['dropped EUR'])

    await userEvent.type(amount, '12')
    expect(descriptionParts()).toEqual([])
  })
})
