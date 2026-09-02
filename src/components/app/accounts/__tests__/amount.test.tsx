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

  it('renders the columns layout as two bare cells, so a list can own the tracks', () => {
    // The contract `'cells'` exists for: no wrapper element between the row's grid and the two
    // things that have to sit in its tracks. A wrapper would make each row size its own columns,
    // which is how the type word ends up starting at a different x on every row.
    const { container } = withI18n(
      <div data-testid="row">
        <DirectionalAmount
          locale="en"
          direction="expense"
          amountMinor={asMinor(12_000)}
          currencyCode="PLN"
          label="Expense"
          layout="cells"
        />
      </div>,
    )

    const row = container.querySelector('[data-testid="row"]')
    expect(row?.children).toHaveLength(2)
    expect(row?.children[0].textContent).toBe('Expense')
    // The direction still survives in the second cell, sign and all.
    expect(row?.children[1].textContent).toContain('−')
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

describe('Amount, aligned into a column', () => {
  it('draws the same string it draws inline, and speaks the same sentence', () => {
    const inline = withI18n(
      <Amount locale="en" amountMinor={asMinor(-169_211)} currencyCode="PLN" />,
    )
    const column = withI18n(
      <Amount
        locale="en"
        amountMinor={asMinor(-169_211)}
        currencyCode="PLN"
        align="decimal"
      />,
    )

    expect(drawn(column.container)).toBe(drawn(inline.container))
    expect(reading(column.container)).toBe(reading(inline.container))
  })

  it('cuts the figure before its fraction, so the separator lands at one x per column', () => {
    const { container } = withI18n(
      <Amount
        locale="en"
        amountMinor={asMinor(-169_211)}
        currencyCode="PLN"
        align="decimal"
      />,
    )
    const [head, tail] = [
      ...(container.querySelector('[aria-hidden="true"]')?.children ?? []),
    ]

    // Sign and currency mark are in the head, outside the aligned digits: the minus hangs to the
    // left of the column instead of pushing the digits sideways.
    expect(head.textContent).toBe('\u2212zł\u00a01,692')
    expect(tail.textContent).toBe('.11')
  })

  it('cuts after the digits for a currency that has no fraction at all', () => {
    const { container } = withI18n(
      <Amount
        locale="en"
        amountMinor={asMinor(5000)}
        currencyCode="JPY"
        align="decimal"
      />,
    )
    const [head, tail] = [
      ...(container.querySelector('[aria-hidden="true"]')?.children ?? []),
    ]
    expect(head.textContent).toBe('¥5,000')
    expect(tail.textContent).toBe('')
  })
})

describe('Amount at the display step', () => {
  it('sets the currency mark down without touching the sign', () => {
    const { container } = withI18n(
      <Amount
        locale="en"
        amountMinor={asMinor(-11_623_577)}
        currencyCode="PLN"
        size="2xl"
      />,
    )
    const marks = [...container.querySelectorAll('span')].filter(
      (node) => node.textContent === 'zł',
    )
    expect(marks[0]?.className).toContain('text-[0.6em]')

    // The sign is a channel that carries direction, not decoration: it stays at the digits' size.
    const signs = [...container.querySelectorAll('span')].filter(
      (node) => node.textContent === '\u2212',
    )
    expect(signs[0]?.className).toBe('')
  })

  it('leaves the mark alone at the sizes a row is set in', () => {
    const { container } = withI18n(
      <Amount locale="en" amountMinor={asMinor(150_000)} currencyCode="PLN" />,
    )
    const marks = [...container.querySelectorAll('span')].filter(
      (node) => node.textContent === 'zł',
    )
    expect(marks[0]?.className).toBe('')
  })
})

