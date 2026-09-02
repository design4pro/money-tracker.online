import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { asMinor } from '#/lib/money'

import { GoalMeter, goalStateOf } from '../goal-meter'
import { renderGoal } from './harness'

import type { GoalMeterProps } from '../goal-meter'

/**
 * The one component on this surface a reader acts on, and the four channels it has to keep.
 *
 * The assertions are the design bar written down: *how much is left* is the headline, and every
 * state is legible to somebody who cannot see the colour it is drawn in.
 */

function meter(over: Partial<GoalMeterProps> = {}) {
  renderGoal(
    <GoalMeter
      name="Emergency fund"
      targetMinor={asMinor(10_000_00)}
      contributedMinor={asMinor(2_500_00)}
      remainingMinor={asMinor(7_500_00)}
      ratio={0.25}
      state="saving"
      currencyCode="PLN"
      {...over}
    />,
  )
  return screen.getByRole('meter')
}

describe('GoalMeter', () => {
  it('leads with what is left, not with what is in', () => {
    meter()
    expect(screen.getByText(/7,500\.00.*to go/u)).toBeTruthy()
    // The saved figure is present, as a caption rather than the headline.
    expect(screen.getByText(/2,500\.00.*of.*10,000\.00/u)).toBeTruthy()
  })

  it('names what it measures, because six unnamed meters announce identically', () => {
    meter()
    expect(
      screen.getByRole('meter', { name: 'Saved towards Emergency fund' }),
    ).toBeTruthy()
  })

  it('states both amounts and the percentage in its accessible value', () => {
    const track = meter()
    const valueText = track.getAttribute('aria-valuetext') ?? ''
    expect(valueText).toContain('2,500.00')
    expect(valueText).toContain('10,000.00')
    expect(valueText).toContain('25%')
    expect(track.getAttribute('aria-valuenow')).toBe('25')
    expect(track.getAttribute('aria-valuemin')).toBe('0')
    expect(track.getAttribute('aria-valuemax')).toBe('100')
  })

  it('says the state in words as well as in hue', () => {
    const words: Record<string, RegExp> = {
      saving: /Saving/u,
      reached: /Reached/u,
      overdue: /Past its date/u,
      archived: /Archived/u,
    }
    for (const [state, expected] of Object.entries(words)) {
      const { unmount } = renderGoal(
        <GoalMeter
          name="Emergency fund"
          targetMinor={asMinor(10_000_00)}
          contributedMinor={asMinor(2_500_00)}
          remainingMinor={asMinor(7_500_00)}
          ratio={0.25}
          state={state as GoalMeterProps['state']}
          currencyCode="PLN"
        />,
      )
      expect(screen.getAllByText(expected).length, state).toBeGreaterThan(0)
      unmount()
    }
  })

  it('changes the headline sentence when the goal is fully funded', () => {
    meter({
      contributedMinor: asMinor(10_000_00),
      remainingMinor: asMinor(0),
      ratio: 1,
      state: 'reached',
    })
    // Not "0.00 zł to go", which is arithmetically true and reads like a rounding error.
    expect(screen.getByText(/Fully funded/u)).toBeTruthy()
  })

  it('caps the fill at the track and does not cap the sentence', () => {
    const track = meter({
      contributedMinor: asMinor(12_000_00),
      remainingMinor: asMinor(0),
      ratio: 1.2,
      state: 'reached',
    })
    expect(track.getAttribute('aria-valuenow')).toBe('100')
    // The real figure survives, unclamped, where the reader can see it.
    expect(screen.getByText(/120%/u)).toBeTruthy()
  })

  it('says the target in words, because a tick on a bar announces nothing', () => {
    meter()
    expect(screen.getByText(/The target, .*10,000\.00/u)).toBeTruthy()
  })

  it('renders a sentence rather than 0% when there is no proportion to draw', () => {
    // `ratio` is `null` only for a target of zero, which the create schema rules out. A row from an
    // import can still carry one, and "0%" would read as *no progress* when the truth is *unknown*.
    meter({ ratio: null })
    expect(screen.getAllByText(/Progress unavailable/u).length).toBeGreaterThan(
      0,
    )
    expect(screen.queryByText(/^0%$/u)).toBeNull()
  })
})

describe('goalStateOf', () => {
  it('lets archived win, so a shelved goal is never scolded for a date', () => {
    expect(goalStateOf({ status: 'archived', isOverdue: true })).toBe(
      'archived',
    )
  })

  it('lets reached win over overdue, because a goal that got there late got there', () => {
    expect(goalStateOf({ status: 'reached', isOverdue: true })).toBe('reached')
  })

  it('reports overdue only for a live goal past its date', () => {
    expect(goalStateOf({ status: 'active', isOverdue: true })).toBe('overdue')
    expect(goalStateOf({ status: 'active', isOverdue: false })).toBe('saving')
  })
})
