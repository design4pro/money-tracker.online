import { describe, expect, it } from 'vitest'

import {
  DASHBOARD_PERIODS,
  isDashboardPeriod,
  monthRange,
  monthsIn,
  periodRange,
} from '../period'

/**
 * The period model, pinned to a date rather than to the clock.
 *
 * Every case below is a day that has broken a naive implementation: the 31st (where "a month ago"
 * has no 31st), a leap February, and a December where "three months" crosses a year. None of them
 * is reachable by a test that calls `new Date()`.
 */

const LAST_DAY_OF_MARCH = '2026-03-31'

describe('periodRange', () => {
  it('covers whole calendar months, not thirty-day windows', () => {
    expect(periodRange('thisMonth', LAST_DAY_OF_MARCH)).toEqual({
      from: '2026-03-01',
      to: '2026-03-31',
    })
  })

  it('does not fall into a month that has no 31st', () => {
    // Naive date arithmetic lands on 3 March here, or on 1 March and calls it February.
    expect(periodRange('lastMonth', LAST_DAY_OF_MARCH)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })

  it('ends a leap February on the 29th', () => {
    expect(periodRange('thisMonth', '2028-02-15')).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    })
  })

  it('counts three months inclusive of the current one', () => {
    expect(periodRange('last3Months', '2026-01-15')).toEqual({
      from: '2025-11-01',
      to: '2026-01-31',
    })
  })

  it('counts twelve months inclusive of the current one', () => {
    expect(periodRange('last12Months', '2026-06-30')).toEqual({
      from: '2025-07-01',
      to: '2026-06-30',
    })
  })

  it('runs a year from January to December', () => {
    expect(periodRange('thisYear', '2026-06-30')).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    })
  })

  it('is month-aligned for every period, which is what lets the header sum the buckets', () => {
    for (const period of DASHBOARD_PERIODS) {
      const range = periodRange(period, LAST_DAY_OF_MARCH)
      const months = monthsIn(range)
      expect(months.at(0)).toBe(range.from)
      expect(monthRange(months.at(-1)!).to).toBe(range.to)
    }
  })
})

describe('monthsIn', () => {
  it('lists every month in the range, in order, including empty ones', () => {
    expect(monthsIn({ from: '2025-11-01', to: '2026-01-31' })).toEqual([
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
    ])
  })

  it('lists one month for a range inside one month', () => {
    expect(monthsIn({ from: '2026-03-04', to: '2026-03-09' })).toEqual([
      '2026-03-01',
    ])
  })

  it('gives twelve buckets for a twelve-month period', () => {
    expect(monthsIn(periodRange('last12Months', '2026-06-30'))).toHaveLength(12)
  })
})

describe('monthRange', () => {
  it('closes a month on its own last day', () => {
    expect(monthRange('2026-02-01')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })
})

describe('isDashboardPeriod', () => {
  it('rejects anything that is not one of the five', () => {
    expect(isDashboardPeriod('thisMonth')).toBe(true)
    expect(isDashboardPeriod('lastWeek')).toBe(false)
    expect(isDashboardPeriod(undefined)).toBe(false)
    expect(isDashboardPeriod(3)).toBe(false)
  })
})
