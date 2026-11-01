import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { LEAKED_MESSAGE, wireFailure } from '#/lib/__tests__/wire-failure'

import { ConfirmDialog } from '../confirm-dialog'

import type { Catalogue } from '#/lib/i18n'

/**
 * What the confirm dialog says when the server refuses.
 *
 * The call site's own title and body are catalogue copy and stay for a failure the reader can try
 * again; every other kind gets the sentence of its kind. The text of the thrown error never shows.
 */

async function confirmWith(onConfirm: () => Promise<unknown>) {
  render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <ConfirmDialog
        isOpen
        onOpenChange={() => {}}
        title="Delete the account?"
        body="This cannot be undone."
        confirmLabel="Delete"
        errorTitle="The account was not deleted"
        errorBody="Move its transactions first."
        onConfirm={onConfirm}
      />
    </I18nProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
  return screen.findByRole('alert')
}

describe('ConfirmDialog, a refused action', () => {
  it('keeps the call site wording for a conflict and never prints the message', async () => {
    const alert = await confirmWith(() =>
      Promise.reject(wireFailure('conflict')),
    )

    expect(alert.textContent).toContain('The account was not deleted')
    expect(alert.textContent).toContain('Move its transactions first.')
    expect(document.body.textContent).not.toContain(LEAKED_MESSAGE)
    expect(document.body.textContent).not.toContain('412')
  })

  it.each([
    ['forbidden', en['failure.forbidden']],
    ['not_found', en['failure.not_found']],
    ['internal', en['failure.internal']],
  ] as const)('shows the sentence of a %s failure', async (kind, sentence) => {
    const alert = await confirmWith(() => Promise.reject(wireFailure(kind)))

    expect(alert.textContent).toContain(sentence)
    expect(document.body.textContent).not.toContain(LEAKED_MESSAGE)
  })

  it('reads a plain error as the internal failure, not as its message', async () => {
    const alert = await confirmWith(() =>
      Promise.reject(new Error(LEAKED_MESSAGE)),
    )

    expect(alert.textContent).toContain(en['failure.internal'])
    expect(document.body.textContent).not.toContain(LEAKED_MESSAGE)
  })
})
