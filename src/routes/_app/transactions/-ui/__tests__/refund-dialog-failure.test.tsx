import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { LEAKED_MESSAGE, wireFailure } from '#/lib/__tests__/wire-failure'
import { linkRefund, suggestRefundTargets } from '#/server/fns/refunds'

import { RefundDialog } from '../refund-dialog'

import type { Catalogue } from '#/lib/i18n'

/**
 * What the refund dialog says when `linkRefund` refuses.
 *
 * The over-refund, cross-currency and wrong-direction refusals are conflicts, and the sentence of
 * the kind alone ("reload and try again") is the wrong advice for them, so the dialog keeps its own
 * catalogue sentence for a conflict or a validation failure. Any other kind reads as its kind, and
 * the text of the thrown error never shows.
 */

vi.mock('#/server/fns/refunds', () => ({
  linkRefund: vi.fn(),
  suggestRefundTargets: vi.fn(),
}))

async function linkRefusedWith(error: unknown) {
  vi.mocked(suggestRefundTargets).mockResolvedValue([])
  vi.mocked(linkRefund).mockRejectedValue(error)
  render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <RefundDialog
        isOpen
        onOpenChange={() => {}}
        refundTransactionId="01k9z"
        onLinked={() => {}}
      />
    </I18nProvider>,
  )
  await screen.findByRole('dialog')
  await userEvent.click(
    screen.getByRole('button', { name: en['refunds.dialog.submit'] }),
  )
  return screen.findByRole('alert')
}

describe('RefundDialog, a refused link', () => {
  beforeEach(() => {
    vi.mocked(linkRefund).mockReset()
    vi.mocked(suggestRefundTargets).mockReset()
  })

  it.each(['conflict', 'validation'] as const)(
    'says what to change for a %s failure and never prints the message',
    async (kind) => {
      const alert = await linkRefusedWith(wireFailure(kind))

      expect(alert.textContent).toContain(en['refunds.dialog.error.title'])
      expect(alert.textContent).toContain(en['refunds.dialog.error.refused'])
      expect(document.body.textContent).not.toContain(LEAKED_MESSAGE)
    },
  )

  it('shows the sentence of the kind for an internal failure', async () => {
    const alert = await linkRefusedWith(wireFailure('internal'))

    expect(alert.textContent).toContain(en['failure.internal'])
    expect(alert.textContent).not.toContain(en['refunds.dialog.error.refused'])
    expect(document.body.textContent).not.toContain(LEAKED_MESSAGE)
  })
})
