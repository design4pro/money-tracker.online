import { describe, expect, it } from 'vitest'

import { asMinor } from '#/lib/money'
import { MAX_MONTHS, monthlyContributionSeries } from '../history'

/**
 * The chart's own series, and the one thing it shares with the projection.
 *
 * Both bucket by calendar month through `#/server/goals/calendar`, which is why a bar and the
 * median printed beside it cannot disagree. These tests pin what the *chart* additionally needs:
 * a continuous run of months with real zeroes in the quiet ones.
 */

const TODAY = '2026-03-15'

function contribution(bookedOn: string, amountMinor: number) {
  return { bookedOn, amountMinor: asMinor(amountMinor) }
}

describe('monthlyContributionSeries', () => {
  it('is empty for a goal with no contributions, rather than a run of zeroes', () => {
    // A chart of twelve empty months is a picture of nothing. `ChartFrame`'s designed empty state
    // says more than a flat axis does, and it only appears when there is genuinely no series.
    expect(
      monthlyContributionSeries({ contributions: [], today: TODAY }),
    ).toEqual([])
  })

  it('sums a month, in integers', () => {
    const series = monthlyContributionSeries({
      contributions: [
        contribution('2026-03-02', 200_00),
        contribution('2026-03-28', 55_55),
      ],
      today: TODAY,
    })
    expect(series).toEqual([{ monthStart: '2026-03-01', addedMinor: 255_55 }])
  })

  it('fills the quiet months with a real zero, so a dormant goal looks dormant', () => {
    const series = monthlyContributionSeries({
      contributions: [
        contribution('2025-12-10', 100_00),
        contribution('2026-03-10', 100_00),
      ],
      today: TODAY,
    })
    expect(series.map((month) => month.monthStart)).toEqual([
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ])
    expect(series.map((month) => month.addedMinor)).toEqual([
      100_00, 0, 0, 100_00,
    ])
  })

  it('runs to today even when the last contribution was months ago', () => {
    const series = monthlyContributionSeries({
      contributions: [contribution('2026-01-10', 100_00)],
      today: TODAY,
    })
    expect(series.at(-1)?.monthStart).toBe('2026-03-01')
    expect(series.at(-1)?.addedMinor).toBe(0)
  })

  it('never starts before the goal had a contribution', () => {
    // Five empty columns in front of a goal opened last month would be a picture of a failure that
    // never happened.
    const series = monthlyContributionSeries({
      contributions: [contribution('2026-03-01', 100_00)],
      today: TODAY,
    })
    expect(series).toHaveLength(1)
  })

  it('does not run backwards when a contribution is booked in the future', () => {
    // A planned transfer already recorded is a real row with a future `booked_on`. The range
    // extends to cover it rather than producing an empty or reversed series.
    const series = monthlyContributionSeries({
      contributions: [
        contribution('2026-03-01', 100_00),
        contribution('2026-05-01', 100_00),
      ],
      today: TODAY,
    })
    expect(series.map((month) => month.monthStart)).toEqual([
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
    ])
  })

  it('shows at most two years of columns, keeping the most recent ones', () => {
    const series = monthlyContributionSeries({
      contributions: [
        contribution('2020-01-15', 100_00),
        contribution('2026-03-15', 100_00),
      ],
      today: TODAY,
    })
    expect(series).toHaveLength(MAX_MONTHS)
    expect(series.at(-1)?.monthStart).toBe('2026-03-01')
    expect(series.at(0)?.monthStart).toBe('2024-04-01')
  })
})
