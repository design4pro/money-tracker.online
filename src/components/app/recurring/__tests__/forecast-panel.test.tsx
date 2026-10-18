import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { asMinor } from '#/lib/money'

import { ForecastPanel } from '../forecast-panel'
import { renderRecurring } from './harness'

describe('ForecastPanel', () => {
  it('prints the three totals as words, not as a colour', () => {
    renderRecurring(
      <ForecastPanel
        forecasts={[
          {
            currencyCode: 'PLN',
            spentThisYearMinor: asMinor(200_00),
            restOfYearMinor: asMinor(700_00),
            next12MonthsMinor: asMinor(1_200_00),
          },
        ]}
      />,
    )

    expect(screen.getAllByText('Spent this year').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rest of this year').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Next 12 months').length).toBeGreaterThan(0)
    expect(screen.getByRole('table', { hidden: true })).toBeTruthy()
  })

  it('clips the hidden table with a wrapper, because an sr-only table still widens the page', () => {
    renderRecurring(
      <ForecastPanel
        forecasts={[
          {
            currencyCode: 'PLN',
            spentThisYearMinor: asMinor(200_00),
            restOfYearMinor: asMinor(700_00),
            next12MonthsMinor: asMinor(1_200_00),
          },
        ]}
      />,
    )

    const table = screen.getByRole('table', { hidden: true })
    expect(table.classList.contains('sr-only')).toBe(false)
    expect(table.parentElement?.classList.contains('sr-only')).toBe(true)
  })

  it('says so when there is nothing to roll up', () => {
    renderRecurring(<ForecastPanel forecasts={[]} />)
    expect(screen.getByText('Nothing to forecast yet.')).toBeTruthy()
  })
})
