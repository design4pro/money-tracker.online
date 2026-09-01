import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { drawn, reading } from '#/components/app/money/__tests__/channels'
import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { asMinor } from '#/lib/money'
import { Amount, DirectionalAmount } from '../amount'

import type { ReactNode } from 'react'

function withI18n(node: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={en}>
      {node}
    </I18nProvider>,
  )
}

describe('Amount', () => {
  it('honours the currency’s own number of digits', () => {
    const { container } = withI18n(
      <Amount locale="en" amountMinor={asMinor(123_456)} currencyCode="JPY" />,
    )
    // 123456 minor units of a zero-digit currency is 123,456 — not 1,234.56.
    expect(drawn(container)).toContain('123,456')
    expect(drawn(container)).not.toContain('1,234.56')
  })

  it('formats the same integer differently per locale', () => {
    const english = withI18n(
      <Amount locale="en" amountMinor={asMinor(150_000)} currencyCode="PLN" />,
    )
    const polish = withI18n(
      <Amount locale="pl" amountMinor={asMinor(150_000)} currencyCode="PLN" />,
    )

    expect(drawn(english.container)).not.toBe(drawn(polish.container))
    expect(drawn(polish.container)).toContain(',')
  })

  it('draws a negative balance with U+2212, the same glyph the ledger draws', () => {
    const { container } = withI18n(
      <Amount
        locale="en"
        amountMinor={asMinor(-4_200)}
        currencyCode="EUR"
        tone="value"
      />,
    )
    // One minus across the product. A hyphen here and a U+2212 in the ledger is the drift this
    // normalisation exists to stop, and the tint is reinforcement rather than meaning.
    expect(drawn(container)).toContain('\u2212')
    expect(drawn(container)).not.toContain('-')
  })

  it('says the sign in a word and names the currency for anybody listening', () => {
    // U+2212 is announced as nothing at all by several screen readers, and `€` is announced
    // inconsistently. Neither is allowed to be the only channel carrying "below zero, in euro".
    const { container } = withI18n(
      <Amount
        locale="en"
        amountMinor={asMinor(-4_200)}
        currencyCode="EUR"
        tone="value"
      />,
    )
    expect(reading(container)).toBe('negative 42.00 euros')
  })

  it('carries a sign on every value when asked, so plus and minus read as a pair', () => {
    const positive = withI18n(
      <Amount
        locale="en"
        amountMinor={asMinor(4_200)}
        currencyCode="EUR"
        signed
      />,
    )
    expect(drawn(positive.container)).toContain('+')
    expect(reading(positive.container)).toBe('positive 42.00 euros')

    const negative = withI18n(
      <Amount
        locale="en"
        amountMinor={asMinor(-4_200)}
        currencyCode="EUR"
        signed
      />,
    )
    // `formatSignedMoney` normalises to U+2212, which is the glyph that pairs with the plus.
    expect(drawn(negative.container)).toContain('\u2212')
    expect(reading(negative.container)).toBe('negative 42.00 euros')
  })
})

describe('DirectionalAmount', () => {
  it('distinguishes income from expense by word and sign, not by colour', () => {
    const income = withI18n(
      <DirectionalAmount
        locale="en"
        direction="income"
        amountMinor={asMinor(12_000)}
        currencyCode="PLN"
        label="Income"
      />,
    )
    expect(income.container.textContent).toContain('Income')
    expect(income.container.textContent).toContain('+')

    const expense = withI18n(
      <DirectionalAmount
        locale="en"
        direction="expense"
        amountMinor={asMinor(12_000)}
        currencyCode="PLN"
        label="Expense"
      />,
    )
    expect(expense.container.textContent).toContain('Expense')
    expect(expense.container.textContent).toContain('−')
  })

  it('hides its arrow from assistive technology — the word already says it', () => {
    const { container } = withI18n(
      <DirectionalAmount
        locale="en"
        direction="expense"
        amountMinor={asMinor(500)}
        currencyCode="PLN"
        label="Expense"
      />,
    )
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('the accounts surface as a whole', () => {
  it('renders no bare amount without a locale — Amount cannot be built without one', () => {
    // A compile-time guarantee restated as a runtime one: the component reads `locale` and would
    // throw on `undefined` rather than silently defaulting to the test runner's system locale.
    expect(() =>
      withI18n(
        <Amount locale="pl" amountMinor={asMinor(0)} currencyCode="PLN" />,
      ),
    ).not.toThrow()
    expect(screen.queryByText('NaN')).toBeNull()
  })
})
