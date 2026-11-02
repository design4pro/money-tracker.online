import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { CategoryEmptyState } from '../category-states'

import type { Catalogue } from '#/lib/i18n'

/**
 * The empty state's two actions: the standard set first, a blank category second.
 *
 * Tab order and `isPending` are the contract the route relies on: while the seed runs, the
 * primary stays focusable and the secondary cannot start a second write.
 */

function renderEmpty(
  overrides: Partial<Parameters<typeof CategoryEmptyState>[0]> = {},
) {
  const onSeed = vi.fn()
  const onCreate = vi.fn()
  render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <CategoryEmptyState onSeed={onSeed} onCreate={onCreate} {...overrides} />
    </I18nProvider>,
  )
  return { onSeed, onCreate }
}

describe('CategoryEmptyState', () => {
  it('renders both buttons, the standard set first in tab order', () => {
    renderEmpty()
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([
      en['categories.seed.action'],
      en['categories.create'],
    ])
  })

  it('keeps the primary focusable while seeding and disables the secondary', async () => {
    const user = userEvent.setup()
    const { onSeed, onCreate } = renderEmpty({ isSeeding: true })

    const primary = screen.getByRole('button', {
      name: en['categories.seed.action'],
    })
    const secondary = screen.getByRole('button', {
      name: en['categories.create'],
    })

    expect(primary.hasAttribute('disabled')).toBe(false)
    expect(primary.getAttribute('aria-disabled')).toBe('true')
    expect(secondary.hasAttribute('disabled')).toBe(true)

    await user.tab()
    expect(document.activeElement).toBe(primary)

    await user.keyboard('{Enter}')
    expect(onSeed).not.toHaveBeenCalled()

    await user.click(secondary)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('calls onSeed once when the primary is pressed', async () => {
    const user = userEvent.setup()
    const { onSeed } = renderEmpty()

    await user.click(
      screen.getByRole('button', { name: en['categories.seed.action'] }),
    )

    expect(onSeed).toHaveBeenCalledTimes(1)
  })
})
