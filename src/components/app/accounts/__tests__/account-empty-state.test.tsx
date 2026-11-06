import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { AccountEmptyState } from '../account-empty-state'

import type { Catalogue } from '#/lib/i18n'
import type { AccountCategory } from '#/server/db/schema'

const renderState = (
  onCreate: (category?: AccountCategory) => void = () => {},
) =>
  render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <AccountEmptyState onCreate={onCreate} />
    </I18nProvider>,
  )

/** One empty state, one size (#362): the heading is a card title, not the page's own step. */
describe('AccountEmptyState', () => {
  it('sets its heading at the subtitle step', () => {
    renderState()

    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.classList.contains('text-subtitle')).toBe(true)
    expect(heading.classList.contains('text-title')).toBe(false)
  })

  it('keeps its kind shortcuts in a labelled section outside the empty state', () => {
    renderState()

    const section = screen.getByRole('region', {
      name: en['accounts.empty.pick.title'],
    })
    expect(section.querySelectorAll('button')).toHaveLength(3)
    expect(screen.getByRole('heading', { level: 3 }).closest('section')).toBe(
      section,
    )
  })

  it('hands the chosen category to onCreate, and none from the primary action', async () => {
    const onCreate = vi.fn()
    const user = userEvent.setup()
    renderState(onCreate)

    await user.click(
      screen.getByRole('button', {
        name: en['accounts.category.current'],
      }),
    )
    expect(onCreate).toHaveBeenLastCalledWith('current')

    await user.click(
      screen.getByRole('button', { name: en['accounts.category.cash'] }),
    )
    expect(onCreate).toHaveBeenLastCalledWith('cash')

    await user.click(
      screen.getByRole('button', {
        name: en['accounts.category.creditCard'],
      }),
    )
    expect(onCreate).toHaveBeenLastCalledWith('credit_card')

    await user.click(
      screen.getByRole('button', { name: en['accounts.empty.action'] }),
    )
    expect(onCreate).toHaveBeenLastCalledWith()
  })
})
