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
