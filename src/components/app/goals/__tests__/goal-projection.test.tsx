import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { asMinor } from '#/lib/money'
import { MINIMUM_CONTRIBUTION_MONTHS } from '#/server/goals/project'

import { GoalProjection } from '../goal-projection'
import { renderGoal } from './harness'

import type { GoalProjection as Projection } from '#/server/goals/project'

/**
 * The honesty rules, as assertions.
 *
 * This is the component the whole stage is about: a projection from three contributions and one
 * from thirty must not read the same. Every test below is one sentence of that promise.
 */

function dated(over: Partial<Extract<Projection, { kind: 'on_track' }>> = {}) {
  return {
    kind: 'on_track',
    projectedDate: '2026-12-31',
    monthlyRateMinor: asMinor(500_00),
    monthsRemaining: 9,
    monthsObserved: 12,
    confidence: 'high',
    ...over,
  } satisfies Projection
}

function project(projection: Projection, targetDate: string | null = null) {
  renderGoal(
    <GoalProjection
      projection={projection}
      targetDate={targetDate}
      currencyCode="PLN"
    />,
  )
}

describe('GoalProjection', () => {
  it('never states a date without a confidence word beside it', () => {
    // The confidence is the primary channel and the one that survives greyscale. A date rendered
    // on its own is the failure this component exists to prevent.
    for (const confidence of ['low', 'medium', 'high'] as const) {
      const { unmount } = renderGoal(
        <GoalProjection
          projection={dated({ confidence })}
          targetDate={null}
          currencyCode="PLN"
        />,
      )
      expect(screen.getByText(/On course to get there by/u)).toBeTruthy()
      expect(
        screen.getByText(/Rough guess|Fair estimate|Steady pattern/u),
      ).toBeTruthy()
      unmount()
    }
  })

  it('says something different at each confidence, not the same sentence in another colour', () => {
    const said = new Set<string>()
    for (const confidence of ['low', 'medium', 'high'] as const) {
      const { container, unmount } = renderGoal(
        <GoalProjection
          projection={dated({ confidence })}
          targetDate={null}
          currencyCode="PLN"
        />,
      )
      said.add(container.textContent)
      unmount()
    }
    expect(said.size).toBe(3)
  })

  it('shows the evidence: the monthly pace and how many months it came from', () => {
    project(dated({ monthlyRateMinor: asMinor(500_00), monthsObserved: 12 }))
    expect(screen.getByText(/500\.00/u)).toBeTruthy()
    expect(screen.getByText(/12 months of contributions/u)).toBeTruthy()
  })

  it('always attaches the disclaimer to a dated answer', () => {
    project(dated())
    expect(screen.getByText(/A projection, not a promise/u)).toBeTruthy()
  })

  it('names the target date when the goal has one, and does not invent one when it does not', () => {
    const { unmount } = renderGoal(
      <GoalProjection
        projection={dated()}
        targetDate="2027-06-30"
        currencyCode="PLN"
      />,
    )
    // The month and year are asserted rather than the whole date string: the exact civil order is
    // the locale's business, and pinning it here would make this a test of `Intl`.
    expect(screen.getByText(/ahead of the .*June.*2027 target/u)).toBeTruthy()
    unmount()

    project(dated())
    expect(screen.queryByText(/ahead of/u)).toBeNull()
  })

  it('says how late, in days, when the pace misses the deadline', () => {
    project(
      {
        ...dated(),
        kind: 'behind',
        daysLate: 42,
      },
      '2026-11-19',
    )
    const panel = screen.getByText(/not before .*December.*2026/u)
    expect(panel.textContent).toContain('42 days')
  })

  it('renders no date at all when the data does not support one', () => {
    project({
      kind: 'insufficient_data',
      reason: 'too_few_months',
      monthsObserved: 2,
    })
    // Not a hedged date, not a greyed-out date — no date. The union makes reading one a compile
    // error; this is the same promise at run time.
    expect(screen.queryByText(/2026|2027/u)).toBeNull()
    expect(screen.getByText(/Not enough history to project/u)).toBeTruthy()
  })

  it('tells the three no-answer cases apart', () => {
    const cases: ReadonlyArray<readonly [Projection, RegExp]> = [
      [
        {
          kind: 'insufficient_data',
          reason: 'too_few_months',
          monthsObserved: 0,
        },
        /Nothing has been contributed yet/u,
      ],
      [
        {
          kind: 'insufficient_data',
          reason: 'too_few_months',
          monthsObserved: 2,
        },
        /2 months of contributions is not yet a pace/u,
      ],
      [
        {
          kind: 'insufficient_data',
          reason: 'no_recent_contributions',
          monthsObserved: 9,
        },
        /over six months ago/u,
      ],
    ]

    for (const [projection, expected] of cases) {
      const { unmount } = renderGoal(
        <GoalProjection
          projection={projection}
          targetDate={null}
          currencyCode="PLN"
        />,
      )
      expect(screen.getByText(expected)).toBeTruthy()
      unmount()
    }
  })

  it('states the threshold the server actually uses', () => {
    // The copy names a number and the component holds its own copy of it, because importing a
    // value from `#/server` would pull server code into the browser bundle. This is the seam that
    // keeps the two honest.
    project({
      kind: 'insufficient_data',
      reason: 'too_few_months',
      monthsObserved: 1,
    })
    expect(
      screen.getByText(
        new RegExp(`at least ${MINIMUM_CONTRIBUTION_MONTHS} months`, 'u'),
      ),
    ).toBeTruthy()
  })

  it('has nothing to project once the goal is reached', () => {
    project({ kind: 'reached' })
    expect(screen.getByText(/nothing left to project/iu)).toBeTruthy()
    expect(screen.queryByText(/How much to trust this/u)).toBeNull()
  })

  it('reads in Polish without leaving an English fragment behind', () => {
    renderGoal(
      <GoalProjection
        projection={dated({ confidence: 'low' })}
        targetDate={null}
        currencyCode="PLN"
      />,
      'pl',
    )
    expect(screen.getByText(/Zgrubne oszacowanie/u)).toBeTruthy()
    expect(screen.queryByText(/Rough guess/u)).toBeNull()
  })
})
