/**
 * Where the boundaries fall.
 *
 * The cases that matter are the ones a millisecond subtraction gets wrong: a budget anchored on
 * the 31st, a February, a leap day, a quarter that spans a year end. `@internationalized/date`
 * handles all four — these assertions are here so that a future "simplification" back to
 * `Date.getTime()` arithmetic fails loudly rather than moving somebody's month by a day.
 */

import { describe, expect, it } from 'vitest'

import {
  OPEN_ENDED_END,
  periodAfter,
  periodBoundsAt,
  periodContaining,
  periodIndexFor,
  periodLengthMonths,
  periodsThrough,
} from '../period'

import type { BudgetCalendar } from '../period'

const monthly = (startDate: string, endDate: string | null = null) =>
  ({ period: 'monthly', startDate, endDate }) satisfies BudgetCalendar

describe('periodLengthMonths', () => {
  it('knows the three cadences and refuses to give one_off a length', () => {
    expect(periodLengthMonths('monthly')).toBe(1)
    expect(periodLengthMonths('quarterly')).toBe(3)
    expect(periodLengthMonths('yearly')).toBe(12)
    expect(periodLengthMonths('one_off')).toBeNull()
  })
})

describe('periodBoundsAt', () => {
  it('tiles from the anchor, not from the first of the month', () => {
    // A budget started on payday runs 12th-to-11th.
    expect(periodBoundsAt(monthly('2026-01-12'), 0)).toEqual({
      periodStart: '2026-01-12',
      periodEnd: '2026-02-11',
    })
    expect(periodBoundsAt(monthly('2026-01-12'), 2)).toEqual({
      periodStart: '2026-03-12',
      periodEnd: '2026-04-11',
    })
  })

  it('clamps a 31st anchor to the length of the month it lands in', () => {
    // January 31 + 1 month is February 28 (2026 is not a leap year), so the period ends on the
    // 27th. Millisecond arithmetic produces March 3 here.
    expect(periodBoundsAt(monthly('2026-01-31'), 0)).toEqual({
      periodStart: '2026-01-31',
      periodEnd: '2026-02-27',
    })
  })

  it('crosses a leap day without losing it', () => {
    const bounds = periodBoundsAt(monthly('2024-02-01'), 0)
    expect(bounds).toEqual({
      periodStart: '2024-02-01',
      periodEnd: '2024-02-29',
    })
  })

  it('spans a year end for a quarterly budget', () => {
    expect(
      periodBoundsAt(
        { period: 'quarterly', startDate: '2025-11-01', endDate: null },
        0,
      ),
    ).toEqual({ periodStart: '2025-11-01', periodEnd: '2026-01-31' })
  })

  it('cuts the final period short at the budget end date', () => {
    expect(periodBoundsAt(monthly('2026-01-01', '2026-02-10'), 1)).toEqual({
      periodStart: '2026-02-01',
      periodEnd: '2026-02-10',
    })
  })

  it('gives a one_off budget a single period, open ended when it has no end', () => {
    const calendar = {
      period: 'one_off',
      startDate: '2026-05-01',
      endDate: null,
    } satisfies BudgetCalendar
    expect(periodBoundsAt(calendar, 0)).toEqual({
      periodStart: '2026-05-01',
      periodEnd: OPEN_ENDED_END,
    })
    expect(periodBoundsAt({ ...calendar, endDate: '2026-08-31' }, 0)).toEqual({
      periodStart: '2026-05-01',
      periodEnd: '2026-08-31',
    })
  })
})

describe('periodIndexFor', () => {
  it('counts rather than walks', () => {
    expect(periodIndexFor(monthly('2019-01-01'), '2026-03-15')).toBe(86)
  })

  it('keeps a day earlier in the month than the anchor in the period before', () => {
    const calendar = monthly('2026-01-12')
    expect(periodIndexFor(calendar, '2026-02-11')).toBe(0)
    expect(periodIndexFor(calendar, '2026-02-12')).toBe(1)
  })

  it('places a day on a clamped boundary in the period that boundary opens', () => {
    // Period 0 of a 31st-anchored budget is 31 Jan - 27 Feb, so 28 Feb is period 1. A
    // day-of-month comparison answers 0 here and files the transaction in the wrong envelope.
    const calendar = monthly('2026-01-31')
    expect(periodIndexFor(calendar, '2026-02-27')).toBe(0)
    expect(periodIndexFor(calendar, '2026-02-28')).toBe(1)
    expect(periodIndexFor(calendar, '2026-03-30')).toBe(1)
    expect(periodIndexFor(calendar, '2026-03-31')).toBe(2)
  })

  it('has no period before the budget starts or after it ends', () => {
    expect(periodIndexFor(monthly('2026-01-01'), '2025-12-31')).toBeNull()
    expect(
      periodIndexFor(monthly('2026-01-01', '2026-03-31'), '2026-04-01'),
    ).toBeNull()
  })

  it('divides by the cadence for quarterly and yearly', () => {
    expect(
      periodIndexFor(
        { period: 'quarterly', startDate: '2026-01-01', endDate: null },
        '2026-07-04',
      ),
    ).toBe(2)
    expect(
      periodIndexFor(
        { period: 'yearly', startDate: '2020-06-01', endDate: null },
        '2026-05-31',
      ),
    ).toBe(5)
  })
})

describe('periodContaining', () => {
  it('answers with bounds that actually contain the day', () => {
    const bounds = periodContaining(monthly('2026-01-31'), '2026-03-01')
    expect(bounds).toEqual({
      periodStart: '2026-02-28',
      periodEnd: '2026-03-30',
    })
  })
})

describe('periodAfter', () => {
  it('abuts the period it follows, with no gap and no overlap', () => {
    const current = periodBoundsAt(monthly('2026-01-12'), 3)
    const next = periodAfter(monthly('2026-01-12'), current.periodStart)
    expect(next?.periodStart).toBe('2026-05-12')
    expect(current.periodEnd).toBe('2026-05-11')
  })

  it('stops at the budget end date', () => {
    expect(
      periodAfter(monthly('2026-01-01', '2026-02-28'), '2026-02-01'),
    ).toBeNull()
  })

  it('never gives a one_off budget a second period to carry into', () => {
    expect(
      periodAfter(
        { period: 'one_off', startDate: '2026-01-01', endDate: null },
        '2026-01-01',
      ),
    ).toBeNull()
  })
})

describe('periodsThrough', () => {
  it('runs from the anchor to the period holding today, in order', () => {
    const periods = periodsThrough(monthly('2026-01-01'), '2026-03-15')
    expect(periods.map((p) => p.periodStart)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ])
    expect(periods.at(-1)?.periodEnd).toBe('2026-03-31')
  })

  it('is empty before the budget starts', () => {
    expect(periodsThrough(monthly('2026-04-01'), '2026-03-15')).toEqual([])
  })

  it('stops at the end date once the budget is over', () => {
    const periods = periodsThrough(
      monthly('2026-01-01', '2026-02-28'),
      '2026-06-01',
    )
    expect(periods.map((p) => p.periodStart)).toEqual([
      '2026-01-01',
      '2026-02-01',
    ])
    expect(periods.at(-1)?.periodEnd).toBe('2026-02-28')
  })

  it('tiles without a gap or an overlap from a month-end anchor', () => {
    // The property the primary key and the carry chain both depend on, over the run of months
    // where the clamp actually bites.
    const periods = periodsThrough(monthly('2026-01-31'), '2027-01-31')
    expect(periods.length).toBe(13)
    for (let index = 0; index < periods.length - 1; index += 1) {
      const period = periods[index]
      const next = periods[index + 1]
      expect(periodAfter(monthly('2026-01-31'), period.periodStart)).toEqual(
        next,
      )
      // The end of one period is the day before the next begins.
      expect(
        Date.parse(`${next.periodStart}T00:00:00Z`) -
          Date.parse(`${period.periodEnd}T00:00:00Z`),
      ).toBe(86_400_000)
    }
  })

  it('keeps the most recent periods when the cap bites', () => {
    const periods = periodsThrough(monthly('2026-01-01'), '2026-06-01', 2)
    expect(periods.map((p) => p.periodStart)).toEqual([
      '2026-05-01',
      '2026-06-01',
    ])
  })
})
