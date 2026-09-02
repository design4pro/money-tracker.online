/**
 * The grid algorithm, with no database anywhere near it.
 *
 * Every case here is a claim from `docs/MONEY.md` §5.2 or §6.2 stated as arithmetic. The
 * database-backed half — that a real create, edit and delete leave the grid agreeing with
 * `accounts.current_balance_minor` — is `src/server/repos/__tests__/account-balances.test.ts`.
 */

import { describe, expect, it } from 'vitest'

import {
  RATE_IDENTITY,
  asCurrencyCode,
  asMinor,
  asRateE10,
  convert,
} from '#/lib/money'

import {
  GridSpanError,
  MAX_GRID_DAYS,
  buildGrid,
  daysBetween,
  gridBounds,
  shiftUtcDate,
  utcDateOf,
} from '../grid'

import type { Revalue } from '../grid'

const TODAY = '2026-09-30'
const EUR = asCurrencyCode('EUR')
const PLN = asCurrencyCode('PLN')

/** A base-currency account: `ref` equals `native`, at a rate of exactly 1. */
const identity: Revalue = (nativeMinor) => ({
  refMinor: nativeMinor,
  rateE10: RATE_IDENTITY,
})

/** A foreign account priced by a per-day rate table, forward-filled from the first entry. */
function pricedBy(
  rates: ReadonlyMap<string, number>,
  fallback: number,
): Revalue {
  return (nativeMinor, date) => {
    const rateE10 = asRateE10(rates.get(date) ?? fallback)
    const converted = convert({
      amount: { amountMinor: nativeMinor, currencyCode: EUR },
      to: PLN,
      rateE10,
    })
    return { refMinor: converted.amountMinor, rateE10 }
  }
}

function deltasOf(entries: ReadonlyArray<readonly [string, number]>) {
  return new Map(entries)
}

describe('utc day arithmetic', () => {
  it('buckets by UTC, not by the local timezone the process happens to run in', () => {
    // 23:30 in Warsaw on the 15th is 21:30 UTC on the 15th; 01:30 on the 16th is 23:30 UTC on the
    // 15th. `docs/MONEY.md` §6.2: the grid key is the UTC day and nothing else.
    expect(utcDateOf(Date.parse('2026-03-15T21:30:00.000Z'))).toBe('2026-03-15')
    expect(utcDateOf(Date.parse('2026-03-15T23:30:00.000Z'))).toBe('2026-03-15')
    expect(utcDateOf(Date.parse('2026-03-16T00:30:00.000Z'))).toBe('2026-03-16')
  })

  it('crosses month, year and leap-day edges by instants rather than by text', () => {
    expect(shiftUtcDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftUtcDate('2027-01-01', -1)).toBe('2026-12-31')
    expect(shiftUtcDate('2028-02-28', 1)).toBe('2028-02-29')
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1)
  })

  it('is unaffected by a daylight-saving transition', () => {
    // Poland moves its clocks on 2026-03-29. A local-time `Date` would make this span 30 days and
    // 23 hours, and `Math.round` would only hide it until the day the rounding tipped.
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31)
  })
})

describe('gridBounds', () => {
  it('opens the day before the first transaction, where the initial balance lives', () => {
    expect(
      gridBounds({
        today: TODAY,
        firstTransactionOn: '2026-01-10',
        lastTransactionOn: '2026-09-12',
        oldestSnapshot: null,
        newestSnapshot: null,
      }),
    ).toEqual({ from: '2026-01-09', to: TODAY })
  })

  it('reaches today at both ends when the account has no transactions at all', () => {
    expect(
      gridBounds({
        today: TODAY,
        firstTransactionOn: null,
        lastTransactionOn: null,
        oldestSnapshot: null,
        newestSnapshot: null,
      }),
    ).toEqual({ from: '2026-09-29', to: TODAY })
  })

  it('values a future-dated settled transaction rather than stopping at today', () => {
    expect(
      gridBounds({
        today: TODAY,
        firstTransactionOn: '2026-09-01',
        lastTransactionOn: '2026-12-24',
        oldestSnapshot: null,
        newestSnapshot: null,
      }).to,
    ).toBe('2026-12-24')
  })

  it('covers every stored snapshot, so delete-range can leave nothing behind', () => {
    // Both extremes are outside the transaction span. A range that did not reach them would leave
    // stale rows either side of the rebuilt grid, and forward-fill on read cannot tell a survivor
    // from a measurement.
    expect(
      gridBounds({
        today: TODAY,
        firstTransactionOn: '2026-05-01',
        lastTransactionOn: '2026-05-02',
        oldestSnapshot: '2024-01-01',
        newestSnapshot: '2027-06-30',
      }),
    ).toEqual({ from: '2024-01-01', to: '2027-06-30' })
  })

  it('refuses a span no Worker could walk instead of looping for two million days', () => {
    expect(() =>
      gridBounds({
        today: TODAY,
        firstTransactionOn: '2026-01-01',
        lastTransactionOn: '9999-12-31',
        oldestSnapshot: null,
        newestSnapshot: null,
      }),
    ).toThrow(GridSpanError)
    expect(MAX_GRID_DAYS).toBeGreaterThan(365 * 30)
  })
})

describe('buildGrid', () => {
  it('emits both ends of the grid, whatever they equal', () => {
    const rows = buildGrid({
      bounds: { from: '2026-09-01', to: '2026-09-05' },
      openingMinor: asMinor(1_000_00),
      deltas: deltasOf([]),
      revalue: identity,
    })

    expect(rows.map((row) => row.date)).toEqual(['2026-09-01', '2026-09-05'])
    expect(rows.map((row) => row.nativeMinor)).toEqual([1_000_00, 1_000_00])
  })

  it('omits a day that repeats the previous emitted day and keeps the ones that move', () => {
    const rows = buildGrid({
      bounds: { from: '2026-09-01', to: '2026-09-06' },
      openingMinor: asMinor(0),
      deltas: deltasOf([
        ['2026-09-03', 250_00],
        ['2026-09-05', -100_00],
      ]),
      revalue: identity,
    })

    expect(rows).toEqual([
      {
        date: '2026-09-01',
        nativeMinor: 0,
        refMinor: 0,
        rateE10: RATE_IDENTITY,
      },
      {
        date: '2026-09-03',
        nativeMinor: 250_00,
        refMinor: 250_00,
        rateE10: RATE_IDENTITY,
      },
      {
        date: '2026-09-05',
        nativeMinor: 150_00,
        refMinor: 150_00,
        rateE10: RATE_IDENTITY,
      },
      {
        date: '2026-09-06',
        nativeMinor: 150_00,
        refMinor: 150_00,
        rateE10: RATE_IDENTITY,
      },
    ])
  })

  it('puts the opening balance on the day before the first movement', () => {
    const rows = buildGrid({
      bounds: { from: '2026-09-01', to: '2026-09-02' },
      openingMinor: asMinor(3_200_00),
      deltas: deltasOf([['2026-09-02', -200_00]]),
      revalue: identity,
    })

    expect(rows[0]).toMatchObject({ date: '2026-09-01', nativeMinor: 3_200_00 })
    expect(rows[1]).toMatchObject({ date: '2026-09-02', nativeMinor: 3_000_00 })
  })

  it('is a rebuild, not an accumulator: a long gap posts no phantom loss', () => {
    // `docs/MONEY.md` §8, the recorded failure. €5 000 held across a year in which the rate moved
    // from 4,00 to 4,50, then one €5 expense on the last day. An accumulator of *converted* deltas
    // would post a one-day loss of the whole revaluation; a rebuild posts the €5 and the daily
    // revaluation of the holding, and nothing else.
    const from = '2026-01-01'
    const to = '2026-01-04'
    const rates = new Map([
      ['2026-01-01', 40_000_000_000],
      ['2026-01-02', 45_000_000_000],
      ['2026-01-03', 45_000_000_000],
      ['2026-01-04', 45_000_000_000],
    ])

    const rows = buildGrid({
      bounds: { from, to },
      openingMinor: asMinor(5_000_00),
      deltas: deltasOf([['2026-01-04', -5_00]]),
      revalue: pricedBy(rates, 45_000_000_000),
    })

    const byDate = new Map(rows.map((row) => [row.date, row]))
    // Every day's ref is that day's native at that day's rate — never yesterday's converted total.
    expect(byDate.get('2026-01-01')).toMatchObject({
      nativeMinor: 5_000_00,
      refMinor: 20_000_00,
    })
    expect(byDate.get('2026-01-02')).toMatchObject({
      nativeMinor: 5_000_00,
      refMinor: 22_500_00,
    })
    // The last day moves by the transaction's own value at that day's rate, 5,00 × 4,50 = 22,50.
    expect(byDate.get('2026-01-04')).toMatchObject({
      nativeMinor: 4_995_00,
      refMinor: 22_477_50,
    })
    // 2026-01-03 is omitted — it repeats the 2nd — so a reader forward-fills 22 500,00 into it.
    // The step into the 4th is the €5 expense and nothing else.
    expect(byDate.has('2026-01-03')).toBe(false)
    expect(
      (byDate.get('2026-01-02')?.refMinor ?? 0) -
        (byDate.get('2026-01-04')?.refMinor ?? 0),
    ).toBe(22_50)
  })

  it('reports zero in the base currency for a natively-zero account at any rate', () => {
    const rows = buildGrid({
      bounds: { from: '2026-01-01', to: '2026-01-03' },
      openingMinor: asMinor(0),
      deltas: deltasOf([]),
      revalue: pricedBy(
        new Map([
          ['2026-01-01', 40_000_000_000],
          ['2026-01-02', 99_000_000_000],
        ]),
        45_000_000_000,
      ),
    })

    expect(rows.every((row) => row.refMinor === 0)).toBe(true)
  })

  it('emits a day whose rate moved even though its holding did not', () => {
    // The triple decides, not the native amount: the account is worth a different number of złoty
    // that day, and omitting it would have a reader forward-fill a stale valuation.
    const rows = buildGrid({
      bounds: { from: '2026-01-01', to: '2026-01-03' },
      openingMinor: asMinor(100_00),
      deltas: deltasOf([]),
      revalue: pricedBy(
        new Map([
          ['2026-01-01', 40_000_000_000],
          ['2026-01-02', 45_000_000_000],
          ['2026-01-03', 45_000_000_000],
        ]),
        45_000_000_000,
      ),
    })

    expect(rows.map((row) => [row.date, row.refMinor])).toEqual([
      ['2026-01-01', 400_00],
      ['2026-01-02', 450_00],
      ['2026-01-03', 450_00],
    ])
  })

  it('rounds the daily revaluation half-to-even, once, at the final step', () => {
    // 15 grosz-equivalents at 4,30 is exactly 64,5 — a tie. `docs/MONEY.md` §1.4: half-to-even, so
    // it goes to 64 rather than up. Half-up here would bias every tie in one direction across a
    // whole portfolio of daily revaluations.
    const rows = buildGrid({
      bounds: { from: '2026-01-01', to: '2026-01-01' },
      openingMinor: asMinor(15),
      deltas: deltasOf([]),
      revalue: pricedBy(new Map(), 43_000_000_000),
    })

    expect(rows[0]?.refMinor).toBe(64)
  })

  it('walks the whole range in integers, with no float anywhere in the total', () => {
    const rows = buildGrid({
      bounds: { from: '2026-01-01', to: '2026-01-10' },
      openingMinor: asMinor(0),
      deltas: deltasOf([
        ['2026-01-02', 33],
        ['2026-01-05', 33],
        ['2026-01-09', 34],
      ]),
      revalue: identity,
    })

    for (const row of rows) {
      expect(Number.isInteger(row.nativeMinor)).toBe(true)
      expect(Number.isInteger(row.refMinor)).toBe(true)
    }
    expect(rows.at(-1)?.nativeMinor).toBe(100)
  })

  it('refuses a range whose end precedes its start', () => {
    const bounds = { from: '2026-09-30', to: '2026-09-01' }
    expect(() =>
      buildGrid({
        bounds,
        openingMinor: asMinor(0),
        deltas: deltasOf([]),
        revalue: identity,
      }),
    ).toThrow(GridSpanError)
  })
})
