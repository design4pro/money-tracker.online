import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Button } from '../button'

describe('Button', () => {
  it('activates with Enter and with Space from the keyboard', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(<Button onPress={onPress}>Save</Button>)

    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Save' }),
    )

    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onPress).toHaveBeenCalledTimes(2)
  })

  it('takes its accessible name from `label` when it is icon-only', () => {
    render(
      <Button
        shape="icon"
        label="Delete transaction"
        icon={<svg aria-hidden="true" />}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Delete transaction' }),
    ).toBeTruthy()
  })

  it('communicates disabled to assistive technology, not only visually', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(
      <Button isDisabled onPress={onPress}>
        Save
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Save' })
    // A real `disabled` attribute, so the control is removed from the tab order
    // and announced as unavailable rather than merely painted grey.
    expect(button.hasAttribute('disabled')).toBe(true)

    await user.click(button)
    expect(onPress).not.toHaveBeenCalled()
  })

  it('stays focusable while pending, and reports the state with aria-disabled', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(
      <Button isPending onPress={onPress}>
        Save
      </Button>,
    )

    const button = screen.getByRole('button', { name: /Save/ })

    // The distinction the component exists to preserve: a `disabled` button
    // loses focus the instant it is disabled, dumping a keyboard user at the
    // top of the document with no announcement. `aria-disabled` does not.
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('true')

    await user.tab()
    expect(document.activeElement).toBe(button)

    await user.keyboard('{Enter}')
    expect(onPress).not.toHaveBeenCalled()
  })

  it('keeps the label in the DOM while pending so the row does not reflow', () => {
    render(<Button isPending>Save</Button>)
    expect(screen.getByText('Save')).toBeTruthy()
  })
})
