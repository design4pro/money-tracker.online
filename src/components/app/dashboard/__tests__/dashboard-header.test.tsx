import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { plain } from '#/components/charts/__tests__/plain'
import { asCurrencyCode, asMinor } from '#/lib/money'

import { DashboardHeader } from '../dashboard-header'
import { renderWidget } from './harness'

const PLN = asCurrencyCode('PLN')
const RANGE = { from: '2026-03-01', to: '2026-03-31' }

function renderHeader(net: number) {
  return renderWidget(
    <DashboardHeader
      baseCurrencyCode={PLN}
      range={RANGE}
      incomeMinor={asMinor(820000)}
      expenseMinor={asMinor(534050)}
      netMinor={asMinor(net)}
    />,
  )
}

describe('DashboardHeader', () => {
  it('keeps each figure attached to its own label', () => {
    renderHeader(285950)

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'This period at a glance',
      }),
    ).toBeTruthy()

    const terms = screen.getAllByRole('term').map((node) => node.textContent)
    expect(terms).toEqual(['Money in', 'Money out', 'Difference'])

    const values = screen
      .getAllByRole('definition')
      .map((node) => plain(node.textContent))
    expect(values[0]).toBe('zł 8,200.00')
    expect(values[1]).toBe('zł 5,340.50')
  })

  it('says which way the period went in words, not only in a colour', () => {
    renderHeader(285950)
    expect(screen.getByText('You kept zł 2,859.50')).toBeTruthy()
  })

  it('states a shortfall as a positive magnitude, with no second minus sign', () => {
    renderHeader(-120000)
    // The direction is in the sentence. "You spent −1 200,00 more" would say the opposite thing.
    expect(
      screen.getByText('You spent zł 1,200.00 more than came in'),
    ).toBeTruthy()
  })

  it('has a word for exactly zero rather than falling back to a surplus of nothing', () => {
    renderHeader(0)
    expect(
      screen.getByText('Money in and money out matched exactly'),
    ).toBeTruthy()
  })

  it('names the period as a date range and introduces exactly one h1', () => {
    renderHeader(0)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    // The separators are the locale's own — a thin space here, an en dash there — so the
    // assertion is about the parts, not about which invisible code point CLDR chose this year.
    expect(screen.getByText(/^Showing/).textContent).toMatch(
      /^Showing\s*Mar\s*1\s*.\s*31,\s*2026$/u,
    )
  })
})
