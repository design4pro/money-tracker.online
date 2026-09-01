import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { asCurrencyCode, asMinor } from '#/lib/money'

import { LineChart } from '../line-chart'
import { plain } from './plain'

import type { ChartCopy, ChartSeries } from '../types'

const PLN = asCurrencyCode('PLN')
const JPY = asCurrencyCode('JPY')

const copy: ChartCopy = {
  title: 'Net worth',
  categoryHeader: 'Month',
  emptyTitle: 'No history yet',
  emptyBody: 'History starts at your first transaction.',
  noData: 'No reading',
}

const months = ['January', 'February', 'March']

function seriesOf(
  id: string,
  name: string,
  amounts: ReadonlyArray<number | null>,
): ChartSeries {
  return {
    id,
    name,
    points: amounts.map((amount, index) => ({
      key: `${id}-${index}`,
      label: months[index] ?? `Month ${index}`,
      amountMinor: amount === null ? null : asMinor(amount),
    })),
  }
}

describe('LineChart', () => {
  it('ships exactly one visually-hidden table carrying the same numbers', () => {
    render(
      <LineChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        series={[
          seriesOf('assets', 'Assets', [120000, 131050, 129900]),
          seriesOf('debts', 'Debts', [-40000, -38000, -36000]),
        ]}
      />,
    )

    const tables = screen.getAllByRole('table')
    expect(tables).toHaveLength(1)

    const rows = within(tables[0]).getAllByRole('row')
    // One header row plus one row per month.
    expect(rows).toHaveLength(4)
    expect(within(rows[1]).getByRole('rowheader').textContent).toBe('January')
    expect(
      within(rows[1])
        .getAllByRole('cell')
        .map((cell) => plain(cell.textContent)),
    ).toEqual(['zł 1,200.00', '-zł 400.00'])
  })

  it('renders a gap as a gap: a broken path and a named absence in the table', () => {
    const { container } = render(
      <LineChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        series={[seriesOf('assets', 'Assets', [120000, null, 129900])]}
        gapNote="A break is a period with no reading."
      />,
    )

    const drawn = [...container.querySelectorAll('path')]
      .map((path) => path.getAttribute('d') ?? '')
      .find((d) => d.startsWith('M'))
    // Two `M` commands means the generator lifted the pen rather than interpolating across.
    expect((drawn?.match(/M/gu) ?? []).length).toBe(2)

    expect(screen.getByRole('cell', { name: 'No reading' })).toBeTruthy()
    expect(
      screen.getByText('A break is a period with no reading.'),
    ).toBeTruthy()
  })

  it('names each point with its series, its label and the amount in full', () => {
    render(
      <LineChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        series={[seriesOf('assets', 'Assets', [120000, 131050])]}
      />,
    )

    const names = screen
      .getAllByRole('img')
      .map((point) => plain(point.getAttribute('aria-label')))
    expect(names).toEqual([
      'Assets, January, zł 1,200.00',
      'Assets, February, zł 1,310.50',
    ])
  })

  it('gives the series one tab stop and walks it with the arrow keys', async () => {
    const user = userEvent.setup()
    render(
      <LineChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        series={[seriesOf('assets', 'Assets', [120000, 131050, 129900])]}
      />,
    )

    const points = screen.getAllByRole('img')
    expect(points.map((point) => point.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
    ])

    points[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(
      screen.getAllByRole('img').map((point) => point.getAttribute('tabindex')),
    ).toEqual(['-1', '0', '-1'])

    await user.keyboard('{End}')
    expect(
      screen.getAllByRole('img').map((point) => point.getAttribute('tabindex')),
    ).toEqual(['-1', '-1', '0'])

    // The ends stop rather than wrapping: a chart is a scale, not a carousel.
    await user.keyboard('{ArrowRight}')
    expect(
      screen.getAllByRole('img').map((point) => point.getAttribute('tabindex')),
    ).toEqual(['-1', '-1', '0'])
  })

  it('renders no decimal separator anywhere for a zero-decimal currency', () => {
    const { container } = render(
      <LineChart
        locale="en"
        currencyCode={JPY}
        copy={copy}
        series={[seriesOf('cash', 'Cash', [500000, 620000])]}
      />,
    )

    const point = screen.getByRole('img', { name: /Cash, January/u })
    expect(plain(point.getAttribute('aria-label'))).toBe(
      'Cash, January, ¥500,000',
    )

    const cells = screen
      .getAllByRole('cell')
      .map((cell) => plain(cell.textContent))
    expect(cells).toEqual(['¥500,000', '¥620,000'])

    // Including the axis, which formats through the same function with the same digits.
    const axisLabels = [...container.querySelectorAll('text')].map((node) =>
      plain(node.textContent),
    )
    expect(axisLabels.some((label) => label.includes('.'))).toBe(false)
  })

  it('draws a designed empty state instead of an empty table', () => {
    render(
      <LineChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        series={[seriesOf('assets', 'Assets', [null, null])]}
      />,
    )

    expect(screen.getByText('No history yet')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('refuses a plain number as a datum', () => {
    const bad: ChartSeries = {
      id: 'assets',
      name: 'Assets',
      // @ts-expect-error — an amount is a branded `Minor`, never a bare number.
      points: [{ key: 'a', label: 'January', amountMinor: 120000 }],
    }
    expect(bad.points).toHaveLength(1)
  })
})
