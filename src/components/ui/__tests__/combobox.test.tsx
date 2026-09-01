import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ComboBox, ComboBoxItem } from '../combobox'

function Example(props: Record<string, unknown> = {}) {
  return (
    <ComboBox label="Payee" emptyState="No matching payees." {...props}>
      <ComboBoxItem id="biedronka">Biedronka</ComboBoxItem>
      <ComboBoxItem id="lidl">Lidl</ComboBoxItem>
      <ComboBoxItem id="orlen">Orlen</ComboBoxItem>
    </ComboBox>
  )
}

/**
 * Everything React Aria's announcer has said so far, across both of its live
 * regions. The announcer appends rather than replaces, so a test compares a
 * before and an after rather than reading it as a snapshot of "now".
 */
function liveRegionText() {
  return Array.from(document.querySelectorAll('[aria-live]'))
    .map((node) => node.textContent)
    .join(' ')
}

describe('ComboBox', () => {
  it('is a labelled combobox that starts collapsed', () => {
    render(<Example />)

    const input = screen.getByRole('combobox', { name: 'Payee' })
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('filters as the user types and keeps focus in the input', async () => {
    const user = userEvent.setup()
    render(<Example />)

    const input = screen.getByRole('combobox', { name: 'Payee' })
    await user.click(input)
    await user.keyboard('li')

    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Lidl',
    ])

    // The caret must stay where the user is typing; the list is driven by
    // `aria-activedescendant`, not by moving DOM focus into it.
    expect(document.activeElement).toBe(input)
  })

  it('moves the virtual focus with the arrow keys', async () => {
    const user = userEvent.setup()
    render(<Example />)

    const input = screen.getByRole('combobox', { name: 'Payee' })
    await user.click(input)
    await user.keyboard('{ArrowDown}{ArrowDown}')

    const active = input.getAttribute('aria-activedescendant')
    expect(active).toBeTruthy()
    expect(document.getElementById(active as string)?.textContent).toBe('Lidl')
    expect(document.activeElement).toBe(input)
  })

  it('commits a selection with Enter', async () => {
    const user = userEvent.setup()
    const onSelectionChange = vi.fn()
    render(<Example onSelectionChange={onSelectionChange} />)

    const input = screen.getByRole('combobox', { name: 'Payee' })
    await user.click(input)
    await user.keyboard('or{ArrowDown}{Enter}')

    expect(onSelectionChange).toHaveBeenCalledWith('orlen')
    expect((input as HTMLInputElement).value).toBe('Orlen')
  })

  it('renders the empty state inside the listbox, so it is announced', async () => {
    const user = userEvent.setup()
    render(<Example />)

    const input = screen.getByRole('combobox', { name: 'Payee' })
    await user.click(input)
    const announcedBeforeTyping = liveRegionText()
    await user.keyboard('zzz')

    const listbox = screen.getByRole('listbox')
    expect(listbox.textContent).toContain('No matching payees.')

    /*
      RAC wraps `renderEmptyState` in a `display: contents` element carrying
      `role="option"`, because a `role="listbox"` may only contain options - a
      bare div in there would make the listbox invalid and is dropped from the
      accessibility tree by some screen readers, taking the message with it. So
      the outcome to assert is not "no option element exists" but "nothing in
      there is selectable": the wrapper carries no selection state, and no arrow
      key can put the virtual focus on it.
    */
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]?.textContent).toContain('No matching payees.')
    expect(options.filter((o) => o.hasAttribute('aria-selected'))).toHaveLength(
      0,
    )

    await user.keyboard('{ArrowDown}')
    expect(input.getAttribute('aria-activedescendant')).toBeNull()

    // And the count React Aria puts in its live region is zero, which is what a
    // screen-reader user hears instead of silence.
    expect(announcedBeforeTyping).not.toContain('0 options available.')
    expect(liveRegionText()).toContain('0 options available.')
  })

  it('rejects a value that is not in the list unless custom values are allowed', async () => {
    const user = userEvent.setup()
    const onInputChange = vi.fn()
    render(<Example onInputChange={onInputChange} />)

    const input = screen.getByRole('combobox', { name: 'Payee' })
    await user.click(input)
    await user.keyboard('zzz')
    await user.tab()

    // On blur with no selection the field reverts, rather than silently
    // keeping text that maps to nothing.
    expect((input as HTMLInputElement).value).toBe('')
  })
})
