import { useState } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'
import { asCurrencyCode, asMinor } from '#/lib/money'

import { TransactionForm, emptyFormValues } from '../transaction-form'

import type { Catalogue } from '#/lib/i18n'
import type { RefusedBooking, TransactionFormValues } from '../transaction-form'
import type { TransactionReference } from '../types'

/**
 * A settled entry stops at today and a planned one may run up to ten years ahead. `FUTURE` is a year
 * on, inside the planned range, so a planned entry is valid and a settled one is not.
 */

const DAY_MS = 86_400_000
const FUTURE = new Date(Date.now() + 365 * DAY_MS).toISOString().slice(0, 10)
const ANOTHER_FUTURE = new Date(Date.now() + 366 * DAY_MS)
  .toISOString()
  .slice(0, 10)

const REFERENCE: TransactionReference = {
  accounts: [
    {
      id: 'acc-pln',
      name: 'Current',
      currencyCode: asCurrencyCode('PLN'),
      isArchived: false,
    },
  ],
  accountGroups: [],
  categories: [],
  payees: [],
  tags: [],
  baseCurrencyCode: asCurrencyCode('PLN'),
}

function Wired({
  locale = 'en',
  initial,
  storedSettledOn,
  refusedBooking,
  serverError,
  onSubmit = () => {},
}: {
  readonly locale?: 'en' | 'pl'
  readonly initial: Partial<TransactionFormValues>
  readonly storedSettledOn?: string
  readonly refusedBooking?: RefusedBooking
  readonly serverError?: string
  readonly onSubmit?: () => void
}) {
  const [values, setValues] = useState<TransactionFormValues>(() => ({
    ...emptyFormValues('acc-pln', '2026-03-15'),
    amountMinor: asMinor(1_000),
    ...initial,
  }))
  return (
    <I18nProvider
      locale={locale}
      messages={(locale === 'pl' ? pl : en) as Catalogue}
    >
      <TransactionForm
        values={values}
        onChange={setValues}
        reference={REFERENCE}
        onSubmit={onSubmit}
        onCancel={() => {}}
        isSubmitting={false}
        submitLabel="Save"
        storedSettledOn={storedSettledOn}
        refusedBooking={refusedBooking}
        serverError={serverError}
      />
    </I18nProvider>
  )
}

/** The date field's group, which carries the invalid state and the description link. */
function dateGroup(): HTMLElement {
  return screen.getByRole('group', { name: /^(Date|Data)/ })
}

/** The text of every element the date field is described by. */
function dateDescription(): string {
  const ids = (dateGroup().getAttribute('aria-describedby') ?? '').split(/\s+/)
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
}

/** The calendar day before `iso`, as `YYYY-MM-DD`. */
function dayBefore(iso: string): string {
  return new Date(Date.parse(iso) - DAY_MS).toISOString().slice(0, 10)
}

/** The day cell for `iso`, found through the calendar popover the date field opens. */
function dayCell(iso: string): HTMLElement {
  const date = new Date(`${iso}T00:00:00Z`)
  const label = new Intl.DateTimeFormat('en', {
    dateStyle: 'full',
    timeZone: 'UTC',
  }).format(date)
  return screen.getByRole('button', { name: new RegExp(`^${label}`) })
}

describe('TransactionForm booking date', () => {
  afterEach(cleanup)

  it('shows no error for a settled entry dated today or before', () => {
    render(<Wired initial={{ bookedOn: '2026-03-15' }} />)

    expect(dateGroup().hasAttribute('data-invalid')).toBe(false)
    expect(dateDescription()).not.toContain('still ahead')
  })

  it('answers unticking "planned" under a future date with an inline error, keeping the date', async () => {
    const user = userEvent.setup()
    render(<Wired initial={{ bookedOn: FUTURE, isPlanned: true }} />)
    const planned = screen.getByRole('checkbox', { name: /Planned/ })
    expect(dateGroup().hasAttribute('data-invalid')).toBe(false)

    await user.click(planned)

    expect(dateGroup().hasAttribute('data-invalid')).toBe(true)
    expect(dateDescription()).toContain('still ahead')
    // The message names the control that fixes it, using that control's own label.
    expect(dateDescription()).toContain('"Planned"')
    // Focus stays on the checkbox, so the refusal is also announced by a status region.
    expect(screen.getByRole('status').textContent).toContain('still ahead')
    // Not clamped, not auto-ticked, and Save stays available.
    expect(within(dateGroup()).getByText(FUTURE.slice(0, 4))).toBeTruthy()
    expect((planned as HTMLInputElement).checked).toBe(false)
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('clears the error when "planned" is ticked again', async () => {
    const user = userEvent.setup()
    render(<Wired initial={{ bookedOn: FUTURE, isPlanned: false }} />)
    expect(dateGroup().hasAttribute('data-invalid')).toBe(true)

    await user.click(screen.getByRole('checkbox', { name: /Planned/ }))

    expect(dateGroup().hasAttribute('data-invalid')).toBe(false)
    expect(dateDescription()).not.toContain('still ahead')
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('says it in Polish with the Polish checkbox label', () => {
    render(<Wired locale="pl" initial={{ bookedOn: FUTURE }} />)

    expect(dateDescription()).toContain('Ta data jeszcze nie nadeszła.')
    expect(dateDescription()).toContain('„Planowana”')
  })

  it('blocks the submit and moves focus to the first date segment', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Wired initial={{ bookedOn: FUTURE }} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).not.toHaveBeenCalled()
    const focused = document.activeElement
    expect(focused?.getAttribute('role')).toBe('spinbutton')
    expect(dateGroup().contains(focused)).toBe(true)
  })

  it('submits a planned entry with a future date', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <Wired
        initial={{ bookedOn: FUTURE, isPlanned: true }}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).toHaveBeenCalledOnce()
  })

  describe('a legacy settled row dated after today', () => {
    it('opens without an error on its unchanged date and submits', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(
        <Wired
          initial={{ bookedOn: FUTURE }}
          storedSettledOn={FUTURE}
          onSubmit={onSubmit}
        />,
      )
      expect(dateGroup().hasAttribute('data-invalid')).toBe(false)

      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(onSubmit).toHaveBeenCalledOnce()
    })

    it('shows the error again for any other date', () => {
      render(
        <Wired
          initial={{ bookedOn: ANOTHER_FUTURE }}
          storedSettledOn={FUTURE}
        />,
      )

      expect(dateGroup().hasAttribute('data-invalid')).toBe(true)
    })
  })
  describe('a booking-date refusal from the server', () => {
    // A date the client check accepts, so the only reason to flag it is the server's refusal.
    const refused: RefusedBooking = { bookedOn: '2026-03-15', isPlanned: false }

    it("is said at the date field in the reader's language, not in the banner", () => {
      render(
        <Wired
          initial={{ bookedOn: refused.bookedOn }}
          refusedBooking={refused}
        />,
      )

      expect(dateGroup().hasAttribute('data-invalid')).toBe(true)
      expect(dateDescription()).toContain('still ahead')
      expect(dateDescription()).toContain('"Planned"')
      expect(screen.getByRole('status').textContent).toContain('still ahead')
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('says it in Polish', () => {
      render(
        <Wired
          locale="pl"
          initial={{ bookedOn: refused.bookedOn }}
          refusedBooking={refused}
        />,
      )

      expect(dateDescription()).toContain('Ta data jeszcze nie nadeszła.')
      expect(dateDescription()).toContain('„Planowana”')
    })

    it('does not block another attempt', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(
        <Wired
          initial={{ bookedOn: refused.bookedOn }}
          refusedBooking={refused}
          onSubmit={onSubmit}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(onSubmit).toHaveBeenCalledOnce()
    })

    it('clears as soon as the planned flag changes', async () => {
      const user = userEvent.setup()
      render(
        <Wired
          initial={{ bookedOn: refused.bookedOn }}
          refusedBooking={refused}
        />,
      )

      await user.click(screen.getByRole('checkbox', { name: /Planned/ }))

      expect(dateGroup().hasAttribute('data-invalid')).toBe(false)
      expect(screen.getByRole('status').textContent).toBe('')
    })

    it('clears as soon as the date changes', async () => {
      const user = userEvent.setup()
      render(
        <Wired
          initial={{ bookedOn: refused.bookedOn }}
          refusedBooking={refused}
        />,
      )

      const day = within(dateGroup()).getAllByRole('spinbutton')[1]
      await user.click(day)
      await user.keyboard('{ArrowUp}')

      expect(dateGroup().hasAttribute('data-invalid')).toBe(false)
    })

    it('leaves any other failure in the banner, with the date field untouched', () => {
      render(
        <Wired
          initial={{ bookedOn: refused.bookedOn }}
          serverError="Network down"
        />,
      )

      expect(screen.getByRole('alert').textContent).toContain('Network down')
      expect(dateGroup().hasAttribute('data-invalid')).toBe(false)
    })
  })

  describe('the calendar of a legacy settled row dated after today', () => {
    it('offers the stored date and nothing between it and today', async () => {
      const user = userEvent.setup()
      render(<Wired initial={{ bookedOn: FUTURE }} storedSettledOn={FUTURE} />)

      await user.click(screen.getByRole('button', { name: /Open calendar/ }))

      expect(
        dayCell(FUTURE).hasAttribute('data-unavailable') ||
          dayCell(FUTURE).getAttribute('aria-disabled') === 'true',
      ).toBe(false)
      // Adjacent-month cells are disabled until their month is displayed.
      if (FUTURE.slice(8) === '01') {
        await user.click(screen.getByRole('button', { name: 'Previous month' }))
      }
      const before = dayCell(dayBefore(FUTURE))
      expect(
        before.hasAttribute('data-unavailable') ||
          before.getAttribute('aria-disabled') === 'true',
      ).toBe(true)
    })

    it('keeps the stored date displayed', () => {
      render(<Wired initial={{ bookedOn: FUTURE }} storedSettledOn={FUTURE} />)

      expect(within(dateGroup()).getByText(FUTURE.slice(0, 4))).toBeTruthy()
    })

    it('offers every day up to the planned cap once the row is marked planned', async () => {
      const user = userEvent.setup()
      render(
        <Wired
          initial={{ bookedOn: FUTURE, isPlanned: true }}
          storedSettledOn={FUTURE}
        />,
      )

      await user.click(screen.getByRole('button', { name: /Open calendar/ }))

      const previousDay = dayBefore(FUTURE)
      if (previousDay.slice(0, 7) !== FUTURE.slice(0, 7)) {
        await user.click(screen.getByRole('button', { name: 'Previous month' }))
      }
      const before = dayCell(previousDay)
      expect(before.hasAttribute('data-unavailable')).toBe(false)
      expect(before.getAttribute('aria-disabled')).not.toBe('true')
    })
  })
})
