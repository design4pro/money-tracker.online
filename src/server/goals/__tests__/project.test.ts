/**
 * The projection: integer arithmetic, an honest refusal, and a confidence it does not overstate.
 *
 * No database and no fixture — `projectCompletion` is a pure function over values it is handed, so
 * every case below is a statement about arithmetic rather than about SQL. That is the whole reason
 * the projection lives outside the repository.
 *
 * Two claims here are worth more than the rest and are tested from several directions:
 *
 * - **The median resists one big month.** A mean would let a single bonus move a projected date by
 *   a year; `resists a single outlier` pins that it does not.
 * - **`insufficient_data` carries no date.** Asserted at runtime *and* by the type — the two
 *   `@ts-expect-error` lines below fail the build if the union is ever flattened into one object
 *   with optional fields, which is the change that would quietly make an absurd date readable.
 */

import { describe, expect, it } from 'vitest'

import { asMinor } from '#/lib/money'

import {
  MINIMUM_CONTRIBUTION_MONTHS,
  RATE_WINDOW_MONTHS,
  projectCompletion,
} from '../project'

import type { Minor } from '#/lib/money'
import type { ProjectableContribution, ProjectableGoal } from '../project'

const TODAY = '2026-06-15'

function goal(over: Partial<ProjectableGoal> = {}): ProjectableGoal {
  return Object.freeze({
    targetMinor: asMinor(10_000_00),
    contributedMinor: asMinor(0),
    targetDate: null,
    status: 'active',
    ...over,
  })
}

/** `['2026-01', 500_00]` pairs, booked mid-month so nothing depends on a month's length. */
function contributions(
  entries: ReadonlyArray<readonly [string, number]>,
): ReadonlyArray<ProjectableContribution> {
  return Object.freeze(
    entries.map(([month, amountMinor]) =>
      Object.freeze({
        bookedOn: `${month}-10`,
        amountMinor: asMinor(amountMinor),
      }),
    ),
  )
}

/** The six months ending with `TODAY`'s, each carrying `amountMinor`. */
function steadySixMonths(amountMinor: number) {
  return contributions([
    ['2026-01', amountMinor],
    ['2026-02', amountMinor],
    ['2026-03', amountMinor],
    ['2026-04', amountMinor],
    ['2026-05', amountMinor],
    ['2026-06', amountMinor],
  ])
}

describe('projectCompletion — the rate', () => {
  it("is the integer median of the window's integer monthly sums", () => {
    const result = projectCompletion({
      goal: goal({ targetMinor: asMinor(10_000_00) }),
      contributions: contributions([
        ['2026-01', 100_00],
        ['2026-02', 300_00],
        ['2026-03', 500_00],
        ['2026-04', 700_00],
        ['2026-05', 900_00],
        ['2026-06', 1_100_00],
      ]),
      today: TODAY,
    })

    // Six sums, so the median averages the two middle ones: (500,00 + 700,00) / 2 = 600,00.
    expect(result.kind).toBe('on_track')
    if (result.kind !== 'on_track') return
    expect(result.monthlyRateMinor).toBe(600_00)
    expect(Number.isInteger(result.monthlyRateMinor)).toBe(true)
  })

  it('is deterministic for an even count, rounding half to even like every other amount', () => {
    // Middle pair is 100,01 and 100,02 → 100,015, which half-even resolves to 100,02.
    const result = projectCompletion({
      goal: goal(),
      contributions: contributions([
        ['2026-03', 100_00],
        ['2026-04', 100_01],
        ['2026-05', 100_02],
        ['2026-06', 100_03],
      ]),
      today: TODAY,
    })

    expect(result.kind).toBe('on_track')
    if (result.kind !== 'on_track') return
    expect(result.monthlyRateMinor).toBe(100_02)
  })

  it('resists a single outlier — one huge month among five small ones', () => {
    const withOutlier = projectCompletion({
      goal: goal({ targetMinor: asMinor(12_000_00) }),
      contributions: contributions([
        ['2026-01', 200_00],
        ['2026-02', 200_00],
        ['2026-03', 200_00],
        ['2026-04', 200_00],
        ['2026-05', 200_00],
        ['2026-06', 50_000_00],
      ]),
      today: TODAY,
    })

    expect(withOutlier.kind).toBe('on_track')
    if (withOutlier.kind !== 'on_track') return
    // A mean would be 8 500,00 and would project this goal as nearly done. The median says 200,00.
    expect(withOutlier.monthlyRateMinor).toBe(200_00)
    expect(withOutlier.monthsRemaining).toBe(60)
    // And it says so quietly: a window that spread that far is not a habit.
    expect(withOutlier.confidence).toBe('low')
  })

  it('counts an empty month inside the window as zero, because not saving is information', () => {
    const result = projectCompletion({
      goal: goal(),
      contributions: contributions([
        ['2026-01', 600_00],
        ['2026-02', 600_00],
        ['2026-03', 600_00],
        // Nothing in April, May or June.
      ]),
      today: TODAY,
    })

    // The window is January through June: 600, 600, 600, 0, 0, 0 → median 300,00, not 600,00.
    expect(result.kind).toBe('on_track')
    if (result.kind !== 'on_track') return
    expect(result.monthlyRateMinor).toBe(300_00)
  })

  it('never starts the window before the goal had any contributions', () => {
    const result = projectCompletion({
      goal: goal(),
      contributions: contributions([
        ['2026-05', 400_00],
        ['2026-06', 400_00],
        // A third month, so the minimum is met.
        ['2026-04', 400_00],
      ]),
      today: TODAY,
    })

    // April through June, all funded — the two months before the goal existed are not held
    // against it, so the median is 400,00 rather than 0.
    expect(result.kind).toBe('on_track')
    if (result.kind !== 'on_track') return
    expect(result.monthlyRateMinor).toBe(400_00)
    expect(RATE_WINDOW_MONTHS).toBe(6)
  })
})

describe('projectCompletion — insufficient data', () => {
  it('refuses to date a goal with fewer than three contribution months', () => {
    const result = projectCompletion({
      goal: goal(),
      contributions: contributions([
        ['2026-05', 5_000_00],
        ['2026-06', 5_000_00],
      ]),
      today: TODAY,
    })

    expect(result).toEqual({
      kind: 'insufficient_data',
      reason: 'too_few_months',
      monthsObserved: 2,
    })
    expect(MINIMUM_CONTRIBUTION_MONTHS).toBe(3)
  })

  it('has no projectedDate to read, at run time and in the type', () => {
    const result = projectCompletion({
      goal: goal(),
      contributions: contributions([['2026-06', 50_00]]),
      today: TODAY,
    })

    expect(result.kind).toBe('insufficient_data')
    if (result.kind !== 'insufficient_data') return
    expect(Object.hasOwn(result, 'projectedDate')).toBe(false)
    // @ts-expect-error — reading a date off this branch must not compile.
    expect(result.projectedDate).toBeUndefined()
    // @ts-expect-error — nor a rate.
    expect(result.monthlyRateMinor).toBeUndefined()
  })

  it('says so differently when the history exists but the recent window is empty', () => {
    const result = projectCompletion({
      goal: goal(),
      contributions: contributions([
        ['2024-01', 900_00],
        ['2024-02', 900_00],
        ['2024-03', 900_00],
      ]),
      today: TODAY,
    })

    expect(result).toEqual({
      kind: 'insufficient_data',
      reason: 'no_recent_contributions',
      monthsObserved: 3,
    })
  })
})

describe('projectCompletion — reached', () => {
  it('returns reached and no projection once the contributions pass the target', () => {
    const result = projectCompletion({
      goal: goal({
        targetMinor: asMinor(1_000_00),
        contributedMinor: asMinor(1_000_00),
      }),
      contributions: steadySixMonths(200_00),
      today: TODAY,
    })

    expect(result).toEqual({ kind: 'reached' })
  })

  it('returns reached for a goal whose status already says so, whatever the rate suggests', () => {
    const result = projectCompletion({
      goal: goal({
        targetMinor: asMinor(10_000_00),
        contributedMinor: asMinor(10_000_00),
        status: 'reached',
      }),
      contributions: steadySixMonths(200_00),
      today: TODAY,
    })

    expect(result).toEqual({ kind: 'reached' })
  })
})

describe('projectCompletion — the verdict about a deadline', () => {
  it('is on_track when the projected month lands on or before the target date', () => {
    const result = projectCompletion({
      goal: goal({
        targetMinor: asMinor(1_200_00),
        contributedMinor: asMinor(600_00),
        targetDate: '2026-12-31',
      }),
      contributions: steadySixMonths(100_00),
      today: TODAY,
    })

    expect(result.kind).toBe('on_track')
    if (result.kind !== 'on_track') return
    // 600,00 left at 100,00 a month is six months: June plus six is December.
    expect(result.monthsRemaining).toBe(6)
    expect(result.projectedDate).toBe('2026-12-31')
  })

  it('is behind when it lands after, and says by how many days', () => {
    const result = projectCompletion({
      goal: goal({
        targetMinor: asMinor(1_200_00),
        contributedMinor: asMinor(600_00),
        targetDate: '2026-09-30',
      }),
      contributions: steadySixMonths(100_00),
      today: TODAY,
    })

    expect(result.kind).toBe('behind')
    if (result.kind !== 'behind') return
    expect(result.projectedDate).toBe('2026-12-31')
    expect(result.daysLate).toBe(92)
  })

  it('is behind for a goal whose target date has already passed', () => {
    const result = projectCompletion({
      goal: goal({
        targetMinor: asMinor(1_200_00),
        contributedMinor: asMinor(600_00),
        targetDate: '2026-01-31',
      }),
      contributions: steadySixMonths(100_00),
      today: TODAY,
    })

    expect(result.kind).toBe('behind')
    if (result.kind !== 'behind') return
    expect(result.daysLate).toBeGreaterThan(0)
  })

  it('is never behind without a target date — you cannot miss a deadline you never set', () => {
    const result = projectCompletion({
      goal: goal({ targetMinor: asMinor(100_000_00), targetDate: null }),
      contributions: steadySixMonths(100_00),
      today: TODAY,
    })

    expect(result.kind).toBe('on_track')
  })
})

describe('projectCompletion — confidence', () => {
  it('is low on the minimum three steady months', () => {
    const result = projectCompletion({
      goal: goal(),
      contributions: contributions([
        ['2026-04', 500_00],
        ['2026-05', 500_00],
        ['2026-06', 500_00],
      ]),
      today: TODAY,
    })

    expect(result.kind).toBe('on_track')
    if (result.kind !== 'on_track') return
    expect(result.confidence).toBe('low')
    expect(result.monthsObserved).toBe(3)
  })

  it('is medium on six steady months and high on twelve', () => {
    const six = projectCompletion({
      goal: goal(),
      contributions: steadySixMonths(500_00),
      today: TODAY,
    })
    expect(six.kind).toBe('on_track')
    if (six.kind !== 'on_track') return
    expect(six.confidence).toBe('medium')

    const twelve = projectCompletion({
      goal: goal(),
      contributions: contributions([
        ['2025-07', 500_00],
        ['2025-08', 500_00],
        ['2025-09', 500_00],
        ['2025-10', 500_00],
        ['2025-11', 500_00],
        ['2025-12', 500_00],
        ['2026-01', 500_00],
        ['2026-02', 500_00],
        ['2026-03', 500_00],
        ['2026-04', 500_00],
        ['2026-05', 500_00],
        ['2026-06', 500_00],
      ]),
      today: TODAY,
    })
    expect(twelve.kind).toBe('on_track')
    if (twelve.kind !== 'on_track') return
    expect(twelve.confidence).toBe('high')
    expect(twelve.monthsObserved).toBe(12)
  })

  it('never rises above low while the window is a series of one-offs', () => {
    const result = projectCompletion({
      goal: goal(),
      contributions: contributions([
        ['2025-07', 10_00],
        ['2025-08', 10_00],
        ['2025-09', 10_00],
        ['2025-10', 10_00],
        ['2025-11', 10_00],
        ['2025-12', 10_00],
        ['2026-01', 2_000_00],
        ['2026-02', 10_00],
        ['2026-03', 10_00],
        ['2026-04', 10_00],
        ['2026-05', 5_000_00],
        ['2026-06', 10_00],
      ]),
      today: TODAY,
    })

    expect(result.kind).toBe('on_track')
    if (result.kind !== 'on_track') return
    expect(result.monthsObserved).toBe(12)
    expect(result.confidence).toBe('low')
  })
})

describe('projectCompletion — purity', () => {
  it('modifies neither the goal nor its contributions', () => {
    const frozenGoal = goal({
      targetMinor: asMinor(2_000_00),
      contributedMinor: asMinor(500_00),
    })
    const frozenContributions = steadySixMonths(100_00)

    projectCompletion({
      goal: frozenGoal,
      contributions: frozenContributions,
      today: TODAY,
    })

    // The objects are frozen, so a write would have thrown in strict mode; this asserts the
    // values as well, because a silent no-op write is the failure a freeze alone would hide.
    expect(frozenGoal.contributedMinor).toBe(500_00)
    expect(frozenGoal.targetMinor).toBe(2_000_00)
    expect(frozenContributions).toHaveLength(6)
    expect(frozenContributions[0]?.amountMinor).toBe(100_00)
  })

  it("projects in the goal's own currency — the rate is in the units it was given", () => {
    // The contributions are euro minor units; nothing here converts, so the rate is euro too.
    const euroRate: Minor = asMinor(250_00)
    const result = projectCompletion({
      goal: goal({
        targetMinor: asMinor(4_000_00),
        contributedMinor: asMinor(1_000_00),
      }),
      contributions: steadySixMonths(euroRate),
      today: TODAY,
    })

    expect(result.kind).toBe('on_track')
    if (result.kind !== 'on_track') return
    expect(result.monthlyRateMinor).toBe(euroRate)
    // 3 000,00 remaining at 250,00 a month is twelve months, in euro, at no rate at all.
    expect(result.monthsRemaining).toBe(12)
  })
})
