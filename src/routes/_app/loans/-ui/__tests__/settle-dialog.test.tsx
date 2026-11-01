import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { asMinor } from '#/lib/money'
import { SettleDialog } from '../settle-dialog'

import type * as RouterModule from '@tanstack/react-router'

const mocks = vi.hoisted(() => ({
  candidates: vi.fn(),
  settle: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('#/server/fns/loans', () => ({
  loadInstalmentCandidates: mocks.candidates,
  markLoanInstalmentPaid: mocks.settle,
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  useNavigate: () => mocks.navigate,
}))

function openDialog() {
  return render(
    <I18nProvider locale="en" messages={en}>
      <SettleDialog
        isOpen
        onOpenChange={vi.fn()}
        loanId="loan-a"
        accountId="acc-a"
        instalment={{
          sequence: 1,
          dueOn: '2026-08-20',
          amountMinor: asMinor(1500),
          currencyCode: 'JPY',
        }}
        onSaved={vi.fn()}
      />
    </I18nProvider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('settlement candidate pages', () => {
  it('keeps later matches reachable when the first page contains no eligible payment', async () => {
    mocks.candidates
      .mockResolvedValueOnce({ rows: [], nextCursor: 'next-page' })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tx-a',
            amountMinor: asMinor(1500),
            currencyCode: 'JPY',
            bookedOn: '2026-08-20',
            note: 'Lease payment',
          },
        ],
        nextCursor: null,
      })
    const user = userEvent.setup()
    openDialog()
    await user.click(await screen.findByRole('button', { name: 'Show more' }))
    expect(
      screen.queryByRole('button', { name: 'Record the payment' }),
    ).toBeNull()
    await user.click(await screen.findByRole('radio'))
    expect(screen.getByText(/Lease payment/)).not.toBeNull()
    await user.click(
      screen.getByRole('button', { name: 'Link this transaction' }),
    )
    await waitFor(() =>
      expect(mocks.settle).toHaveBeenCalledWith({
        data: { loanId: 'loan-a', sequence: 1, transactionId: 'tx-a' },
      }),
    )
    expect(mocks.candidates).toHaveBeenLastCalledWith({
      data: { loanId: 'loan-a', sequence: 1, cursor: 'next-page' },
    })
  })

  it('offers the entry form only after the last candidate page is exhausted', async () => {
    mocks.candidates
      .mockResolvedValueOnce({ rows: [], nextCursor: 'next-page' })
      .mockResolvedValueOnce({ rows: [], nextCursor: null })
    const user = userEvent.setup()
    openDialog()
    await user.click(await screen.findByRole('button', { name: 'Show more' }))
    expect(
      await screen.findByRole('button', { name: 'Record the payment' }),
    ).not.toBeNull()
  })

  it('allows retrying a failed later page without claiming that no payment exists', async () => {
    mocks.candidates
      .mockResolvedValueOnce({ rows: [], nextCursor: 'next-page' })
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ rows: [], nextCursor: null })
    const user = userEvent.setup()
    openDialog()
    await user.click(await screen.findByRole('button', { name: 'Show more' }))
    expect(await screen.findByRole('alert')).not.toBeNull()
    expect(screen.getByRole('status').textContent).toBe('')
    expect(
      screen.queryByRole('button', { name: 'Record the payment' }),
    ).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(
      await screen.findByRole('button', { name: 'Record the payment' }),
    ).not.toBeNull()
  })
})
