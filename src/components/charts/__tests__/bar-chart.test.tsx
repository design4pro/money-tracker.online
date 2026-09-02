import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { asCurrencyCode, asMinor } from '#/lib/money'

import { BarChart } from '../bar-chart'
import { plain } from './plain'

import type { ChartCopy, ChartSeries } from '../types'

const PLN = asCurrencyCode('PLN')
const JPY = asCurrencyCode('JPY')

const copy: ChartCopy = {
  title: 'Cash flow',
  categoryHeader: 'Month',
  emptyTitle: 'Nothing this period',
  emptyBody: 'Record a transaction to see the flow.',
  noData: 'No reading',
}

const months = ['January', 'February']

function seriesOf(
  id: string,
  name: string,
  amounts: ReadonlyArray<number>,
): ChartSeries {
  return {
    id,
    name,
    points: amounts.map((amount, index) => ({
      key: `${id}-${index}`,
      label: months[index] ?? `Month ${index}`,
      amountMinor: asMinor(amount),
    })),
  }
}

describe('BarChart', () => {
  it("announces each segment's series, category, amount and the stack's total", () => {
    render(
      <BarChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        totalLabel="Total"
        series={[
          seriesOf('rent', 'Rent', [150000, 150000]),
          seriesOf('food', 'Food', [42350, 51100]),
        ]}
      />,
    )

    const names = screen
      .getAllByRole('img')
      .map((segment) => plain(segment.getAttribute('aria-label')))

    // 1500.00 + 423.50 = 1923.50 — the stated total is the integer sum of the segments drawn,
    // not a figure computed a second way.
    expect(names[0]).toBe('Rent, January, zł 1,500.00, Total: zł 1,923.50')
    expect(names[2]).toBe('Food, January, zł 423.50, Total: zł 1,923.50')
  })

  it('foots the text equivalent with one total per series column', () => {
    render(
      <BarChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        totalLabel="Total"
        series={[
          seriesOf('rent', 'Rent', [150000, 150000]),
          seriesOf('food', 'Food', [42350, 51100]),
        ]}
      />,
    )

    const table = screen.getByRole('table')
    const footer = within(table).getAllByRole('row').at(-1)
    expect(within(footer!).getByRole('rowheader').textContent).toBe('Total')
    expect(
      within(footer!)
        .getAllByRole('cell')
        .map((cell) => plain(cell.textContent)),
    ).toEqual(['zł 3,000.00', 'zł 934.50'])
  })

  it('walks a series with the arrow keys, one tab stop per series', async () => {
    const user = userEvent.setup()
    render(
      <BarChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        layout="grouped"
        series={[
          seriesOf('in', 'Money in', [500000, 480000]),
          seriesOf('out', 'Money out', [310000, 402000]),
        ]}
      />,
    )

    const segments = screen.getAllByRole('img')
    expect(segments.map((segment) => segment.getAttribute('tabindex'))).toEqual(
      ['0', '-1', '0', '-1'],
    )

    segments[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(
      screen
        .getAllByRole('img')
        .map((segment) => segment.getAttribute('tabindex')),
    ).toEqual(['-1', '0', '0', '-1'])
  })

  it('renders no decimal separator anywhere for a zero-decimal currency', () => {
    render(
      <BarChart
        locale="en"
        currencyCode={JPY}
        copy={copy}
        totalLabel="Total"
        series={[seriesOf('rent', 'Rent', [150000, 120000])]}
      />,
    )

    const cells = screen
      .getAllByRole('cell')
      .map((cell) => plain(cell.textContent))
    expect(cells).toEqual(['¥150,000', '¥120,000', '¥270,000'])
  })

  it('names the unit the y axis counts in, once, rather than on every tick', () => {
    const { container } = render(
      <BarChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        series={[seriesOf('rent', 'Rent', [150000, 120000])]}
      />,
    )

    // A dashboard can show two currencies at once, so a bare `12,000` on a plot is a number
    // without a unit. Once, above the top tick — not suffixed onto five ticks, which is noise,
    // and not into the tick gutter, which would take its width out of the plot.
    const labels = [...container.querySelectorAll('text')].map(
      (node) => node.textContent,
    )
    expect(labels.filter((label) => label === 'zł')).toHaveLength(1)
  })

  it('marks a category with a band squared to the plot, under the gridlines', () => {
    const { container } = render(
      <BarChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        layout="grouped"
        emphasis={[false, true]}
        series={[
          seriesOf('in', 'Money in', [500000, 480000]),
          seriesOf('out', 'Money out', [310000, 402000]),
        ]}
      />,
    )

    const band = container.querySelector('rect.fill-chart-emphasis')
    expect(band).not.toBeNull()

    // Gridlines are drawn from the zero tick upwards, so the first is the baseline and the last
    // is the top of the domain.
    const gridlines = [
      ...container.querySelectorAll('line.stroke-border-subtle'),
    ]
    const y = Number(band?.getAttribute('y'))
    const height = Number(band?.getAttribute('height'))

    // Top of the domain to the baseline, and not a pixel past either. The band used to start half
    // a gutter *above* the top gridline, which drew a box whose top edge claimed a value no bar
    // in it reached.
    expect(y).toBe(Number(gridlines.at(-1)?.getAttribute('y1')))
    expect(y + height).toBe(Number(gridlines.at(0)?.getAttribute('y1')))

    // And under the gridlines in paint order — only readable at all because the fill is an alpha
    // rather than the opaque well it used to be, which hid every line that crossed it.
    const order = band?.compareDocumentPosition(gridlines[0]) ?? 0
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('draws a designed empty state instead of an empty table', () => {
    render(
      <BarChart
        locale="en"
        currencyCode={PLN}
        copy={copy}
        series={[
          {
            id: 'rent',
            name: 'Rent',
            points: [{ key: 'a', label: 'January', amountMinor: null }],
          },
        ]}
      />,
    )

    expect(screen.getByText('Nothing this period')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
