import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { plain } from '#/components/charts/__tests__/plain'
import { asCurrencyCode, asMinor } from '#/lib/money'

import { CashFlowWidget } from '../cash-flow-widget'
import { renderWidget } from './harness'

import type { CashFlowBucket } from '../types'

const PLN = asCurrencyCode('PLN')

function bucket(
  key: string,
  income: number,
  expense: number,
  inPeriod = true,
): CashFlowBucket {
  return {
    key,
    incomeMinor: asMinor(income),
    expenseMinor: asMinor(expense),
    netMinor: asMinor(income - expense),
    inPeriod,
  }
}

describe('CashFlowWidget', () => {
  it('ships the numbers as a table, not only as bars', () => {
    renderWidget(
      <CashFlowWidget
        baseCurrencyCode={PLN}
        buckets={[
          bucket('2026-01-01', 820000, 534050),
          bucket('2026-02-01', 790000, 611000),
        ]}
      />,
    )

    const table = screen.getByRole('table')
    expect(table.querySelector('caption')?.textContent).toBe('Cash flow')

    const columns = within(table)
      .getAllByRole('columnheader')
      .map((node) => node.textContent)
    expect(columns).toEqual(['Month', 'Money in', 'Money out'])

    const rowHeaders = within(table)
      .getAllByRole('rowheader')
      .map((node) => node.textContent)
    expect(rowHeaders).toEqual(['Jan 2026', 'Feb 2026'])

    expect(
      within(table)
        .getAllByRole('cell')
        .map((cell) => plain(cell.textContent)),
    ).toEqual(['zł 8,200.00', 'zł 5,340.50', 'zł 7,900.00', 'zł 6,110.00'])
  })

  it('names money out as a direction rather than as a negative income', () => {
    renderWidget(
      <CashFlowWidget
        baseCurrencyCode={PLN}
        buckets={[bucket('2026-01-01', 820000, 534050)]}
      />,
    )

    const names = screen
      .getAllByRole('img')
      .map((segment) => plain(segment.getAttribute('aria-label')))
    // No minus sign: the series name carries the direction, so the bar keeps its full height and
    // the axis keeps its resolution.
    expect(names).toEqual([
      'Money in, Jan 2026, zł 8,200.00',
      'Money out, Jan 2026, zł 5,340.50',
    ])
  })

  it('draws a month with nothing in it as a zero rather than skipping it', () => {
    renderWidget(
      <CashFlowWidget
        baseCurrencyCode={PLN}
        buckets={[
          bucket('2026-01-01', 820000, 0),
          bucket('2026-02-01', 0, 0),
          bucket('2026-03-01', 0, 100000),
        ]}
      />,
    )

    expect(
      within(screen.getByRole('table'))
        .getAllByRole('rowheader')
        .map((node) => node.textContent),
    ).toEqual(['Jan 2026', 'Feb 2026', 'Mar 2026'])
  })

  it('says which month is the selected one when it also draws context months', () => {
    renderWidget(
      <CashFlowWidget
        baseCurrencyCode={PLN}
        buckets={[
          bucket('2026-01-01', 500000, 400000, false),
          bucket('2026-02-01', 600000, 450000, false),
          bucket('2026-03-01', 820000, 534050),
        ]}
      />,
    )

    // The context is named in words, not left to a band a reader has to infer.
    expect(
      screen.getByText(
        'Selected period: Mar 2026. Earlier months are context.',
      ),
    ).toBeTruthy()
    // And the months it borrowed are real readings, in the table like every other reading.
    expect(
      within(screen.getByRole('table'))
        .getAllByRole('rowheader')
        .map((node) => node.textContent),
    ).toEqual(['Jan 2026', 'Feb 2026', 'Mar 2026'])
  })

  it('says nothing about context when every month drawn is in the period', () => {
    renderWidget(
      <CashFlowWidget
        baseCurrencyCode={PLN}
        buckets={[
          bucket('2026-01-01', 820000, 534050),
          bucket('2026-02-01', 790000, 611000),
        ]}
      />,
    )

    expect(screen.queryByText(/selected period/)).toBeNull()
  })

  it('draws a designed empty state when nothing moved in the whole period', () => {
    renderWidget(
      <CashFlowWidget
        baseCurrencyCode={PLN}
        buckets={[bucket('2026-01-01', 0, 0), bucket('2026-02-01', 0, 0)]}
      />,
    )

    expect(screen.getByText('No money moved in this period')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
