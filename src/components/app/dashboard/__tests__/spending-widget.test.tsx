import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { plain } from '#/components/charts/__tests__/plain'
import { asCurrencyCode, asMinor } from '#/lib/money'

import { SpendingWidget } from '../spending-widget'
import { renderWidget } from './harness'

import type { CategorySpend } from '../types'

const PLN = asCurrencyCode('PLN')

function spend(id: string, label: string, amount: number): CategorySpend {
  return { id, label, amountMinor: asMinor(amount) }
}

describe('SpendingWidget', () => {
  it('ships the split as a table with shares that sum to 100', () => {
    renderWidget(
      <SpendingWidget
        baseCurrencyCode={PLN}
        spending={[
          spend('a', 'Groceries', 1000),
          spend('b', 'Transport', 1000),
          spend('c', 'Utilities', 1000),
        ]}
      />,
    )

    const shares = within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1, 4)
      .map((row) => within(row).getAllByRole('cell')[1]?.textContent ?? '')

    expect(shares).toEqual(['34%', '33%', '33%'])
  })

  it('names the columns from the catalogue rather than from the chart', () => {
    renderWidget(
      <SpendingWidget
        baseCurrencyCode={PLN}
        spending={[spend('a', 'Groceries', 1000)]}
      />,
    )

    expect(
      within(screen.getByRole('table'))
        .getAllByRole('columnheader')
        .map((node) => node.textContent),
    ).toEqual(['Category', 'Amount', 'Share'])
    expect(
      plain(
        within(screen.getByRole('table')).getAllByRole('cell')[0].textContent,
      ),
    ).toBe('zł 10.00')
  })

  it('draws the designed empty state a workspace without categories actually sees', () => {
    // This is the state every workspace is in until classification lands: the widget says what
    // would fill it rather than drawing a grey ring that reads as a failure.
    renderWidget(<SpendingWidget baseCurrencyCode={PLN} spending={[]} />)

    expect(screen.getByText('No categorised spending yet')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
