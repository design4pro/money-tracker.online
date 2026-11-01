import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { ToastHost, toast } from '../toast'

describe('ToastHost', () => {
  it('names the close button from the caller-supplied label and hides its glyph', async () => {
    render(<ToastHost regionLabel="Notifications" closeLabel="Close" />)

    await act(async () => {
      toast.success('Account saved.')
    })

    const close = await screen.findByRole('button', {
      name: 'Close',
      hidden: true,
    })
    expect(close.getAttribute('aria-label')).toBe('Close')
    // The X glyph is decoration; a named icon inside a named button is what
    // axe reports as `role-img-alt` (#730).
    expect(close.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(close.querySelector('[role="img"]')).toBeNull()
  })

  it('holds the close button at a 44px box and keeps the toast text clear of it', async () => {
    // Sonner's store is module-level, so the first test's toast is still
    // there: this one is told apart by its own text.
    render(<ToastHost closeLabel="Close" />)

    await act(async () => {
      toast.success('Budget saved.')
    })

    const title = await screen.findByText('Budget saved.')
    const close = within(title.closest('li') as HTMLElement).getByRole(
      'button',
      { name: 'Close', hidden: true },
    )
    // Sonner's stylesheet is unlayered and beats plain utilities, so the size
    // has to be important to apply at all. jsdom lays nothing out; the measured
    // box is asserted in `e2e/toast-close-button.spec.ts`.
    expect(close.classList.contains('size-11!')).toBe(true)
    expect(title.parentElement?.classList.contains('pe-7')).toBe(true)
  })
})
