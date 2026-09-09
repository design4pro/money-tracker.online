import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { BudgetListSkeleton } from '../budget-skeletons'
import { budgetListClass } from '../list-layout'
import { renderBudget } from './harness'

/**
 * The `/budgets` loading picture stands in for a paired list.
 *
 * A single-column skeleton followed by a two-column list is the same jump `budget-skeletons.tsx`
 * exists to prevent, taken sideways: the reader gets a full-width column of cards and then watches
 * half of them move to the right. The geometry is therefore not copied into the skeleton but
 * imported, and the assertion below is exactly that — the loading `<ul>` carries the class the
 * loaded `<ul>` will carry for the same number of cards.
 */

describe('BudgetListSkeleton', () => {
  it('lays its stand-in cards out with the loaded list’s own geometry', () => {
    const { container } = renderBudget(<BudgetListSkeleton />)

    const list = container.querySelector('ul')
    expect(list).not.toBeNull()
    // Three cards, so the pairing is visible in the picture as well as in the class.
    expect(list?.children.length).toBe(3)
    expect(list?.getAttribute('class')).toBe(budgetListClass(3))
  })

  it('still announces the load exactly once', () => {
    // The list is now a grid rather than a stack; a rearrangement is the sort of change that
    // quietly gives a screen reader the announcement twice, or drops it.
    renderBudget(<BudgetListSkeleton />)

    const announcements = screen.getAllByRole('status')
    expect(announcements.length).toBe(1)
    expect(announcements[0]?.textContent).toBeTruthy()
  })
})
