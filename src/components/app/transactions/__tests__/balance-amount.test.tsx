import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { asCurrencyCode, asMinor } from '#/lib/money'

import { BalanceAmount } from '../amount-text'

/**
 * The passbook's spine: unsigned so a balance reads as a state, pencil-toned only after a planned
 * line. Neither of those is exercised by `amount-currency.test.tsx`, which only covers the entry
 * field's currency suffix.
 */

function renderBalance(amountMinor: number, isPlanned = false) {
  render(
    <I18nProvider locale="en" messages={en}>
      <BalanceAmount
        amountMinor={asMinor(amountMinor)}
        currencyCode={asCurrencyCode('EUR')}
        isPlanned={isPlanned}
      />
    </I18nProvider>,
  )
}

describe('BalanceAmount', () => {
  it('draws a negative balance with the formatter’s own minus, never a leading +', () => {
    renderBalance(-2_000)
    const drawing = document.querySelector('[aria-hidden="true"]')
    expect(drawing?.textContent).not.toMatch(/^\+/)
    expect(drawing?.textContent).toMatch(/^-|−/)
  })

  it('draws a positive balance with no leading sign', () => {
    renderBalance(2_000)
    const drawing = document.querySelector('[aria-hidden="true"]')
    expect(drawing?.textContent).not.toMatch(/^[+−-]/)
  })

  it('switches to the pencil tone for a planned row, and stays ink for a booked one', () => {
    const { unmount } = render(
      <I18nProvider locale="en" messages={en}>
        <BalanceAmount
          amountMinor={asMinor(1_000)}
          currencyCode={asCurrencyCode('EUR')}
          isPlanned
        />
      </I18nProvider>,
    )
    expect(
      screen.getByText('€10.00').closest('[aria-hidden="true"]')?.parentElement
        ?.className,
    ).toContain('text-ink-2')
    unmount()

    render(
      <I18nProvider locale="en" messages={en}>
        <BalanceAmount
          amountMinor={asMinor(1_000)}
          currencyCode={asCurrencyCode('EUR')}
        />
      </I18nProvider>,
    )
    const classes =
      screen
        .getByText('€10.00')
        .closest('[aria-hidden="true"]')
        ?.parentElement?.className.split(' ') ?? []
    expect(classes).toContain('text-ink')
    expect(classes).not.toContain('text-ink-2')
  })
})
