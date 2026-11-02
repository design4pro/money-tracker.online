import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { asMinor } from '#/lib/money'

import { AccountFormDialog } from '../account-form-dialog'

import type { Catalogue } from '#/lib/i18n'
import type { Account } from '#/server/db/types'

/**
 * A submit with no name must say so. The field is given `errorMessage` once the person has tried
 * to submit, and `FieldError` renders only on an invalid field: without the field itself turning a
 * caller-owned message into the invalid state, the dialog showed nothing and set no
 * `aria-invalid` (WCAG 3.3.1).
 */

const server = vi.hoisted(() => ({
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
}))

vi.mock('#/server/fns/accounts', () => server)

const user = userEvent.setup()

function renderDialog() {
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <AccountFormDialog
        isOpen
        onOpenChange={() => {}}
        account={null}
        currencyOptions={['PLN']}
        baseCurrencyCode="PLN"
        onSaved={() => {}}
      />
    </I18nProvider>,
  )
}

describe('AccountFormDialog name', () => {
  it.each(['', '   '])(
    'shows the message and marks the field invalid when submitted as %j',
    async (typed) => {
      renderDialog()
      const name = screen.getByRole('textbox', { name: 'Account name' })
      expect(name.getAttribute('aria-invalid')).toBeNull()

      if (typed !== '') await user.type(name, typed)
      await user.click(screen.getByRole('button', { name: 'Create' }))

      expect(name.getAttribute('aria-invalid')).toBe('true')
      expect(screen.getByText(en['validation.name.required'])).toBeTruthy()
      expect(server.createAccount).not.toHaveBeenCalled()
    },
  )
})

const ACCOUNT: Account = {
  id: 'acc-1',
  organizationId: 'org-1',
  name: 'Everyday',
  category: 'current',
  currencyCode: 'PLN',
  initialBalanceMinor: asMinor(0),
  refInitialBalanceMinor: asMinor(0),
  currentBalanceMinor: asMinor(0),
  refCurrentBalanceMinor: asMinor(0),
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

describe('AccountFormDialog currency lock', () => {
  it('disables the currency picker and states why when the account has entries', () => {
    render(
      <I18nProvider locale="en" messages={en as Catalogue}>
        <AccountFormDialog
          isOpen
          onOpenChange={() => {}}
          account={ACCOUNT}
          currencyLocked
          currencyOptions={['PLN', 'EUR']}
          baseCurrencyCode="PLN"
          onSaved={() => {}}
        />
      </I18nProvider>,
    )

    expect(screen.getByText(en['accounts.field.currency.locked'])).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /Currency/ }).getAttribute('disabled'),
    ).not.toBeNull()
  })
})
