/**
 * Hand-written forecast totals. An expectation computed by summing the same way the subject
 * does would agree with it about its bugs; every figure below was counted on a calendar.
 */

import { describe, expect, it } from 'vitest'

import { asMinor } from '#/lib/money'

import { forecastSeries, rollupForecasts } from '../forecast'

import type { RecurringSchedule } from '../schedule'
import type { ForecastPeriod } from '../forecast'

const MONTHLY: RecurringSchedule = {
  frequency: 'monthly',
  anchorDay: 20,
  startDate: '2026-01-20',
}

const TODAY = '2026-06-15'
const EXPECTED = 100_00

function paid(periodStart: string): ForecastPeriod {
  return { periodStart, derivedStatus: 'paid' }
}

describe('forecastSeries', () => {
  it('counts spent as the integer sum of this year’s linked transactions', () => {
    const forecast = forecastSeries({
      direction: 'expense',
      schedule: MONTHLY,
      expectedAmountMinor: EXPECTED,
      expectedCurrencyCode: 'PLN',
      isActive: true,
      today: TODAY,
      links: [
        {
          direction: 'expense',
          bookedOn: '2026-01-20',
          amountMinor: 100_00,
          currencyCode: 'PLN',
          status: 'active',
        },
        {
          direction: 'expense',
          bookedOn: '2026-02-20',
          amountMinor: 100_00,
          currencyCode: 'PLN',
          status: 'active',
        },
        {
          direction: 'expense',
          bookedOn: '2025-12-20',
          amountMinor: 100_00,
          currencyCode: 'PLN',
          status: 'active',
        },
        {
          direction: 'expense',
          bookedOn: '2026-03-20',
          amountMinor: 80_00,
          currencyCode: 'EUR',
          status: 'active',
        },
        {
          direction: 'expense',
          bookedOn: '2026-04-20',
          amountMinor: 100_00,
          currencyCode: 'PLN',
          status: 'unlinked',
        },
      ],
      periods: [
        paid('2026-01-01'),
        paid('2026-02-01'),
        paid('2026-03-01'),
        paid('2026-04-01'),
        paid('2026-05-01'),
      ],
    })

    // Two PLN rows this year. The 2025 row, the euro row and the unlinked row stay out.
    expect(forecast.spentThisYearMinor).toBe(asMinor(200_00))
    expect(Number.isInteger(forecast.spentThisYearMinor)).toBe(true)
  })

  it('counts the rest of the year as expected amounts still open in this calendar year', () => {
    const forecast = forecastSeries({
      direction: 'expense',
      schedule: MONTHLY,
      expectedAmountMinor: EXPECTED,
      expectedCurrencyCode: 'PLN',
      isActive: true,
      today: TODAY,
      links: [],
      periods: [
        paid('2026-01-01'),
        paid('2026-02-01'),
        paid('2026-03-01'),
        paid('2026-04-01'),
        paid('2026-05-01'),
        { periodStart: '2026-06-01', derivedStatus: 'upcoming' },
      ],
    })

    // 20 June through 20 December: seven months. January–May are paid.
    expect(forecast.restOfYearMinor).toBe(asMinor(700_00))
  })

  it('counts the next twelve months from tomorrow, excluding what is already paid', () => {
    const forecast = forecastSeries({
      direction: 'expense',
      schedule: MONTHLY,
      expectedAmountMinor: EXPECTED,
      expectedCurrencyCode: 'PLN',
      isActive: true,
      today: TODAY,
      links: [],
      periods: [
        paid('2026-01-01'),
        paid('2026-02-01'),
        paid('2026-03-01'),
        paid('2026-04-01'),
        paid('2026-05-01'),
      ],
    })

    // 20 Jun 2026 … 20 May 2027 inclusive = 12. 20 Jun 2027 is after 15 Jun 2027.
    expect(forecast.next12MonthsMinor).toBe(asMinor(1_200_00))
  })

  it('keeps an overdue unpaid occurrence in the rest of this year', () => {
    const forecast = forecastSeries({
      direction: 'expense',
      schedule: MONTHLY,
      expectedAmountMinor: EXPECTED,
      expectedCurrencyCode: 'PLN',
      isActive: true,
      today: TODAY,
      links: [],
      periods: [
        paid('2026-01-01'),
        { periodStart: '2026-02-01', derivedStatus: 'overdue' },
        paid('2026-03-01'),
        paid('2026-04-01'),
        paid('2026-05-01'),
        { periodStart: '2026-06-01', derivedStatus: 'upcoming' },
      ],
    })

    // February still open, plus June–December: 1 + 7.
    expect(forecast.restOfYearMinor).toBe(asMinor(800_00))
  })

  it('forecasts an annual series on its yearly month, not the start date’s month', () => {
    const forecast = forecastSeries({
      direction: 'expense',
      schedule: {
        frequency: 'annual',
        anchorDay: 10,
        anchorMonth: 11,
        startDate: '2026-03-15',
      },
      expectedAmountMinor: 500_00,
      expectedCurrencyCode: 'PLN',
      isActive: true,
      today: TODAY,
      links: [],
      periods: [],
    })

    expect(forecast.spentThisYearMinor).toBe(asMinor(0))
    expect(forecast.restOfYearMinor).toBe(asMinor(500_00))
    // 10 Nov 2026 is inside the next twelve months; 10 Nov 2027 is after 15 Jun 2027.
    expect(forecast.next12MonthsMinor).toBe(asMinor(500_00))
  })

  it('forecasts nothing for an income series, which is not money going out', () => {
    const forecast = forecastSeries({
      direction: 'income',
      schedule: MONTHLY,
      expectedAmountMinor: EXPECTED,
      expectedCurrencyCode: 'PLN',
      isActive: true,
      today: TODAY,
      links: [
        {
          direction: 'income',
          bookedOn: '2026-01-20',
          amountMinor: 100_00,
          currencyCode: 'PLN',
          status: 'active',
        },
      ],
      periods: [],
    })

    expect(forecast.spentThisYearMinor).toBe(asMinor(0))
    expect(forecast.restOfYearMinor).toBe(asMinor(0))
    expect(forecast.next12MonthsMinor).toBe(asMinor(0))
  })

  it('does not count a linked income row as spent, even on an expense series', () => {
    const forecast = forecastSeries({
      direction: 'expense',
      schedule: MONTHLY,
      expectedAmountMinor: EXPECTED,
      expectedCurrencyCode: 'PLN',
      isActive: true,
      today: TODAY,
      links: [
        {
          direction: 'expense',
          bookedOn: '2026-01-20',
          amountMinor: 100_00,
          currencyCode: 'PLN',
          status: 'active',
        },
        {
          // A refund linked by hand: `amount_minor` is non-negative, the column says which way.
          direction: 'income',
          bookedOn: '2026-02-20',
          amountMinor: 30_00,
          currencyCode: 'PLN',
          status: 'active',
        },
      ],
      periods: [],
    })

    expect(forecast.spentThisYearMinor).toBe(asMinor(100_00))
  })

  it('plans nothing ahead for a paused series but still reports what was spent', () => {
    const forecast = forecastSeries({
      direction: 'expense',
      schedule: MONTHLY,
      expectedAmountMinor: EXPECTED,
      expectedCurrencyCode: 'PLN',
      isActive: false,
      today: TODAY,
      links: [
        {
          direction: 'expense',
          bookedOn: '2026-01-20',
          amountMinor: 100_00,
          currencyCode: 'PLN',
          status: 'active',
        },
      ],
      periods: [paid('2026-01-01')],
    })

    expect(forecast.spentThisYearMinor).toBe(asMinor(100_00))
    expect(forecast.restOfYearMinor).toBe(asMinor(0))
    expect(forecast.next12MonthsMinor).toBe(asMinor(0))
  })
})

describe('rollupForecasts', () => {
  it('adds series that share a currency and leaves another currency alone', () => {
    const rolled = rollupForecasts([
      {
        currencyCode: 'PLN',
        spentThisYearMinor: asMinor(100_00),
        restOfYearMinor: asMinor(200_00),
        next12MonthsMinor: asMinor(300_00),
      },
      {
        currencyCode: 'PLN',
        spentThisYearMinor: asMinor(40_00),
        restOfYearMinor: asMinor(10_00),
        next12MonthsMinor: asMinor(50_00),
      },
      {
        currencyCode: 'EUR',
        spentThisYearMinor: asMinor(7_00),
        restOfYearMinor: asMinor(8_00),
        next12MonthsMinor: asMinor(9_00),
      },
    ])

    expect(rolled).toEqual([
      {
        currencyCode: 'PLN',
        spentThisYearMinor: asMinor(140_00),
        restOfYearMinor: asMinor(210_00),
        next12MonthsMinor: asMinor(350_00),
      },
      {
        currencyCode: 'EUR',
        spentThisYearMinor: asMinor(7_00),
        restOfYearMinor: asMinor(8_00),
        next12MonthsMinor: asMinor(9_00),
      },
    ])
  })
})
