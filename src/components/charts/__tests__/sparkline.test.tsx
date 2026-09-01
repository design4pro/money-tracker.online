import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { asCurrencyCode, asMinor } from '#/lib/money'

import { Sparkline } from '../sparkline'
import { plain } from './plain'

import type { SparklineCopy } from '../sparkline'
import type { ChartPoint } from '../types'

const PLN = asCurrencyCode('PLN')

const copy: SparklineCopy = {
  title: 'Progress',
  categoryHeader: 'Week',
  emptyTitle: 'No contributions yet',
  emptyBody: 'Add one to see the trend.',
  noData: 'No reading',
  minLabel: 'Lowest',
  maxLabel: 'Highest',
  valueHeader: 'Balance',
}

function pointsOf(amounts: ReadonlyArray<number | null>): Array<ChartPoint> {
  return amounts.map((amount, index) => ({
    key: `w${index}`,
    label: `Week ${index + 1}`,
    amountMinor: amount === null ? null : asMinor(amount),
  }))
}

describe('Sparkline', () => {
  it('is not exempt from the text equivalent just because it is small', () => {
    render(
      <Sparkline
        locale="en"
        currencyCode={PLN}
        copy={copy}
        points={pointsOf([10000, null, 42500])}
      />,
    )

    const table = screen.getByRole('table')
    expect(table.querySelector('caption')?.textContent).toBe('Progress')
    expect(
      screen.getAllByRole('cell').map((cell) => plain(cell.textContent)),
    ).toEqual(['zł 100.00', 'No reading', 'zł 425.00'])
  })

  it('annotates the low and the high with the data values, not the pixel positions', () => {
    const { container } = render(
      <Sparkline
        locale="en"
        currencyCode={PLN}
        copy={copy}
        points={pointsOf([31500, 12000, 42500])}
      />,
    )

    const annotations = [...container.querySelectorAll('text')].map((node) =>
      plain(node.textContent),
    )
    expect(annotations).toEqual(['zł 425.00', 'zł 120.00'])
  })

  it('costs the keyboard one tab stop for the whole line', async () => {
    const user = userEvent.setup()
    render(
      <Sparkline
        locale="en"
        currencyCode={PLN}
        copy={copy}
        points={pointsOf([10000, 20000, 30000])}
      />,
    )

    const readings = screen.getAllByRole('img')
    expect(readings.map((node) => node.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
    ])
    expect(plain(readings[0].getAttribute('aria-label'))).toBe(
      'Week 1, zł 100.00',
    )

    readings[0].focus()
    await user.keyboard('{End}')
    expect(
      screen.getAllByRole('img').map((node) => node.getAttribute('tabindex')),
    ).toEqual(['-1', '-1', '0'])
  })

  it('draws a designed empty state instead of a flat line at zero', () => {
    render(
      <Sparkline
        locale="en"
        currencyCode={PLN}
        copy={copy}
        points={pointsOf([null, null])}
      />,
    )

    expect(screen.getByText('No contributions yet')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
