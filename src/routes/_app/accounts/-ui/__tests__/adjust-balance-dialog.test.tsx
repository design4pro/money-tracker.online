import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import { asMinor } from '#/lib/money'
import en from '#/lib/i18n/messages/en'

import { AdjustBalanceDialog } from '../adjust-balance-dialog'

import type { Catalogue } from '#/lib/i18n'
import type { Account } from '#/server/db/types'

/**
 * The correction dialog previews the delta it is about to write, for any booking date.
 *
 * The server functions are replaced at the call seam, the one true remote boundary here: the
 * repository read they front is tested against the real database next to the write it must agree
 * with. What this file defends is the dialog's own contract - one read per date, a response for an
 * earlier date never overwriting the date now selected, and a write that cannot be submitted
 * before the balance it will be measured against has been read.
 */

const server = vi.hoisted(() => ({
  getAccountBalanceOn: vi.fn(),
  adjustAccountBalance: vi.fn(),
}))

vi.mock('#/server/fns/accounts', () => server)

/** A promise a test settles by hand, so the order of the answers is the test's, not the clock's. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const ACCOUNT: Account = {
  id: 'acc-1',
  organizationId: 'org-1',
  name: 'Everyday',
  category: 'current',
  currencyCode: 'PLN',
  initialBalanceMinor: asMinor(0),
  refInitialBalanceMinor: asMinor(0),
  // The cache is deliberately wrong: the preview must come from the read, never from this.
  currentBalanceMinor: asMinor(999_99),
  refCurrentBalanceMinor: asMinor(999_99),
  creditLimitMinor: null,
  refCreditLimitMinor: null,
  status: 'active',
  excludeFromStats: false,
  position: 0,
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  note: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

function renderDialog(account: Account = ACCOUNT) {
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <AdjustBalanceDialog
        isOpen
        onOpenChange={() => {}}
        account={account}
        onRecorded={() => {}}
      />
    </I18nProvider>,
  )
}

const user = userEvent.setup()

/** The label of the status region's sentence for a date, as the catalogue words it. */
function sentence(
  key:
    | 'accounts.adjust.preview.loading'
    | 'accounts.adjust.preview.error'
    | 'accounts.adjust.preview.blocked'
    | 'accounts.adjust.preview.blockedFailed',
  date: string,
) {
  return en[key].replace('{date}', date).replace('{retry}', en['action.retry'])
}

async function typeTarget(value: string) {
  const field = screen.getByRole('textbox', {
    name: /what the balance should be/i,
  })
  await user.clear(field)
  await user.type(field, value)
  return field
}

/** Moves the date one day back with the keyboard, the way a person does without a mouse. */
async function dayBack() {
  const day = screen.getByRole('spinbutton', { name: /^day/i })
  day.focus()
  await user.keyboard('{ArrowDown}')
}

/** Moves the date one day forward, past today when the dialog opens on today. */
async function dayForward() {
  const day = screen.getByRole('spinbutton', { name: /^day/i })
  day.focus()
  await user.keyboard('{ArrowUp}')
}

/** The sentence the disabled Record button points at. */
function blockedReason() {
  const record = screen.getByRole('button', { name: 'Record the correction' })
  const reasonId = record.getAttribute('aria-describedby')
  expect(reasonId).toBeTruthy()
  return document.getElementById(reasonId!)
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date'],
    now: new Date('2026-03-15T10:00:00.000Z'),
  })
  server.getAccountBalanceOn.mockReset()
  server.adjustAccountBalance.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the exact preview', () => {
  it('reads the balance for today too and subtracts it from the target, ignoring the cache', async () => {
    server.getAccountBalanceOn.mockResolvedValue({ balanceMinor: 100_00 })
    renderDialog()

    expect(server.getAccountBalanceOn).toHaveBeenCalledWith({
      data: { accountId: 'acc-1', on: '2026-03-15' },
    })
    await typeTarget('150')

    // 150,00 - 100,00 (the read), not 150,00 - 999,99 (the cache).
    expect(await screen.findByText(/Money in of .*50[.,]00/)).toBeTruthy()
  })

  it('previews "Nothing" for a zero delta', async () => {
    server.getAccountBalanceOn.mockResolvedValue({ balanceMinor: 100_00 })
    renderDialog()

    await typeTarget('100')

    expect(await screen.findByText(/^Nothing\./)).toBeTruthy()
  })

  it('shows the account’s own currency, never a base-currency figure', async () => {
    server.getAccountBalanceOn.mockResolvedValue({ balanceMinor: 100_00 })
    renderDialog({ ...ACCOUNT, currencyCode: 'EUR' })

    await typeTarget('150')

    const text = await screen.findByText(/Money in of/)
    expect(text.textContent).toMatch(/€|EUR/)
    expect(text.textContent).not.toMatch(/PLN|zł/)
  })
})

describe('reading the balance for another date', () => {
  it('replaces the previous delta with the loading sentence at once', async () => {
    server.getAccountBalanceOn.mockResolvedValueOnce({ balanceMinor: 100_00 })
    renderDialog()
    await typeTarget('150')
    await screen.findByText(/Money in of/)

    const second = deferred<{ balanceMinor: number }>()
    server.getAccountBalanceOn.mockReturnValueOnce(second.promise)
    await dayBack()

    const status = screen.getByRole('status')
    expect(status.textContent).toContain(
      sentence('accounts.adjust.preview.loading', 'March 14, 2026'),
    )
    expect(screen.queryByText(/Money in of/)).toBeNull()
  })

  it('ignores an answer for an earlier date that arrives last', async () => {
    const today = deferred<{ balanceMinor: number }>()
    const yesterday = deferred<{ balanceMinor: number }>()
    server.getAccountBalanceOn
      .mockReturnValueOnce(today.promise)
      .mockReturnValueOnce(yesterday.promise)
    renderDialog()
    await typeTarget('150')
    await dayBack()

    yesterday.resolve({ balanceMinor: 100_00 })
    expect(await screen.findByText(/Money in of .*50[.,]00/)).toBeTruthy()

    // Today's answer finally lands. If it overwrote the preview, 150 - 20 would read 130,00.
    today.resolve({ balanceMinor: 20_00 })
    await waitFor(() => {
      expect(screen.queryByText(/130[.,]00/)).toBeNull()
    })
    expect(screen.getByText(/Money in of .*50[.,]00/)).toBeTruthy()
  })

  it('does not show the first answer for a date again while its new read is in flight (A, B, A)', async () => {
    server.getAccountBalanceOn.mockResolvedValueOnce({ balanceMinor: 100_00 })
    renderDialog()
    await typeTarget('150')
    await screen.findByText(/Money in of .*50[.,]00/)

    const second = deferred<{ balanceMinor: number }>()
    const third = deferred<{ balanceMinor: number }>()
    server.getAccountBalanceOn
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise)
    await dayBack()
    const day = screen.getByRole('spinbutton', { name: /^day/i })
    day.focus()
    await user.keyboard('{ArrowUp}')

    // Back on March 15 with its second read pending: the old figure must not stand in for it.
    const status = screen.getByRole('status')
    expect(status.textContent).toContain(
      sentence('accounts.adjust.preview.loading', 'March 15, 2026'),
    )
    expect(screen.queryByText(/Money in of/)).toBeNull()
  })
})

describe('recording is blocked until the balance has loaded', () => {
  it('disables the button with a visible reason that the button points at', async () => {
    const pending = deferred<{ balanceMinor: number }>()
    server.getAccountBalanceOn.mockReturnValue(pending.promise)
    renderDialog()

    const record = screen.getByRole('button', { name: 'Record the correction' })
    expect(
      record.getAttribute('aria-disabled') ?? record.getAttribute('disabled'),
    ).not.toBeNull()

    const reasonId = record.getAttribute('aria-describedby')
    expect(reasonId).toBeTruthy()
    const reason = document.getElementById(reasonId!)
    expect(reason?.textContent).toContain(
      sentence('accounts.adjust.preview.blocked', 'March 15, 2026'),
    )

    pending.resolve({ balanceMinor: 100_00 })
    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: 'Record the correction' })
          .hasAttribute('disabled'),
      ).toBe(false)
    })
  })

  it('does not submit on Enter in the amount field while the balance is loading', async () => {
    server.getAccountBalanceOn.mockReturnValue(new Promise(() => {}))
    renderDialog()

    const field = await typeTarget('150')
    await user.type(field, '{Enter}')

    expect(server.adjustAccountBalance).not.toHaveBeenCalled()
  })

  it('submits once the balance for the selected date has loaded', async () => {
    server.getAccountBalanceOn.mockResolvedValue({ balanceMinor: 100_00 })
    server.adjustAccountBalance.mockResolvedValue({
      status: 'recorded',
      transactionId: 'tx-1',
      direction: 'income',
      amountMinor: 50_00,
      balanceMinor: 100_00,
    })
    renderDialog()
    await typeTarget('150')
    await screen.findByText(/Money in of/)

    await user.click(
      screen.getByRole('button', { name: 'Record the correction' }),
    )

    await waitFor(() => {
      expect(server.adjustAccountBalance).toHaveBeenCalledTimes(1)
    })
  })
})

describe('a failed read', () => {
  it('names the date, offers a retry and keeps recording blocked', async () => {
    server.getAccountBalanceOn.mockRejectedValue(new Error('boom'))
    renderDialog()

    const message = await screen.findByText(
      sentence('accounts.adjust.preview.error', 'March 15, 2026'),
    )
    expect(message).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    const record = screen.getByRole('button', { name: 'Record the correction' })
    expect(
      record.getAttribute('aria-disabled') ?? record.getAttribute('disabled'),
    ).not.toBeNull()
  })

  it('explains the block with a sentence that names Try again, not one that promises a load', async () => {
    server.getAccountBalanceOn.mockRejectedValue(new Error('boom'))
    renderDialog()
    await screen.findByText(
      sentence('accounts.adjust.preview.error', 'March 15, 2026'),
    )

    const reason = blockedReason()
    expect(reason?.textContent).toBe(
      sentence('accounts.adjust.preview.blockedFailed', 'March 15, 2026'),
    )
    expect(reason?.textContent).toContain('Try again')
    expect(reason?.textContent).not.toMatch(/\b(above|below)\b/i)
  })

  it('keeps the loading sentence while loading, and while a retry is in flight', async () => {
    const retried = deferred<{ balanceMinor: number }>()
    server.getAccountBalanceOn
      .mockRejectedValueOnce(new Error('boom'))
      .mockReturnValueOnce(retried.promise)
    renderDialog()
    const loading = sentence(
      'accounts.adjust.preview.blocked',
      'March 15, 2026',
    )
    // First read still pending: the blocked sentence is the loading one.
    expect(blockedReason()?.textContent).toBe(loading)

    await screen.findByText(
      sentence('accounts.adjust.preview.error', 'March 15, 2026'),
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    // The retry in flight reverts to the loading sentence, on the same element.
    expect(blockedReason()?.textContent).toBe(loading)

    retried.reject(new Error('boom again'))
    await waitFor(() => {
      expect(blockedReason()?.textContent).toBe(
        sentence('accounts.adjust.preview.blockedFailed', 'March 15, 2026'),
      )
    })
  })

  it('moves focus to the status container when a successful retry removes the button', async () => {
    server.getAccountBalanceOn
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ balanceMinor: 100_00 })
    renderDialog()
    await typeTarget('150')

    const retry = await screen.findByRole('button', { name: 'Try again' })
    await user.click(retry)

    await screen.findByText(/Money in of/)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    const status = screen.getByRole('status')
    expect(status.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(status)
  })

  it('reads as loading while a retry is in flight, so a second failure is announced', async () => {
    const retried = deferred<{ balanceMinor: number }>()
    server.getAccountBalanceOn
      .mockRejectedValueOnce(new Error('boom'))
      .mockReturnValueOnce(retried.promise)
    renderDialog()

    const error = sentence('accounts.adjust.preview.error', 'March 15, 2026')
    await screen.findByText(error)
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    const status = screen.getByRole('status')
    expect(status.textContent).toContain(
      sentence('accounts.adjust.preview.loading', 'March 15, 2026'),
    )
    expect(status.textContent).not.toContain(error)

    retried.reject(new Error('boom again'))
    expect(await screen.findByText(error)).toBeTruthy()
  })
})

// Kept next to the others so a reader sees every status region the dialog may expose.
describe('the status region', () => {
  it('stays mounted through loading, loaded and failed', async () => {
    server.getAccountBalanceOn.mockResolvedValue({ balanceMinor: 100_00 })
    renderDialog()
    const region = screen.getByRole('status')

    await screen.findByText(/Nothing|Money in|Money out|expense/i)
    expect(screen.getByRole('status')).toBe(region)
    expect(within(region).queryByRole('button')).toBeNull()
  })
})

describe('a booking date later than today', () => {
  // UX only: the server still accepts a future date (#657), so nothing here may be worded or
  // read as the server refusing it.
  async function pickTomorrow() {
    server.getAccountBalanceOn.mockResolvedValue({ balanceMinor: 100_00 })
    renderDialog()
    await typeTarget('150')
    await screen.findByText(/Money in of/)
    await dayForward()
  }

  it('shows the future-date error on the picker, and only that text', async () => {
    await pickTomorrow()

    const error = await screen.findByText(en['validation.date.future'])
    expect(error).toBeTruthy()
    expect(screen.queryByText(/constraints|Value must be/i)).toBeNull()
  })

  it('starts no balance read for it', async () => {
    await pickTomorrow()
    await screen.findByText(en['validation.date.future'])

    const dates = server.getAccountBalanceOn.mock.calls.map(
      ([call]) => call.data.on,
    )
    expect(dates).toEqual(['2026-03-15'])
  })

  it('disables Record and says to pick a date up to today', async () => {
    await pickTomorrow()
    await screen.findByText(en['validation.date.future'])

    const record = screen.getByRole('button', { name: 'Record the correction' })
    expect(
      record.getAttribute('aria-disabled') ?? record.getAttribute('disabled'),
    ).not.toBeNull()
    expect(blockedReason()?.textContent).toBe(
      en['accounts.adjust.preview.blockedFuture'],
    )
  })

  it('does not submit on Enter in the amount field', async () => {
    await pickTomorrow()
    await screen.findByText(en['validation.date.future'])

    const field = screen.getByRole('textbox', {
      name: /what the balance should be/i,
    })
    await user.type(field, '{Enter}')

    expect(server.adjustAccountBalance).not.toHaveBeenCalled()
  })

  it('can be corrected: back on today the read runs and Record is enabled again', async () => {
    await pickTomorrow()
    await screen.findByText(en['validation.date.future'])

    await dayBack()

    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: 'Record the correction' })
          .hasAttribute('disabled'),
      ).toBe(false)
    })
    expect(screen.queryByText(en['validation.date.future'])).toBeNull()
  })
})

describe('the result card', () => {
  it('states the date that was written, not the one the picker shows by then', async () => {
    server.getAccountBalanceOn.mockResolvedValue({ balanceMinor: 100_00 })
    const write = deferred<{
      status: 'recorded'
      transactionId: string
      direction: 'income'
      amountMinor: number
      balanceMinor: number
    }>()
    server.adjustAccountBalance.mockReturnValue(write.promise)
    renderDialog()
    await typeTarget('150')
    await screen.findByText(/Money in of/)

    await user.click(
      screen.getByRole('button', { name: 'Record the correction' }),
    )
    expect(server.adjustAccountBalance).toHaveBeenCalledWith({
      data: expect.objectContaining({ bookedOn: '2026-03-15' }),
    })
    // The picker stays editable while the save is in flight.
    await dayBack()

    write.resolve({
      status: 'recorded',
      transactionId: 'tx-1',
      direction: 'income',
      amountMinor: 50_00,
      balanceMinor: 100_00,
    })

    const written = await screen.findByText(/^Money in of .* was recorded/)
    expect(written.textContent).toContain('March 15, 2026')
    expect(written.textContent).not.toContain('March 14, 2026')
  })

  it('takes focus from the Record button it replaces, so the outcome is read out', async () => {
    server.getAccountBalanceOn.mockResolvedValue({ balanceMinor: 100_00 })
    server.adjustAccountBalance.mockResolvedValue({
      status: 'recorded',
      transactionId: 'tx-1',
      direction: 'income',
      amountMinor: 50_00,
      balanceMinor: 100_00,
    })
    renderDialog()
    await typeTarget('150')
    await screen.findByText(/Money in of/)

    await user.click(
      screen.getByRole('button', { name: 'Record the correction' }),
    )

    const written = await screen.findByText(/^Money in of .* was recorded/)
    const status = screen.getByRole('status')
    expect(status.contains(written)).toBe(true)
    expect(status.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(status)
  })

  it('does the same for an unchanged outcome', async () => {
    server.getAccountBalanceOn.mockResolvedValue({ balanceMinor: 100_00 })
    const write = deferred<{ status: 'unchanged'; balanceMinor: number }>()
    server.adjustAccountBalance.mockReturnValue(write.promise)
    renderDialog()
    await typeTarget('100')
    await screen.findByText(/^Nothing\./)

    await user.click(
      screen.getByRole('button', { name: 'Record the correction' }),
    )
    await dayBack()
    write.resolve({ status: 'unchanged', balanceMinor: 100_00 })

    const written = await screen.findByText(/^Nothing was written/)
    expect(written.textContent).toContain('March 15, 2026')
    expect(document.activeElement).toBe(screen.getByRole('status'))
  })
})
