import { CalendarDate } from '@internationalized/date'
import { describe, expect, it } from 'vitest'

import {
  formatCalendarDate,
  formatCalendarDateRange,
  formatCompactNumber,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatPercentChange,
  formatRelativeTime,
  formatTime,
  relativeTimeParts,
  toCalendarDateValue,
} from '../format'

/** Whitespace inside a formatted figure is a non-breaking space in Polish. */
function tight(value: string): string {
  return value.replace(/\s/g, '')
}

describe('calendar dates', () => {
  it('reads the YYYY-MM-DD form every date column in this product holds', () => {
    const parsed = toCalendarDateValue('2025-12-31')
    expect([parsed.year, parsed.month, parsed.day]).toEqual([2025, 12, 31])
  })

  it('accepts a value a React Aria DatePicker already produced', () => {
    expect(toCalendarDateValue(new CalendarDate(2025, 12, 31)).day).toBe(31)
  })

  it('formats in the order each language reads dates in', () => {
    expect(formatCalendarDate('pl', '2025-12-31', 'short')).toBe('31.12.2025')
    expect(formatCalendarDate('en', '2025-12-31', 'short')).toBe('12/31/2025')
  })

  /**
   * A calendar date has no timezone. Formatting one through the machine's local
   * zone is how a transaction booked on the 1st lands under the 31st for anyone
   * west of Greenwich — so this holds whatever `TZ` the test runner has.
   */
  it('never shifts a day, whatever timezone the runtime is in', () => {
    expect(formatCalendarDate('pl', '2025-01-01', 'short')).toBe('01.01.2025')
    expect(formatCalendarDate('pl', '2025-12-31', 'short')).toBe('31.12.2025')
  })

  /**
   * The ledger's date column below `sm`: the day of the month alone, under a heading that has
   * already named the month, because a ten-character date does not fit a 44px track without
   * printing over the payee beside it.
   */
  it('writes the day of the month on its own for the narrowest column', () => {
    expect(formatCalendarDate('pl', '2025-12-31', 'day')).toBe('31')
    expect(formatCalendarDate('en', '2025-12-31', 'day')).toBe('31')
    expect(formatCalendarDate('en', '2025-12-01', 'day')).toBe('1')
  })

  it('names the month in the reader language for the styles that spell it out', () => {
    expect(formatCalendarDate('pl', '2025-12-31', 'long')).toContain('grudnia')
    expect(formatCalendarDate('en', '2025-12-31', 'long')).toContain('December')
    expect(formatCalendarDate('pl', '2025-12-31', 'full')).toContain('środa')
  })

  it('collapses a range the way the locale collapses it', () => {
    const range = formatCalendarDateRange(
      'en',
      '2025-12-01',
      '2025-12-31',
      'medium',
    )
    expect(range).toContain('2025')
    expect(range).toContain('Dec')
    expect(range.length).toBeLessThan('1 Dec 2025 - 31 Dec 2025'.length + 8)
  })
})

describe('instants', () => {
  /** 2025-12-31T23:30:00Z — half an hour before midnight UTC. */
  const instant = Date.UTC(2025, 11, 31, 23, 30)

  it('renders in the timezone it is given, not the machine one', () => {
    // Warsaw is UTC+1 in winter, so this instant is already the 1st there.
    expect(formatDateTime('pl', instant, 'Europe/Warsaw', 'short')).toContain(
      '01.01.2026',
    )
    expect(formatDateTime('pl', instant, 'UTC', 'short')).toContain(
      '31.12.2025',
    )
  })

  it('renders a clock time on its own', () => {
    expect(tight(formatTime('pl', instant, 'UTC'))).toContain('23:30')
    expect(tight(formatTime('pl', instant, 'Europe/Warsaw'))).toContain('00:30')
  })
})

describe('relative time', () => {
  const now = Date.UTC(2025, 5, 15, 12, 0)

  it('chooses the unit a gap reads best in', () => {
    expect(relativeTimeParts(now - 30_000, now)).toEqual({
      value: -30,
      unit: 'second',
    })
    expect(relativeTimeParts(now - 5 * 60_000, now)).toEqual({
      value: -5,
      unit: 'minute',
    })
    expect(relativeTimeParts(now - 3 * 3_600_000, now)).toEqual({
      value: -3,
      unit: 'hour',
    })
    expect(relativeTimeParts(now - 3 * 86_400_000, now)).toEqual({
      value: -3,
      unit: 'day',
    })
    expect(relativeTimeParts(now - 14 * 86_400_000, now)).toEqual({
      value: -2,
      unit: 'week',
    })
    expect(relativeTimeParts(now - 70 * 86_400_000, now)).toEqual({
      value: -2,
      unit: 'month',
    })
    expect(relativeTimeParts(now - 800 * 86_400_000, now)).toEqual({
      value: -2,
      unit: 'year',
    })
  })

  it('keeps the direction of a future gap', () => {
    expect(relativeTimeParts(now + 3 * 86_400_000, now)).toEqual({
      value: 3,
      unit: 'day',
    })
  })

  it('renders in the reader language', () => {
    expect(formatRelativeTime('pl', now - 3 * 86_400_000, now)).toContain('dni')
    expect(formatRelativeTime('en', now - 3 * 86_400_000, now)).toContain('ago')
  })

  it('says yesterday rather than one day ago', () => {
    expect(formatRelativeTime('en', now - 86_400_000, now)).toBe('yesterday')
    expect(formatRelativeTime('pl', now - 86_400_000, now)).toBe('wczoraj')
  })
})

describe('numbers', () => {
  it('groups the way each language groups', () => {
    expect(formatNumber('en', 1_234_567)).toBe('1,234,567')
    expect(tight(formatNumber('pl', 1_234_567))).toBe('1234567')
    expect(formatNumber('pl', 1_234_567)).not.toContain(',')
  })

  it('compacts a count for a dense tile', () => {
    expect(tight(formatCompactNumber('en', 1200))).toBe('1.2K')
    expect(formatCompactNumber('pl', 1200)).toContain('1,2')
  })

  it('renders a fraction as a percentage, not the other way round', () => {
    expect(tight(formatPercent('en', 0.72))).toBe('72%')
    expect(tight(formatPercent('pl', 0.72))).toBe('72%')
    expect(tight(formatPercent('en', 0.7234, 1))).toBe('72.3%')
  })

  it('shows the direction of a change but not a sign on zero', () => {
    expect(tight(formatPercentChange('en', 0.12))).toBe('+12%')
    expect(tight(formatPercentChange('en', -0.04))).toContain('4%')
    expect(tight(formatPercentChange('en', -0.04))).not.toContain('+')
    expect(tight(formatPercentChange('en', 0))).toBe('0%')
  })
})
