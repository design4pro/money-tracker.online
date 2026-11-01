import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { asMinor } from '#/lib/money'
import { assembleCalendar } from '#/server/loans/calendar'
import { CalendarChart } from '../calendar-chart'
import { CalendarGrid } from '../calendar-grid'

import type { Catalogue } from '#/lib/i18n'

function renderCalendar(year = 2026) {
  const calendar = assembleCalendar(
    [
      {
        dueOn: '2026-02-20',
        derivedStatus: 'paid',
        refAmountMinor: asMinor(120_00),
      },
      {
        dueOn: '2026-07-20',
        derivedStatus: 'overdue',
        refAmountMinor: asMinor(50_00),
      },
    ],
    '2026-08-20',
    'PLN',
  )
  return {
    calendar,
    ...render(
      <I18nProvider locale="en" messages={en as Catalogue}>
        <CalendarChart calendar={calendar} year={year} />
        <CalendarGrid calendar={calendar} />
      </I18nProvider>,
    ),
  }
}

describe('CalendarGrid', () => {
  it('draws years from 2025, names overdue in words, and dashes empty months', () => {
    renderCalendar()
    const grid = screen.getByRole('table', {
      name: /Paid and remaining instalments by month and year/i,
    })
    expect(within(grid).getByRole('rowheader', { name: '2025' })).toBeTruthy()
    expect(within(grid).getByRole('rowheader', { name: '2026' })).toBeTruthy()
    expect(within(grid).getByText('Overdue')).toBeTruthy()
    expect(within(grid).getAllByText('No instalments').length).toBeGreaterThan(
      0,
    )
  })
})

describe('CalendarGrid scroller', () => {
  it('is a named tab stop and carries a visible paid-over-remaining key', () => {
    renderCalendar()
    const region = screen.getByRole('region', { name: 'Month overview' })
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(within(region).getByRole('table')).toBeTruthy()
    const key = screen.getByText(
      /first figure is paid, the second is remaining/i,
    )
    expect(key.className).not.toContain('sr-only')
  })
})

describe('CalendarChart', () => {
  it('explains a year without instalments while preserving the full grid', () => {
    renderCalendar(2025)

    expect(screen.getByText('Nothing planned this year')).toBeTruthy()
    expect(
      screen.getByText(
        'Switch year, or add a liability with a schedule that covers it.',
      ),
    ).toBeTruthy()
    const grid = screen.getByRole('table', {
      name: /Paid and remaining instalments by month and year/i,
    })
    expect(within(grid).getByRole('rowheader', { name: '2026' })).toBeTruthy()
    expect(within(grid).getByText('Overdue')).toBeTruthy()
  })

  it('ships a visually hidden table of the same paid and remaining integers', () => {
    renderCalendar()
    const chart = screen.getByRole('table', {
      name: 'Obligations in 2026',
    })
    expect(within(chart).getByText('Paid')).toBeTruthy()
    expect(within(chart).getByText('Remaining')).toBeTruthy()
    expect(chart.parentElement?.className).toContain('sr-only')
  })
})
