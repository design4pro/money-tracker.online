import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'

import { asCurrencyCode, asMinor } from '#/lib/money'

import { PeriodTimeline } from '../period-timeline'
import { ledgerRow, renderBudget } from './harness'

/**
 * `docs/ACCESSIBILITY.md`: every chart ships a visually-hidden data table carrying the same
 * numbers. A bar chart that a screen reader cannot read is a decoration, not a figure.
 */

const PLN = asCurrencyCode('PLN')

function threePeriods() {
  return [
    ledgerRow({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      closed: true,
      spentMinor: asMinor(1_800_00),
    }),
    ledgerRow({
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      closed: true,
      carriedInMinor: asMinor(200_00),
      spentMinor: asMinor(2_400_00),
    }),
    ledgerRow({ spentMinor: asMinor(600_00) }),
  ]
}

describe('PeriodTimeline', () => {
  it('ships the same numbers as a table a screen reader can read', () => {
    renderBudget(<PeriodTimeline rows={threePeriods()} currencyCode={PLN} />)

    const table = screen.getByRole('table')
    expect(
      within(table).getByRole('columnheader', { name: 'Spent' }),
    ).toBeTruthy()
    expect(
      within(table).getByRole('columnheader', { name: 'Available' }),
    ).toBeTruthy()
    // 2 400,00 spent in February, against 2 200,00 available (2 000,00 + a 200,00 carry).
    expect(table.textContent).toMatch(/2,400\.00/)
    expect(table.textContent).toMatch(/2,200\.00/)
    // Three periods, one row each, plus the header row.
    expect(within(table).getAllByRole('row').length).toBe(4)
  })

  it('draws one bar per period and stops at the requested limit', () => {
    const many = Array.from({ length: 15 }, (_unused, index) => {
      const month = String((index % 12) + 1).padStart(2, '0')
      const year = 2024 + Math.floor(index / 12)
      return ledgerRow({
        periodStart: `${year}-${month}-01`,
        periodEnd: `${year}-${month}-28`,
        spentMinor: asMinor(100_00 * (index + 1)),
      })
    })
    renderBudget(<PeriodTimeline rows={many} currencyCode={PLN} limit={4} />)

    // Four periods, newest last: the header row plus four data rows.
    expect(screen.getAllByRole('row').length).toBe(5)
  })

  it('shows an intentional empty state rather than a chart of one bar', () => {
    renderBudget(<PeriodTimeline rows={[ledgerRow()]} currencyCode={PLN} />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText(/One period so far/i)).toBeTruthy()
  })
})
