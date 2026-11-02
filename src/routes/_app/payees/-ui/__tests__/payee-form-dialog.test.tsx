import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { LEAKED_MESSAGE, wireFailure } from '#/lib/__tests__/wire-failure'
import { createPayee } from '#/server/fns/payees'

import { PayeeFormDialog } from '../payee-form-dialog'

import type { Catalogue } from '#/lib/i18n'

/**
 * What the payee dialog says when `createPayee` refuses.
 *
 * Before the failure middleware a duplicate alias read as the repository's sentence; the dialog
 * now tells a conflict from a validation failure by the kind of the failure, and the text of the
 * thrown error never reaches the screen.
 */

vi.mock('#/server/fns/payees', () => ({
  createPayee: vi.fn(),
  updatePayee: vi.fn(),
}))

async function saveRefusedWith(error: unknown) {
  vi.mocked(createPayee).mockRejectedValue(error)
  render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <PayeeFormDialog
        isOpen
        onOpenChange={() => {}}
        payee={null}
        categoryOptions={[]}
        onSaved={() => {}}
      />
    </I18nProvider>,
  )
  await userEvent.type(screen.getByRole('textbox', { name: /name/i }), 'Żabka')
  await userEvent.click(
    screen.getByRole('button', { name: en['action.create'] }),
  )
  return screen.findByRole('alert')
}

describe('PayeeFormDialog, a refused save', () => {
  beforeEach(() => {
    vi.mocked(createPayee).mockReset()
  })

  it.each([
    ['conflict', en['failure.conflict']],
    ['validation', en['failure.validation']],
  ] as const)(
    'tells a %s failure apart by its kind',
    async (kind, sentence) => {
      const alert = await saveRefusedWith(wireFailure(kind))

      expect(alert.textContent).toContain(en['payees.form.error.title'])
      expect(alert.textContent).toContain(sentence)
      expect(document.body.textContent).not.toContain(LEAKED_MESSAGE)
    },
  )

  it('never prints the message of a plain error', async () => {
    const alert = await saveRefusedWith(new Error(LEAKED_MESSAGE))

    expect(alert.textContent).toContain(en['failure.internal'])
    expect(document.body.textContent).not.toContain(LEAKED_MESSAGE)
  })
})
