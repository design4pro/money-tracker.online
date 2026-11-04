import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { ConsentPage } from '../consent-page'

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
        requestedScope="accounts:read"
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
})
