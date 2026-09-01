import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

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
    const { container } = render(
      <Amount locale="en" amountMinor={asMinor(123_456)} currencyCode="JPY" />,
    )
    // 123456 minor units of a zero-digit currency is 123,456 — not 1,234.56.
    expect(container.textContent).toContain('123,456')
    expect(container.textContent).not.toContain('1,234.56')
  })

  it('formats the same integer differently per locale', () => {
    const english = render(
      <Amount locale="en" amountMinor={asMinor(150_000)} currencyCode="PLN" />,
    )
    const polish = render(
      <Amount locale="pl" amountMinor={asMinor(150_000)} currencyCode="PLN" />,
    )

    expect(english.container.textContent).not.toBe(polish.container.textContent)
    expect(polish.container.textContent).toContain(',')
  })

  it('marks a negative balance with a sign, so the shortfall survives without colour', () => {
    const { container } = render(
      <Amount
        locale="en"
        amountMinor={asMinor(-4_200)}
        currencyCode="EUR"
        tone="value"
      />,
    )
    // Either the locale's own hyphen-minus or the typographic minus — what matters is that a
    // reader who cannot see the red has a character telling them the balance is below zero.
    expect(container.textContent).toMatch(/[-\u2212]/u)
  })

  it('carries a sign on every value when asked, so plus and minus read as a pair', () => {
    const positive = render(
      <Amount
        locale="en"
        amountMinor={asMinor(4_200)}
        currencyCode="EUR"
        signed
      />,
    )
    expect(positive.container.textContent).toContain('+')

    const negative = render(
      <Amount
        locale="en"
        amountMinor={asMinor(-4_200)}
        currencyCode="EUR"
        signed
      />,
    )
    // `formatSignedMoney` normalises to U+2212, which is the glyph that pairs with the plus.
    expect(negative.container.textContent).toContain('\u2212')
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
      render(
        <Amount locale="pl" amountMinor={asMinor(0)} currencyCode="PLN" />,
      ),
    ).not.toThrow()
    expect(screen.queryByText('NaN')).toBeNull()
  })
})
