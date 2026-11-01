/**
 * `latestCalendarDayOnEarth` is a pure function of the instant it is given, so every case here
 * names its instant and nothing mocks a clock.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_WORKSPACE_TIMEZONE,
  civilDayInTimeZone,
  isIanaTimeZone,
  latestCalendarDayOnEarth,
} from '../calendar-day'

describe('latestCalendarDayOnEarth', () => {
  it('is still day D one second before 10:00 UTC, when UTC+14 reaches midnight', () => {
    expect(latestCalendarDayOnEarth(new Date('2026-03-15T09:59:59.999Z'))).toBe(
      '2026-03-15',
    )
  })

  it('is day D+1 from 10:00:00 UTC, the first instant UTC+14 is on the next day', () => {
    expect(latestCalendarDayOnEarth(new Date('2026-03-15T10:00:00.000Z'))).toBe(
      '2026-03-16',
    )
  })

  it('rolls over the end of a month and of a year', () => {
    expect(latestCalendarDayOnEarth(new Date('2026-02-28T12:00:00.000Z'))).toBe(
      '2026-03-01',
    )
    expect(latestCalendarDayOnEarth(new Date('2026-12-31T23:00:00.000Z'))).toBe(
      '2027-01-01',
    )
  })

  it('reads the wall clock only when no instant is passed', () => {
    const before = Date.now()
    const day = latestCalendarDayOnEarth()
    const after = Date.now()
    const expected = (ms: number) =>
      new Date(ms + 14 * 3_600_000).toISOString().slice(0, 10)
    expect([expected(before), expected(after)]).toContain(day)
  })
})

describe('civilDayInTimeZone', () => {
  it('is the Warsaw civil day, not the UTC date, around midnight in summer', () => {
    // 22:30 UTC on 15 July is 00:30 CEST on the 16th.
    expect(
      civilDayInTimeZone(new Date('2026-07-15T22:30:00.000Z'), 'Europe/Warsaw'),
    ).toBe('2026-07-16')
    expect(
      civilDayInTimeZone(new Date('2026-07-15T21:30:00.000Z'), 'Europe/Warsaw'),
    ).toBe('2026-07-15')
  })

  it('is the Warsaw civil day around midnight in winter', () => {
    // 23:30 UTC on 15 January is 00:30 CET on the 16th.
    expect(
      civilDayInTimeZone(new Date('2026-01-15T23:30:00.000Z'), 'Europe/Warsaw'),
    ).toBe('2026-01-16')
    expect(
      civilDayInTimeZone(new Date('2026-01-15T22:30:00.000Z'), 'Europe/Warsaw'),
    ).toBe('2026-01-15')
  })

  it('falls back to Warsaw when the zone is not a real IANA name', () => {
    expect(
      civilDayInTimeZone(new Date('2026-07-15T22:30:00.000Z'), 'Not/AZone'),
    ).toBe('2026-07-16')
  })
})

describe('isIanaTimeZone', () => {
  it('accepts Warsaw and rejects garbage', () => {
    expect(isIanaTimeZone(DEFAULT_WORKSPACE_TIMEZONE)).toBe(true)
    expect(isIanaTimeZone('UTC')).toBe(true)
    expect(isIanaTimeZone('Not/AZone')).toBe(false)
    expect(isIanaTimeZone('')).toBe(false)
  })
})
