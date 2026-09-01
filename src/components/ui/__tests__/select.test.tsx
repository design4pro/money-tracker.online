import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Select, SelectItem } from '../select'

function renderSelect(props: Record<string, unknown> = {}) {
  return render(
    <Select label="Account" placeholder="Pick one" {...props}>
      <SelectItem id="cash">Cash</SelectItem>
      <SelectItem id="card">Card</SelectItem>
      <SelectItem id="savings">Savings</SelectItem>
    </Select>,
  )
}

describe('Select', () => {
  it('exposes a labelled combobox trigger that reports its expanded state', async () => {
    const user = userEvent.setup()
    renderSelect()

    const trigger = screen.getByRole('button', { name: /Account/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await user.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('listbox')).toBeTruthy()
  })

  it('opens from the keyboard and selects with Enter', async () => {
    const user = userEvent.setup()
    const onSelectionChange = vi.fn()
    renderSelect({ onSelectionChange })

    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Account/ }),
    )

    await user.keyboard('{Enter}')
    expect(screen.getByRole('listbox')).toBeTruthy()
    // Opening from the keyboard puts focus on an option, so the user can act
    // without first hunting for the list.
    expect(document.activeElement).toBe(
      screen.getByRole('option', { name: 'Cash' }),
    )

    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelectionChange).toHaveBeenCalledWith('card')
  })

  it('closes on Escape without changing the selection', async () => {
    const user = userEvent.setup()
    const onSelectionChange = vi.fn()
    renderSelect({ onSelectionChange })

    const trigger = screen.getByRole('button', { name: /Account/ })
    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(onSelectionChange).not.toHaveBeenCalled()
    // Focus must come back to the trigger, or the keyboard user is stranded at
    // the top of the document with no announcement of what happened. jsdom
    // cannot witness that - FocusScope's restore leaves `document.body` focused
    // there - so it is asserted in a real browser by
    // `e2e/focus-restoration.spec.ts`.
  })

  it('skips a disabled option while arrowing, rather than only greying it', async () => {
    const user = userEvent.setup()
    const onSelectionChange = vi.fn()
    renderSelect({ onSelectionChange, disabledKeys: ['card'] })

    // Open from the keyboard, which is the path that has a starting position:
    // RAC focuses the first option, so the arrow press below is measured from
    // 'Cash'. A pointer open leaves focus on the list itself, and the first
    // arrow would only be moving onto 'Cash'.
    await user.tab()
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(
      screen.getByRole('option', { name: 'Cash' }),
    )

    const card = screen.getByRole('option', { name: 'Card' })
    expect(card.getAttribute('aria-disabled')).toBe('true')

    // 'card' is disabled, so the arrow press steps over it onto 'savings'
    // instead of parking on a row that will not respond to Enter.
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(
      screen.getByRole('option', { name: 'Savings' }),
    )

    await user.keyboard('{Enter}')
    expect(onSelectionChange).toHaveBeenCalledWith('savings')
  })

  it('marks the selected option, not just the trigger text', async () => {
    const user = userEvent.setup()
    renderSelect({ defaultSelectedKey: 'savings' })

    await user.click(screen.getByRole('button', { name: /Account/ }))
    const selected = screen.getByRole('option', { name: 'Savings' })
    expect(selected.getAttribute('aria-selected')).toBe('true')
  })
})
