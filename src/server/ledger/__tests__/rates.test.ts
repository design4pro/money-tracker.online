/**
 * The bulk rate timeline: the same resolution order as `resolveRate`, replayed in memory.
 *
 * The agreement case — this module and `repos/workspace-currencies.ts`'s `resolveRate` answering
 * identically day by day over one fixture — needs a database and lives in
 * `src/server/repos/__tests__/account-balances.test.ts`. What is here is the order itself.
 */

import { describe, expect, it } from 'vitest'

import { RATE_IDENTITY, asCurrencyCode, asRateE10 } from '#/lib/money'

import { RateTimelineUnavailableError, rateTimeline } from '../rates'

const EUR = asCurrencyCode('EUR')
const PLN = asCurrencyCode('PLN')

const CATALOGUE = [
  { date: '2026-03-13', rateE10: asRateE10(43_000_000_000) },
  { date: '2026-03-16', rateE10: asRateE10(43_500_000_000) },
  { date: '2026-03-17', rateE10: asRateE10(43_600_000_000) },
]

function timelineOf(
  overrides: Partial<Parameters<typeof rateTimeline>[0]> = {},
) {
  return rateTimeline({
    base: EUR,
    quote: PLN,
    flatRatesApply: false,
    flatRates: [],
    catalogue: CATALOGUE,
    ...overrides,
  })
}

describe('rateTimeline', () => {
  it('converts a currency into itself at exactly 1, with no lookup at all', () => {
    const timeline = rateTimeline({
      base: PLN,
      quote: PLN,
      flatRatesApply: false,
      flatRates: [],
      catalogue: [],
    })
    expect(timeline('2026-03-15')).toBe(RATE_IDENTITY)
  })

  it('takes the catalogue rate for the exact day (rung 2)', () => {
    expect(timelineOf()('2026-03-16')).toBe(43_500_000_000)
  })

  it('forward-fills the last catalogue day over a closed market (rung 3)', () => {
    // The 14th and 15th are a weekend: both take Friday the 13th's rate.
    const timeline = timelineOf()
    expect(timeline('2026-03-14')).toBe(43_000_000_000)
    expect(timeline('2026-03-15')).toBe(43_000_000_000)
  })

  it('values a day earlier than the whole catalogue at its earliest rate', () => {
    // The grid's first day is one day before the catalogue's first day in the demo fixture. A hole
    // there would be forward-filled on read as if it were a measurement — see the file docblock.
    expect(timelineOf()('2026-03-12')).toBe(43_000_000_000)
  })

  it('lets a workspace flat rate win over the catalogue (rung 1)', () => {
    const timeline = timelineOf({
      flatRatesApply: true,
      flatRates: [
        {
          effectiveFrom: '2026-03-15',
          effectiveTo: null,
          rateE10: asRateE10(42_000_000_000),
        },
      ],
    })
    expect(timeline('2026-03-14')).toBe(43_000_000_000)
    expect(timeline('2026-03-16')).toBe(42_000_000_000)
  })

  it('treats a flat rate as a range, not a point', () => {
    const timeline = timelineOf({
      flatRatesApply: true,
      flatRates: [
        {
          effectiveFrom: '2026-03-01',
          effectiveTo: '2026-03-16',
          rateE10: asRateE10(42_000_000_000),
        },
      ],
    })
    expect(timeline('2026-03-16')).toBe(42_000_000_000)
    expect(timeline('2026-03-17')).toBe(43_600_000_000)
  })

  it('ignores flat rates when the two §2.3 conditions are not both met', () => {
    const timeline = timelineOf({
      flatRatesApply: false,
      flatRates: [
        {
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          rateE10: asRateE10(42_000_000_000),
        },
      ],
    })
    expect(timeline('2026-03-16')).toBe(43_500_000_000)
  })

  it('answers the same rate whichever order the days are asked in', () => {
    // The cursor only moves forward for the walk's benefit; a caller that jumps backwards still
    // gets the right answer, just not as cheaply.
    const timeline = timelineOf()
    const forwards = ['2026-03-13', '2026-03-16', '2026-03-17'].map(timeline)
    const backwards = ['2026-03-17', '2026-03-16', '2026-03-13'].map(timeline)
    expect(backwards.reverse()).toEqual(forwards)
  })

  it('refuses rather than inventing a rate when the pair has none anywhere', () => {
    expect(() =>
      rateTimeline({
        base: EUR,
        quote: PLN,
        flatRatesApply: false,
        flatRates: [],
        catalogue: [],
      }),
    ).toThrow(RateTimelineUnavailableError)
  })

  it('refuses a day no flat range covers when the catalogue is empty', () => {
    const timeline = rateTimeline({
      base: EUR,
      quote: PLN,
      flatRatesApply: true,
      flatRates: [
        {
          effectiveFrom: '2026-03-01',
          effectiveTo: '2026-03-10',
          rateE10: asRateE10(42_000_000_000),
        },
      ],
      catalogue: [],
    })
    expect(timeline('2026-03-05')).toBe(42_000_000_000)
    expect(() => timeline('2026-03-11')).toThrow(RateTimelineUnavailableError)
  })
})
