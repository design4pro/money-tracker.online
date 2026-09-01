import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { asCurrencyCode, asMinor } from '#/lib/money'

import { DonutChart } from '../donut-chart'
import { plain } from './plain'

import type { DonutCopy } from '../donut-chart'
import type { ChartSlice } from '../types'

const PLN = asCurrencyCode('PLN')

const copy: DonutCopy = {
  title: 'Spending by category',
  categoryHeader: 'Category',
  emptyTitle: 'No spending this period',
  emptyBody: 'Categorised expenses appear here.',
  noData: 'No reading',
  otherLabel: 'Other',
  expandLabel: 'Show the smaller categories',
  collapseLabel: 'Hide the smaller categories',
  totalLabel: 'Total',
  amountHeader: 'Amount',
  shareHeader: 'Share',
  formatShare: (percent) => `${percent}%`,
}

function slice(id: string, label: string, amountMinor: number): ChartSlice {
  return { id, label, amountMinor: asMinor(amountMinor) }
}

describe('DonutChart', () => {
  it('shows shares that sum to exactly 100 where naive rounding would sum to 99', () => {
    render(
      <DonutChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        slices={[
          slice('a', 'Groceries', 1000),
          slice('b', 'Transport', 1000),
          slice('c', 'Utilities', 1000),
        ]}
      />,
    )

    const shares = within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1, 4)
      .map((row) => within(row).getAllByRole('cell')[1]?.textContent ?? '')

    expect(shares).toEqual(['34%', '33%', '33%'])
    expect(
      shares.reduce((sum, share) => sum + Number.parseInt(share, 10), 0),
    ).toBe(100)
  })

  it('tabs through the slices largest-first, not in the order they arrived', () => {
    render(
      <DonutChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        slices={[
          slice('small', 'Transport', 20000),
          slice('big', 'Rent', 150000),
          slice('mid', 'Groceries', 60000),
        ]}
      />,
    )

    expect(
      screen
        .getAllByRole('img')
        .map((wedge) => plain(wedge.getAttribute('aria-label'))),
    ).toEqual([
      'Rent, zł 1,500.00, 65%',
      'Groceries, zł 600.00, 26%',
      'Transport, zł 200.00, 9%',
    ])
  })

  it('groups sub-1% slices into an exact Other and keeps their contents reachable', async () => {
    const user = userEvent.setup()
    render(
      <DonutChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        slices={[
          slice('rent', 'Rent', 100000),
          slice('tiny1', 'Stamps', 400),
          slice('tiny2', 'Parking', 450),
        ]}
      />,
    )

    const other = screen
      .getAllByRole('img')
      .map((wedge) => plain(wedge.getAttribute('aria-label')))
      .find((name) => name.startsWith('Other'))
    // 4.00 + 4.50 — the exact integer sum of what it hides, not a rounded remainder. Neither
    // part reaches 1% on its own; together they do, and the group is drawn rather than lost.
    expect(other).toBe('Other, zł 8.50, 1%')

    const disclosure = screen.getByRole('button', {
      name: 'Show the smaller categories',
    })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')

    // Collapsed, the two names exist only in the text equivalent. Expanded, they are on screen
    // as well — hidden from the ring is not hidden from the reader.
    expect(screen.getAllByText('Stamps')).toHaveLength(1)
    await user.click(disclosure)
    expect(screen.getAllByText('Stamps')).toHaveLength(2)
    expect(screen.getAllByText('Parking')).toHaveLength(2)
  })

  it('lists every slice in the text equivalent, Other uncollapsed', () => {
    render(
      <DonutChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        slices={[
          slice('rent', 'Rent', 1000000),
          slice('tiny1', 'Stamps', 300),
          slice('tiny2', 'Parking', 450),
        ]}
      />,
    )

    const headers = within(screen.getByRole('table'))
      .getAllByRole('rowheader')
      .map((header) => header.textContent)
    expect(headers).toEqual(['Rent', 'Parking', 'Stamps', 'Total'])
  })

  it('draws a single slice as one labelled full ring', () => {
    render(
      <DonutChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        slices={[slice('rent', 'Rent', 1000000)]}
      />,
    )

    const wedges = screen.getAllByRole('img')
    expect(wedges).toHaveLength(1)
    expect(plain(wedges[0].getAttribute('aria-label'))).toBe(
      'Rent, zł 10,000.00, 100%',
    )
  })

  it('draws a designed empty state instead of an empty ring', () => {
    render(
      <DonutChart locale="en" currencyCode={PLN} copy={copy} slices={[]} />,
    )

    expect(screen.getByText('No spending this period')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
