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
import type { TransactionFormValues } from '../transaction-form'
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
  onSubmit = () => {},
}: {
  readonly locale?: 'en' | 'pl'
  readonly initial: Partial<TransactionFormValues>
  readonly storedSettledOn?: string
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
})
