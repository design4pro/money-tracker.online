import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'

import { BudgetEmptyState } from '../budget-empty-state'
import { renderBudget } from './harness'

/** One empty state, one size (#362): the heading is a card title, not the page's own step. */
describe('BudgetEmptyState', () => {
  it('sets its heading at the subtitle step', () => {
    renderBudget(<BudgetEmptyState onCreate={() => {}} />)

    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.classList.contains('text-subtitle')).toBe(true)
    expect(heading.classList.contains('text-title')).toBe(false)
  })

  it('keeps the kind tiles in a labelled section below the empty state, one heading level down', () => {
    renderBudget(<BudgetEmptyState onCreate={() => {}} />)

    const section = screen.getByRole('region', {
      name: en['budgets.empty.pick.title'],
    })
    expect(section.querySelectorAll('button')).toHaveLength(2)
    expect(screen.getByRole('heading', { level: 3 }).closest('section')).toBe(
      section,
    )

    // The primary action is the empty state's, so it comes before the section in the DOM.
    const primary = screen.getByRole('button', {
      name: en['budgets.empty.action'],
    })
    expect(
      primary.compareDocumentPosition(section) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('hands the chosen kind to onCreate, and none from the primary action', async () => {
    const onCreate = vi.fn()
    const user = userEvent.setup()
    renderBudget(<BudgetEmptyState onCreate={onCreate} />)

    await user.click(
      screen.getByRole('button', {
        name: new RegExp(en['budgets.kind.category']),
      }),
    )
    expect(onCreate).toHaveBeenLastCalledWith('category')

    await user.click(
      screen.getByRole('button', {
        name: new RegExp(en['budgets.kind.manual']),
      }),
    )
    expect(onCreate).toHaveBeenLastCalledWith('manual')

    await user.click(
      screen.getByRole('button', { name: en['budgets.empty.action'] }),
    )
    expect(onCreate).toHaveBeenLastCalledWith()
  })

  it('labels the section in Polish as well', () => {
    renderBudget(<BudgetEmptyState onCreate={() => {}} />, 'pl')

    expect(
      screen.getAllByRole('region', { name: pl['budgets.empty.pick.title'] }),
    ).toHaveLength(1)
  })
})
