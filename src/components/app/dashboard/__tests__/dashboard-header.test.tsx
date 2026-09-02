import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { drawn, reading } from '#/components/app/money/__tests__/channels'
import { asCurrencyCode, asMinor } from '#/lib/money'

import { DashboardHeader } from '../dashboard-header'
import { renderWidget } from './harness'

const PLN = asCurrencyCode('PLN')
const RANGE = { from: '2026-03-01', to: '2026-03-31' }

function renderHeader(net: number, income = 820000) {
  return renderWidget(
    <DashboardHeader
      baseCurrencyCode={PLN}
      range={RANGE}
      incomeMinor={asMinor(income)}
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

    const values = screen.getAllByRole('definition')
    expect(values.map(drawn)).toEqual([
      'zł 8,200.00',
      'zł 5,340.50',
      '+zł 2,859.50',
    ])
    // The spoken half names the currency and says the sign as a word, because `zł` is announced
    // inconsistently and U+2212 is frequently announced as nothing at all.
    expect(values.map(reading)).toEqual([
      '8,200.00 Polish zlotys',
      '5,340.50 Polish zlotys',
      'positive 2,859.50 Polish zlotys',
    ])
  })

  it('gives the difference its share rather than printing the same figure twice', () => {
    renderHeader(285950)
    // The tile above already draws `+zł 2,859.50`; the line under it says what that is a share of.
    expect(screen.getByText('35% of the zł 8,200.00 that came in')).toBeTruthy()
    expect(screen.queryByText('You kept zł 2,859.50')).toBeNull()
  })

  it('reads a shortfall as a negative share of what came in', () => {
    renderHeader(-120000)
    expect(
      // `Intl`'s own minus, the same one `formatPercentChange` draws — the glyph belongs to the
      // locale here, not to the money formatter.
      screen.getByText('-15% of the zł 8,200.00 that came in'),
    ).toBeTruthy()
  })

  it('states a shortfall as a positive magnitude when there is no income to share', () => {
    renderHeader(-120000, 0)
    // The direction is in the sentence. "You spent −1 200,00 more" would say the opposite thing.
    expect(
      screen.getByText('You spent zł 1,200.00 more than came in'),
    ).toBeTruthy()
  })

  it('has a word for exactly zero rather than falling back to a surplus of nothing', () => {
    renderHeader(0, 0)
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
