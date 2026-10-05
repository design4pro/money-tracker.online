import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MarkPaidEmpty } from '../mark-paid-empty'
import { renderRecurring } from './harness'

/**
 * The empty picker of the mark-paid dialog: a way forward instead of a paragraph and a dead end.
 *
 * The action only reports a press. Navigating is the route's, and creating a transaction is
 * nobody's here - the dialog's refusal to mint money stays exactly where it is.
 */

describe('MarkPaidEmpty', () => {
  it('says nothing matched, and offers to record the payment', () => {
    renderRecurring(<MarkPaidEmpty onRecord={vi.fn()} />)

    expect(screen.getByText(/Nothing in this window matches/)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Record the payment' }),
    ).toBeTruthy()
    expect(
      screen.getByText('We will bring you back here to link it.'),
    ).toBeTruthy()
  })

  it('ties the hint to the button, so the button is announced with it', () => {
    renderRecurring(<MarkPaidEmpty onRecord={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Record the payment' })
    const hint = screen.getByText('We will bring you back here to link it.')
    expect(button.getAttribute('aria-describedby')).toBe(hint.id)
  })

  it('reports a press and does nothing else', async () => {
    const user = userEvent.setup()
    const onRecord = vi.fn()
    renderRecurring(<MarkPaidEmpty onRecord={onRecord} />)

    await user.click(screen.getByRole('button', { name: 'Record the payment' }))
    expect(onRecord).toHaveBeenCalledTimes(1)
  })

  it('reads in Polish', () => {
    renderRecurring(<MarkPaidEmpty onRecord={vi.fn()} />, 'pl')
    expect(screen.getByRole('button', { name: 'Zapisz płatność' })).toBeTruthy()
  })
})
