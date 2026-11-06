import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { toast } from '#/components/ui'
import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { LEAKED_MESSAGE, wireFailure } from '#/lib/__tests__/wire-failure'
import { deleteAttachment } from '#/server/fns/attachments'

import { AttachmentList } from '../attachment-list'

import type { Catalogue } from '#/lib/i18n'

/**
 * A refused delete names the file in the toast, and the kind sentence as the description —
 * never the thrown error's text (#721).
 */

vi.mock('#/server/fns/attachments', () => ({
  deleteAttachment: vi.fn(),
}))

describe('AttachmentList, a refused delete', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('toasts the action and the file name, not only the kind', async () => {
    vi.mocked(deleteAttachment).mockRejectedValue(wireFailure('conflict'))
    vi.spyOn(toast, 'error').mockReturnValue(1)
    vi.spyOn(toast, 'success').mockReturnValue(1)

    render(
      <I18nProvider locale="en" messages={en as Catalogue}>
        <AttachmentList
          attachments={[
            {
              id: 'att_1',
              originalName: 'lidl.pdf',
              contentType: 'application/pdf',
              byteSize: 412_000,
            },
          ]}
          onDeleted={() => {}}
        />
      </I18nProvider>,
    )

    await userEvent.click(
      screen.getByRole('button', {
        name: en['attachments.remove'].replace('{name}', 'lidl.pdf'),
      }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: en['attachments.confirm.action'] }),
    )

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      en['attachments.toast.deleteFailed'].replace('{name}', 'lidl.pdf'),
      { description: en['failure.conflict'] },
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain(LEAKED_MESSAGE)
  })
})
