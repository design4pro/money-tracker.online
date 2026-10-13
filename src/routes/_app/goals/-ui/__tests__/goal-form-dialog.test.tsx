import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { GoalFormDialog } from '../goal-form-dialog'

import type { Catalogue } from '#/lib/i18n'

/**
 * A submit with no name must say so. The field is given `errorMessage` once the person has tried
 * to submit, and `FieldError` renders only on an invalid field: without the field itself turning a
 * caller-owned message into the invalid state, the dialog showed nothing and set no
 * `aria-invalid` (WCAG 3.3.1).
 */

const server = vi.hoisted(() => ({
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
}))

vi.mock('#/server/fns/goals', () => server)

const user = userEvent.setup()

function renderDialog() {
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <GoalFormDialog
        isOpen
        onOpenChange={() => {}}
        goal={null}
        accounts={[]}
        currencyOptions={['PLN']}
        baseCurrencyCode="PLN"
        onSaved={() => {}}
      />
    </I18nProvider>,
  )
}

describe('GoalFormDialog name', () => {
  it.each(['', '   '])(
    'shows the message and marks the field invalid when submitted as %j',
    async (typed) => {
      renderDialog()
      const name = screen.getByRole('textbox', { name: 'What it is for' })
      expect(name.getAttribute('aria-invalid')).toBeNull()

      if (typed !== '') await user.type(name, typed)
      await user.click(screen.getByRole('button', { name: 'Create goal' }))

      expect(name.getAttribute('aria-invalid')).toBe('true')
      expect(screen.getByText(en['validation.name.required'])).toBeTruthy()
      expect(server.createGoal).not.toHaveBeenCalled()
    },
  )
})
