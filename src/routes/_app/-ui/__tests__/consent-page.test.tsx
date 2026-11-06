import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { READ_SCOPES, scopeMessageKey } from '#/lib/agent-scopes'
import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { ConsentPage } from '../consent-page'

function checkbox(name: string): HTMLInputElement {
  const box = screen.getByRole('checkbox', { name })
  if (!(box instanceof HTMLInputElement)) {
    throw new Error(`Expected a checkbox input for ${name}`)
  }
  return box
}

function renderConsent(props: Partial<Parameters<typeof ConsentPage>[0]> = {}) {
  return render(
    <I18nProvider locale="en" messages={en}>
      <ConsentPage
        consent={{
          workspaceName: 'Northwind',
          mcpEnabled: true,
          canManage: true,
        }}
        clientId="inspector-client"
        onAllow={vi.fn()}
        onDecide={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  )
}

describe('ConsentPage', () => {
  it('focuses the heading and shows Deny then Allow', () => {
    renderConsent()
    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'Allow inspector-client?',
    })
    expect(document.activeElement).toBe(heading)
    expect(
      screen.getByRole('button', { name: en['oauth.consent.deny'] }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: en['oauth.consent.allow'] }),
    ).toBeTruthy()
  })

  it('shows membersOnly and no consent buttons for a member', () => {
    renderConsent({
      consent: {
        workspaceName: 'Northwind',
        mcpEnabled: true,
        canManage: false,
      },
    })
    expect(
      screen.getByRole('heading', {
        name: en['settings.agents.membersOnly'],
      }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: en['oauth.consent.allow'] }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: en['oauth.consent.deny'] }),
    ).toBeNull()
  })

  it('starts with read scopes and posts the write and delete boxes that were checked', async () => {
    const user = userEvent.setup()
    const onAllow = vi.fn().mockResolvedValue(undefined)
    const onDecide = vi.fn().mockResolvedValue(undefined)
    renderConsent({ onAllow, onDecide })

    for (const scope of READ_SCOPES) {
      expect(checkbox(en[scopeMessageKey(scope)]).checked).toBe(true)
    }
    expect(
      checkbox(en['settings.agents.scope.transactions.write']).checked,
    ).toBe(false)
    expect(
      checkbox(en['settings.agents.scope.transactions.delete']).checked,
    ).toBe(false)

    await user.click(checkbox(en['settings.agents.scope.transactions.write']))
    await user.click(checkbox(en['settings.agents.scope.transactions.delete']))
    await user.click(
      screen.getByRole('button', { name: en['oauth.consent.allow'] }),
    )

    expect(onAllow).toHaveBeenCalledTimes(1)
    const scopes = onAllow.mock.calls[0]?.[0].scopes as ReadonlyArray<string>
    expect(scopes).toEqual(
      expect.arrayContaining([
        ...READ_SCOPES,
        'transactions:write',
        'transactions:delete',
      ]),
    )
    expect(scopes).not.toContain('categories:write')
    expect(scopes).not.toContain('categories:delete')
    expect(onDecide).toHaveBeenCalledWith(true)
  })
})
