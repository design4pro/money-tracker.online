import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DASHBOARD_PERIODS } from '../period'
import { PeriodSelector } from '../period-selector'
import { renderWidget } from './harness'

describe('PeriodSelector', () => {
  it('offers every period the loader accepts, and no others', async () => {
    const user = userEvent.setup()
    renderWidget(<PeriodSelector period="thisMonth" onChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: /Period/ }))
    expect(screen.getAllByRole('option')).toHaveLength(DASHBOARD_PERIODS.length)
    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual([
      'This month',
      'Last month',
      'Last 3 months',
      'Last 12 months',
      'This year',
    ])
  })

  it('reports the period itself, so the URL and the control cannot drift', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWidget(<PeriodSelector period="thisMonth" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /Period/ }))
    await user.click(screen.getByRole('option', { name: 'Last 3 months' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith('last3Months')
  })

  it('shows the period it was given rather than a placeholder', () => {
    renderWidget(<PeriodSelector period="thisYear" onChange={() => {}} />)
    expect(
      screen.getByRole('button', { name: /Period/ }).textContent,
    ).toContain('This year')
  })
})
