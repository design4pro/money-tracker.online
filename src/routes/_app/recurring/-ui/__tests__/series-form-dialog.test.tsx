import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { SeriesFormDialog } from '../series-form-dialog'

import type { Catalogue } from '#/lib/i18n'

/**
 * A submit with no name must say so. The field is given `errorMessage` once the person has tried
 * to submit, and `FieldError` renders only on an invalid field: without the field itself turning a
 * caller-owned message into the invalid state, the dialog showed nothing and set no
 * `aria-invalid` (WCAG 3.3.1).
 */

const server = vi.hoisted(() => ({
  createSeries: vi.fn(),
  updateSeries: vi.fn(),
}))

vi.mock('#/server/fns/recurring', () => server)

const user = userEvent.setup()

function renderDialog() {
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <SeriesFormDialog
        isOpen
        onOpenChange={() => {}}
        series={null}
        accounts={[]}
        categories={[]}
        payees={[]}
        currencyOptions={['PLN']}
        baseCurrencyCode="PLN"
        onSaved={() => {}}
      />
    </I18nProvider>,
  )
}

describe('SeriesFormDialog name', () => {
  it.each(['', '   '])(
    'shows the message and marks the field invalid when submitted as %j',
    async (typed) => {
      renderDialog()
      const name = screen.getByRole('textbox', { name: 'Name' })
      expect(name.getAttribute('aria-invalid')).toBeNull()

      if (typed !== '') await user.type(name, typed)
      await user.click(screen.getByRole('button', { name: 'Create' }))

      expect(name.getAttribute('aria-invalid')).toBe('true')
      expect(screen.getByText(en['validation.name.required'])).toBeTruthy()
      expect(server.createSeries).not.toHaveBeenCalled()
    },
  )
})

/**
 * The reminder cap is a limit, not a mistake: the boxes past it are disabled and the selection is
 * sliced. Handing the cap sentence to the group as `errorMessage` must not turn a valid selection
 * into an invalid one.
 */
describe('SeriesFormDialog reminders', () => {
  it('does not show the cap as an error once three reminders are ticked', async () => {
    renderDialog()
    const group = screen.getByRole('group', { name: 'Remind me' })

    for (const name of ['On the day', 'A day before', 'Two days before']) {
      const box = screen.getByRole('checkbox', { name })
      if (!(box as HTMLInputElement).checked) await user.click(box)
    }

    expect(
      screen
        .getAllByRole('checkbox', { checked: true })
        .filter((box) => group.contains(box)),
    ).toHaveLength(3)
    expect(screen.queryByText(en['recurring.reminders.max'])).toBeNull()
    expect(group.hasAttribute('data-invalid')).toBe(false)
  })
})

/**
 * A JDG duty template fills the form and marks the series as a duty. The mark must not outlive the
 * template: a weekly or income "ZUS" is not the 20th-of-the-month shape the badge promises. The
 * yearly month, on the other hand, belongs to the person's choice and survives a round trip
 * through another frequency.
 */
describe('SeriesFormDialog duty template', () => {
  async function pick(label: string, option: string) {
    await user.click(screen.getByRole('button', { name: new RegExp(label) }))
    await user.click(await screen.findByRole('option', { name: option }))
  }

  it('shows the duty disclaimer after a template and drops it when the kind leaves Bill', async () => {
    renderDialog()
    expect(screen.queryByText(en['recurring.duty.disclaimer'])).toBeNull()

    await user.click(
      screen.getByRole('button', { name: 'Use ZUS contribution' }),
    )
    expect(screen.getByText(en['recurring.duty.disclaimer'])).toBeTruthy()
    expect(
      (screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value,
    ).toBe('ZUS contribution')

    await pick('Kind', 'Income')
    expect(screen.queryByText(en['recurring.duty.disclaimer'])).toBeNull()
  })

  it('drops the duty disclaimer when the frequency leaves Monthly', async () => {
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Use VAT-7' }))
    expect(screen.getByText(en['recurring.duty.disclaimer'])).toBeTruthy()

    await pick('How often', 'Weekly')
    expect(screen.queryByText(en['recurring.duty.disclaimer'])).toBeNull()
  })

  it('keeps the chosen yearly month across a frequency round trip', async () => {
    renderDialog()
    await pick('How often', 'Yearly')
    await pick('Month of the year', 'November')
    expect(
      screen.getByRole('button', { name: /Month of the year/ }).textContent,
    ).toContain('November')

    await pick('How often', 'Monthly')
    expect(
      screen.queryByRole('button', { name: /Month of the year/ }),
    ).toBeNull()

    await pick('How often', 'Yearly')
    expect(
      screen.getByRole('button', { name: /Month of the year/ }).textContent,
    ).toContain('November')
  })
})
