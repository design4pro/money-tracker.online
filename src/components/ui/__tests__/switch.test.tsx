import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Switch } from '../switch'

describe('Switch', () => {
  it('announces as a switch, not as a checkbox', () => {
    render(<Switch>Email notifications</Switch>)

    // The role is the promise: a user who hears "switch" expects the change to
    // have taken effect already. A checkbox promises a value a form will submit
    // later, and using one here is a lie about when the setting applies.
    const control = screen.getByRole<HTMLInputElement>('switch', {
      name: 'Email notifications',
    })

    // React Aria builds the switch on a real `<input type="checkbox">` with an
    // explicit `role="switch"`, so the state lives on the native `checked`
    // property. `aria-checked` would be a second, drift-prone source of truth
    // for something the DOM already says.
    expect(control.checked).toBe(false)

    // What an assistive technology announces is the *computed* checked state,
    // which HTML-AAM derives from that property. Query for it rather than for
    // an attribute, so the test still fails if the control ever reports "on"
    // while sitting in its off position.
    expect(
      screen.getByRole('switch', {
        name: 'Email notifications',
        checked: false,
      }),
    ).toBe(control)
  })

  it('toggles with the space bar and reports the new state', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Switch onChange={onChange}>Email notifications</Switch>)

    await user.tab()
    const control = screen.getByRole<HTMLInputElement>('switch', {
      name: 'Email notifications',
    })
    expect(document.activeElement).toBe(control)

    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalledWith(true)

    // The callback firing is not the same as the control reporting the change:
    // the native `checked` property carries the new state, and the computed
    // checked state is what a screen reader re-announces after the keypress.
    expect(control.checked).toBe(true)
    expect(
      screen.getByRole('switch', {
        name: 'Email notifications',
        checked: true,
      }),
    ).toBe(control)
  })

  it('is removed from the tab order when disabled, not merely dimmed', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <Switch isDisabled onChange={onChange}>
          Email notifications
        </Switch>
        <button type="button">After</button>
      </>,
    )

    const control = screen.getByRole('switch', { name: 'Email notifications' })
    expect(control.hasAttribute('disabled')).toBe(true)

    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'After' }),
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps a read-only switch focusable but unchangeable', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Switch isReadOnly onChange={onChange}>
        Managed by your workspace
      </Switch>,
    )

    const control = screen.getByRole('switch')
    await user.tab()
    expect(document.activeElement).toBe(control)

    await user.keyboard(' ')
    expect(onChange).not.toHaveBeenCalled()
    expect(control.getAttribute('aria-readonly')).toBe('true')
  })
})
