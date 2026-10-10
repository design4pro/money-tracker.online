/**
 * `latestCalendarDayOnEarth` is a pure function of the instant it is given, so every case here
 * names its instant and nothing mocks a clock.
 */

import { describe, expect, it } from 'vitest'

import { latestCalendarDayOnEarth } from '../clock'

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
