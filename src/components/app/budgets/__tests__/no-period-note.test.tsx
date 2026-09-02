import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { NoPeriodNote } from '../no-period-note'
import { budgetSummary, renderBudget } from './harness'

/**
 * Three different reasons a meter cannot be drawn, three different sentences. Collapsing them
 * would tell somebody their currency is broken when their budget simply starts on Monday.
 */

describe('NoPeriodNote', () => {
  it('names the day a budget that has not started begins', () => {
    renderBudget(
      <NoPeriodNote
        budget={budgetSummary({ startDate: '2099-01-01', current: null })}
      />,
    )
    expect(screen.getByText(/Starts .*2099/)).toBeTruthy()
  })

  it('names the day a finished budget ended', () => {
    renderBudget(
      <NoPeriodNote
        budget={budgetSummary({
          startDate: '2020-01-01',
          endDate: '2020-12-31',
          current: null,
        })}
      />,
    )
    expect(screen.getByText(/Ended .*2020/)).toBeTruthy()
  })

  it('names the currency when the limit could not be converted, and never says 0%', () => {
    renderBudget(
      <NoPeriodNote
        budget={budgetSummary({
          startDate: '2020-01-01',
          endDate: null,
          budgetCurrencyCode: 'EUR',
          current: null,
          utilisation: null,
        })}
      />,
    )
    expect(screen.getByText(/EUR/)).toBeTruthy()
    expect(screen.queryByText('0%')).toBeNull()
  })
})
