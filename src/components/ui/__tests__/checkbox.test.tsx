import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Checkbox, CheckboxGroup } from '../checkbox'

describe('Checkbox', () => {
  it('toggles with the space bar', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox onChange={onChange}>Exclude from statistics</Checkbox>)

    await user.tab()
    const box = screen.getByRole('checkbox', {
      name: 'Exclude from statistics',
    })
    expect(document.activeElement).toBe(box)

    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('reports the indeterminate state as "mixed", which only a real input can', () => {
    render(<Checkbox isIndeterminate>Select all</Checkbox>)

    const box = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Select all',
    })

    // "mixed" is expressed on a native checkbox by the `indeterminate` IDL
    // property — it has no attribute form, so React Aria sets it imperatively
    // and deliberately writes no `aria-checked`. A stray `aria-checked` would
    // be an author override fighting the host language, so assert its absence.
    expect(box.indeterminate).toBe(true)
    expect(box.checked).toBe(false)
    expect(box.getAttribute('aria-checked')).toBeNull()

    // The accessibility outcome is the point: HTML-AAM maps an indeterminate
    // checkbox to checked="mixed", which is neither checked nor unchecked.
    // Testing Library's `checked` filter implements that mapping, so a control
    // that matched either boolean would be announcing a state it does not have.
    expect(
      screen.queryByRole('checkbox', { name: 'Select all', checked: true }),
    ).toBeNull()
    expect(
      screen.queryByRole('checkbox', { name: 'Select all', checked: false }),
    ).toBeNull()
  })

  it('announces the second line as part of the name, the only channel a RAC Checkbox has', () => {
    render(
      <Checkbox description="Hidden from every report.">
        Exclude from statistics
      </Checkbox>,
    )

    // Capture what the accessible-name computation actually produces, rather
    // than reading the label's `textContent`. The DOM read would only prove the
    // string sits somewhere under the label — it would still pass if the line
    // were inside an `aria-hidden` branch, or hidden by a `clip` style, which is
    // exactly how a "description" stops being announced without anyone noticing.
    let announcedName = ''
    const box = screen.getByRole('checkbox', {
      name: (accessibleName: string) => {
        announcedName = accessibleName
        return true
      },
    })

    // Both lines reach the user, so the row is not announced as a bare
    // "Exclude from statistics" with its qualifier silently dropped.
    expect(announcedName).toContain('Exclude from statistics')
    expect(announcedName).toContain('Hidden from every report.')

    // And it arrives by the *name*, because RAC's Checkbox — unlike its
    // CheckboxGroup — exposes no description slot, so nothing points at the
    // second line. Pinning the empty description channel keeps the two apart: if
    // this is ever wired to `aria-describedby` properly, this test must fail and
    // be updated deliberately rather than the row quietly announcing twice.
    expect(box.getAttribute('aria-describedby')).toBeNull()
  })

  it('leaves the tab order when disabled', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Checkbox isDisabled>Off limits</Checkbox>
        <button type="button">After</button>
      </>,
    )

    const box = screen.getByRole('checkbox', { name: 'Off limits' })
    expect(box.hasAttribute('disabled')).toBe(true)

    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'After' }),
    )
  })
})

describe('CheckboxGroup', () => {
  it('announces as one labelled group rather than as loose checkboxes', () => {
    render(
      <CheckboxGroup label="Include">
        <Checkbox value="income">Income</Checkbox>
        <Checkbox value="expense">Expense</Checkbox>
      </CheckboxGroup>,
    )

    expect(screen.getByRole('group', { name: 'Include' })).toBeTruthy()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('describes the group with its error and its description together', () => {
    render(
      <CheckboxGroup
        label="Include"
        description="At least one kind."
        errorMessage="Pick at least one."
        isInvalid
      >
        <Checkbox value="income">Income</Checkbox>
      </CheckboxGroup>,
    )

    const group = screen.getByRole('group', { name: 'Include' })
    const ids = (group.getAttribute('aria-describedby') ?? '').split(/\s+/)
    const text = ids
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')

    expect(text).toContain('Pick at least one.')
    expect(text).toContain('At least one kind.')
  })

  it('collects the checked values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <CheckboxGroup label="Include" onChange={onChange}>
        <Checkbox value="income">Income</Checkbox>
        <Checkbox value="expense">Expense</Checkbox>
      </CheckboxGroup>,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Expense' }))
    expect(onChange).toHaveBeenCalledWith(['expense'])
  })
})
