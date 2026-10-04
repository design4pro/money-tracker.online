import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { GoalEmptyState } from '../goal-empty-state'
import { renderGoal } from './harness'

/** One empty state, one size (#362): the heading is a card title, not the page's own step. */
describe('GoalEmptyState', () => {
  it('sets its heading at the subtitle step', () => {
    renderGoal(<GoalEmptyState onCreate={() => {}} />)

    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.classList.contains('text-subtitle')).toBe(true)
    expect(heading.classList.contains('text-title')).toBe(false)
  })

  it('offers one action, which creates a goal', () => {
    renderGoal(<GoalEmptyState onCreate={() => {}} />)

    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})
