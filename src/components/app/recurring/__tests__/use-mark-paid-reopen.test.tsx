import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import {
  findReopenedPeriod,
  hasMarkPaidSearch,
  markPaidReopenId,
  useMarkPaidReopen,
} from '../use-mark-paid-reopen'

/**
 * The `?markPaid=` reopen / close-and-clear address, asserted without a route.
 *
 * Three screens share this (the list, the series detail, planned). What must not drift is which
 * period the address names, and that closing the picker drops the query so a reload does not
 * reopen it.
 */

type FixturePeriod = {
  readonly seriesId: string
  readonly periodStart: string
  readonly derivedStatus: 'upcoming' | 'paid' | 'skipped'
}

const RENT_MARCH: FixturePeriod = {
  seriesId: 'ser-rent',
  periodStart: '2026-03-01',
  derivedStatus: 'upcoming',
}
const NETFLIX_MARCH: FixturePeriod = {
  seriesId: 'ser-netflix',
  periodStart: '2026-03-01',
  derivedStatus: 'upcoming',
}
const RENT_APRIL_PAID: FixturePeriod = {
  seriesId: 'ser-rent',
  periodStart: '2026-04-01',
  derivedStatus: 'paid',
}

const of = (row: FixturePeriod) => ({
  periodStart: row.periodStart,
  seriesId: row.seriesId,
})

describe('markPaidReopenId', () => {
  it('names a period as series:start when both halves of the address are present', () => {
    expect(
      markPaidReopenId({ markPaid: '2026-03-01', series: 'ser-rent' }),
    ).toBe('ser-rent:2026-03-01')
  })

  it('names nothing when either half is missing, so a mixed list cannot guess', () => {
    expect(markPaidReopenId({ markPaid: '2026-03-01' })).toBeNull()
    expect(markPaidReopenId({ series: 'ser-rent' })).toBeNull()
    expect(markPaidReopenId({})).toBeNull()
  })
})

describe('hasMarkPaidSearch', () => {
  it('is true when either half is still in the address', () => {
    expect(hasMarkPaidSearch({ markPaid: '2026-03-01' })).toBe(true)
    expect(hasMarkPaidSearch({ series: 'ser-rent' })).toBe(true)
    expect(hasMarkPaidSearch({})).toBe(false)
  })
})

describe('findReopenedPeriod', () => {
  const periods = [RENT_MARCH, NETFLIX_MARCH, RENT_APRIL_PAID]

  it('on a mixed list, matches period start and series together', () => {
    expect(
      findReopenedPeriod(
        periods,
        { markPaid: '2026-03-01', series: 'ser-netflix' },
        of,
        { matchSeries: true },
      ),
    ).toEqual(NETFLIX_MARCH)
  })

  it('on a mixed list, matches nothing when the series half is missing', () => {
    expect(
      findReopenedPeriod(periods, { markPaid: '2026-03-01' }, of, {
        matchSeries: true,
      }),
    ).toBeUndefined()
  })

  it('on a mixed list, matches nothing when that series has no such period', () => {
    expect(
      findReopenedPeriod(
        periods,
        { markPaid: '2026-04-01', series: 'ser-netflix' },
        of,
        { matchSeries: true },
      ),
    ).toBeUndefined()
  })

  it('on one series, matches the period start alone and refuses a settled period', () => {
    expect(
      findReopenedPeriod(periods, { markPaid: '2026-03-01' }, of, {
        matchSeries: false,
        canOpen: (row) =>
          row.derivedStatus !== 'paid' && row.derivedStatus !== 'skipped',
      }),
    ).toEqual(RENT_MARCH)
    expect(
      findReopenedPeriod(periods, { markPaid: '2026-04-01' }, of, {
        matchSeries: false,
        canOpen: (row) =>
          row.derivedStatus !== 'paid' && row.derivedStatus !== 'skipped',
      }),
    ).toBeUndefined()
  })
})

describe('useMarkPaidReopen', () => {
  it('opens on the resolved period and close drops it and clears the address', () => {
    const onClearSearch = vi.fn()
    const { result } = renderHook(() =>
      useMarkPaidReopen<FixturePeriod>({
        search: { markPaid: '2026-03-01', series: 'ser-rent' },
        initial: RENT_MARCH,
        onClearSearch,
      }),
    )

    expect(result.current.pending).toEqual(RENT_MARCH)
    expect(result.current.reopenId).toBe('ser-rent:2026-03-01')

    act(() => {
      result.current.close()
    })

    expect(result.current.pending).toBeNull()
    expect(onClearSearch).toHaveBeenCalledTimes(1)
  })

  it('does not clear the address when it never carried mark-paid params', () => {
    const onClearSearch = vi.fn()
    const { result } = renderHook(() =>
      useMarkPaidReopen<FixturePeriod>({
        search: {},
        initial: null,
        onClearSearch,
      }),
    )

    act(() => {
      result.current.open(RENT_MARCH)
    })
    expect(result.current.pending).toEqual(RENT_MARCH)
    expect(result.current.reopenId).toBeNull()

    act(() => {
      result.current.close()
    })

    expect(result.current.pending).toBeNull()
    expect(onClearSearch).not.toHaveBeenCalled()
  })
})
