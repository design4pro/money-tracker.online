import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { asMinor } from '#/lib/money'

import { ForecastPanel } from '../forecast-panel'
import { renderRecurring } from './harness'

import type { SeriesForecast } from '#/server/recurring/forecast'

const PLN: SeriesForecast = {
  currencyCode: 'PLN',
  spentThisYearMinor: asMinor(200_00),
  restOfYearMinor: asMinor(700_00),
  next12MonthsMinor: asMinor(1_200_00),
}

const EUR: SeriesForecast = {
  currencyCode: 'EUR',
  spentThisYearMinor: asMinor(80_00),
  restOfYearMinor: asMinor(240_00),
  next12MonthsMinor: asMinor(480_00),
}

describe('ForecastPanel', () => {
  it('prints the three totals as words, not as a colour', () => {
    renderRecurring(<ForecastPanel forecasts={[PLN]} />)

    expect(screen.getByText('Spent this year')).toBeTruthy()
    expect(screen.getByText('Rest of this year')).toBeTruthy()
    expect(screen.getByText('Next 12 months')).toBeTruthy()
  })

  it('announces each currency’s totals once', () => {
    renderRecurring(<ForecastPanel forecasts={[PLN, EUR]} />)

    expect(screen.getAllByText('Spent this year')).toHaveLength(2)
    expect(screen.getAllByText('Rest of this year')).toHaveLength(2)
    expect(screen.getAllByText('Next 12 months')).toHaveLength(2)
    expect(screen.getAllByRole('term')).toHaveLength(6)
    expect(screen.getAllByRole('definition')).toHaveLength(6)
    expect(screen.queryByRole('table', { hidden: true })).toBeNull()
  })

  it('says so when there is nothing to roll up', () => {
    renderRecurring(<ForecastPanel forecasts={[]} />)
    expect(screen.getByText('Nothing to forecast yet.')).toBeTruthy()
  })
})
