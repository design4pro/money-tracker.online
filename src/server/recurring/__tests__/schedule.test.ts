/**
 * The calendar edge cases of a recurring series, each with a hand-written expected list.
 *
 * Hand-written on purpose: an expectation computed by the same arithmetic the subject uses agrees
 * with the subject about everything, including its bugs. Every list below was written out by
 * reading a calendar, which is why they are long.
 */

import { describe, expect, it } from 'vitest'

import { nextDueDates, occurrences } from '../schedule'

import type { RecurringSchedule } from '../schedule'

const MONTH_END: RecurringSchedule = {
  frequency: 'monthly',
  anchorDay: 31,
  startDate: '2026-01-31',
}

describe('month-end anchoring does not drift', () => {
  it('clamps to each month’s own length and returns to the 31st afterwards', () => {
    expect(nextDueDates({ ...MONTH_END, count: 7 })).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
    ])
  })

  it('gives February 29 in a leap year and February 28 in the three around it', () => {
    expect(
      nextDueDates({
        ...MONTH_END,
        startDate: '2027-01-31',
        count: 26,
      }).filter(
        (date) => date.startsWith('2027-02') || date.startsWith('2028-02'),
      ),
    ).toEqual(['2027-02-28', '2028-02-29'])
  })

  it('is identical whether it is asked for one date or for a hundred', () => {
    const long = nextDueDates({ ...MONTH_END, count: 60 })
    expect(long.slice(0, 7)).toEqual(nextDueDates({ ...MONTH_END, count: 7 }))
  })
})

describe('the leap-day anchor', () => {
  it('an annual series born on 29 February falls back to the 28th and recovers in 2028', () => {
    expect(
      nextDueDates({
        frequency: 'annual',
        anchorDay: 29,
        startDate: '2024-02-29',
        count: 5,
      }),
    ).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ])
  })
})

describe('biweekly counts from the start date', () => {
  it('steps fourteen days at a time, across a month boundary', () => {
    expect(
      nextDueDates({
        frequency: 'biweekly',
        anchorDay: null,
        startDate: '2026-01-07',
        count: 6,
      }),
    ).toEqual([
      '2026-01-07',
      '2026-01-21',
      '2026-02-04',
      '2026-02-18',
      '2026-03-04',
      '2026-03-18',
    ])
  })

  it('ignores anchor_day entirely — it is not a weekday anchor', () => {
    const withAnchor = nextDueDates({
      frequency: 'biweekly',
      anchorDay: 1,
      startDate: '2026-01-07',
      count: 4,
    })
    const withoutAnchor = nextDueDates({
      frequency: 'biweekly',
      anchorDay: null,
      startDate: '2026-01-07',
      count: 4,
    })
    expect(withAnchor).toEqual(withoutAnchor)
  })
})

describe('weekly', () => {
  it('moves forward to the anchored weekday, never backward', () => {
    // 2026-01-07 is a Wednesday; anchored on Monday (1) the first occurrence is the 12th.
    expect(
      nextDueDates({
        frequency: 'weekly',
        anchorDay: 1,
        startDate: '2026-01-07',
        count: 3,
      }),
    ).toEqual(['2026-01-12', '2026-01-19', '2026-01-26'])
  })

  /**
   * Poland moves to summer time on 2026-03-29 and back on 2026-10-25. A `Date`-based
   * implementation adding `7 * 86_400_000` milliseconds lands an hour early on the following
   * Sunday, and floors to the previous calendar day for any series whose stored time-of-day is
   * near midnight. There is no time of day here at all, and this is the assertion that says so.
   */
  it('does not shift across either Europe/Warsaw daylight-saving boundary', () => {
    expect(
      nextDueDates({
        frequency: 'weekly',
        anchorDay: 7,
        startDate: '2026-03-15',
        count: 4,
      }),
    ).toEqual(['2026-03-15', '2026-03-22', '2026-03-29', '2026-04-05'])

    expect(
      nextDueDates({
        frequency: 'weekly',
        anchorDay: 7,
        startDate: '2026-10-11',
        count: 4,
      }),
    ).toEqual(['2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01'])
  })
})

describe('terminations are inclusive, and only one may be set', () => {
  it('max_occurrences yields exactly that many occurrences', () => {
    expect(
      nextDueDates({
        frequency: 'monthly',
        anchorDay: 5,
        startDate: '2026-01-05',
        maxOccurrences: 3,
        count: 10,
      }),
    ).toEqual(['2026-01-05', '2026-02-05', '2026-03-05'])
  })

  it('end_date includes an occurrence that falls on it and excludes the next', () => {
    expect(
      nextDueDates({
        frequency: 'monthly',
        anchorDay: 5,
        startDate: '2026-01-05',
        endDate: '2026-03-05',
        count: 10,
      }),
    ).toEqual(['2026-01-05', '2026-02-05', '2026-03-05'])

    expect(
      nextDueDates({
        frequency: 'monthly',
        anchorDay: 5,
        startDate: '2026-01-05',
        endDate: '2026-03-04',
        count: 10,
      }),
    ).toEqual(['2026-01-05', '2026-02-05'])
  })

  it('an unterminated series is bounded only by what the caller asks for', () => {
    expect(
      nextDueDates({
        frequency: 'annual',
        anchorDay: 1,
        startDate: '2026-01-01',
        count: 4,
      }),
    ).toEqual(['2026-01-01', '2027-01-01', '2028-01-01', '2029-01-01'])
  })
})

describe('the first occurrence never precedes the start date', () => {
  it('skips an anchored day that has already gone by in the starting month', () => {
    expect(
      nextDueDates({
        frequency: 'monthly',
        anchorDay: 5,
        startDate: '2026-01-20',
        count: 2,
      }),
    ).toEqual(['2026-02-05', '2026-03-05'])
  })

  it('uses the start date’s own day when the series carries no anchor', () => {
    expect(
      nextDueDates({
        frequency: 'monthly',
        anchorDay: null,
        startDate: '2026-01-17',
        count: 3,
      }),
    ).toEqual(['2026-01-17', '2026-02-17', '2026-03-17'])
  })
})

describe('quarterly, semi-annual and annual step by their own number of months', () => {
  it.each([
    ['quarterly' as const, ['2026-02-10', '2026-05-10', '2026-08-10']],
    ['semi_annual' as const, ['2026-02-10', '2026-08-10', '2027-02-10']],
    ['annual' as const, ['2026-02-10', '2027-02-10', '2028-02-10']],
  ])('%s', (frequency, expected) => {
    expect(
      nextDueDates({
        frequency,
        anchorDay: 10,
        startDate: '2026-02-10',
        count: 3,
      }),
    ).toEqual(expected)
  })
})

describe('an occurrence carries the interval it opens', () => {
  it('a month-based period starts on the first of the month it is due in', () => {
    expect(occurrences(MONTH_END, { count: 2 })).toEqual([
      { index: 0, periodStart: '2026-01-01', dueOn: '2026-01-31' },
      { index: 1, periodStart: '2026-02-01', dueOn: '2026-02-28' },
    ])
  })

  it('a day-based period starts on the day it is due', () => {
    expect(
      occurrences(
        { frequency: 'weekly', anchorDay: null, startDate: '2026-01-07' },
        { count: 2 },
      ),
    ).toEqual([
      { index: 0, periodStart: '2026-01-07', dueOn: '2026-01-07' },
      { index: 1, periodStart: '2026-01-14', dueOn: '2026-01-14' },
    ])
  })

  it('keeps the index the termination counts, even when the window skips the early ones', () => {
    expect(occurrences(MONTH_END, { from: '2026-03-01', count: 2 })).toEqual([
      { index: 2, periodStart: '2026-03-01', dueOn: '2026-03-31' },
      { index: 3, periodStart: '2026-04-01', dueOn: '2026-04-30' },
    ])
  })

  it('`through` is inclusive and stops the walk', () => {
    expect(
      occurrences(MONTH_END, { through: '2026-03-31' }).map((o) => o.dueOn),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })
})

describe('the window is respected exactly', () => {
  it('returns nothing when nothing is asked for', () => {
    // The loop tests its cap after a push, so `count: 0` used to hand back one occurrence - which
    // is how a materialiser told to look zero periods ahead ends up writing one.
    expect(
      occurrences(
        { frequency: 'monthly', anchorDay: null, startDate: '2026-01-15' },
        { count: 0 },
      ),
    ).toEqual([])
  })
})
