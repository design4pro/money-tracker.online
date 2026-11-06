import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { AgentsPage } from '../agents-page'

import type { AgentGrantView } from '#/server/repos/agent-grants'

const grant: AgentGrantView = {
  id: 'g1',
  userId: 'u1',
  kind: 'pat',
  name: 'Inspector',
  clientId: null,
  tokenPrefix: 'mto_stg_abc_',
  scopes: ['accounts:read'],
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  revokedAt: null,
  lastUsedAt: null,
}

function renderPage(
  page: Parameters<typeof AgentsPage>[0]['page'],
  onUpdate: Parameters<typeof AgentsPage>[0]['onUpdate'] = vi.fn(),
) {
  return render(
    <I18nProvider locale="en" messages={en}>
      <AgentsPage
        page={page}
        onMint={vi.fn()}
        onRevoke={vi.fn()}
        onUpdate={onUpdate}
      />
    </I18nProvider>,
  )
}

describe('AgentsPage', () => {
  it('explains the member-only state and hides mint and revoke', () => {
    renderPage({ kind: 'member', mcpUrl: 'https://example.test/api/mcp' })
    expect(
      screen.getByRole('heading', {
        name: en['settings.agents.membersOnly'],
      }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: en['settings.agents.createToken'] }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: en['settings.agents.revoke'] }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: /Edit settings/ })).toBeNull()
  })

  it('shows the locked plan copy and a billing link, without mint', () => {
    renderPage({
      kind: 'locked',
      mcpUrl: 'https://example.test/api/mcp',
      grants: [],
    })
    expect(screen.getByText(en['settings.agents.locked'])).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: en['settings.agents.locked.cta'] })
        .getAttribute('href'),
    ).toBe('/settings/billing')
    expect(
      screen.queryByRole('button', { name: en['settings.agents.createToken'] }),
    ).toBeNull()
  })

  it('shows the empty copy on a paid plan', () => {
    renderPage({
      kind: 'ready',
      mcpUrl: 'https://example.test/api/mcp',
      grants: [],
    })
    expect(
      screen.getByRole('heading', { name: en['settings.agents.empty'] }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: en['settings.agents.createToken'] }),
    ).toBeTruthy()
  })

  it('lists a grant and offers revoke', () => {
    renderPage({
      kind: 'ready',
      mcpUrl: 'https://example.test/api/mcp',
      grants: [grant],
    })
    expect(screen.getByText('Inspector')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Revoke Inspector' }),
    ).toBeTruthy()
  })

  it('opens the revoke dialog when Enter is pressed on the named control', async () => {
    const user = userEvent.setup()
    renderPage({
      kind: 'ready',
      mcpUrl: 'https://example.test/api/mcp',
      grants: [grant],
    })

    const revoke = screen.getByRole('button', { name: 'Revoke Inspector' })
    revoke.focus()
    await user.keyboard('{Enter}')

    const dialog = await screen.findByRole('alertdialog')
    expect(
      screen.getByRole('heading', { name: 'Revoke Inspector?' }),
    ).toBeTruthy()
    expect(dialog).toBeTruthy()
  })

  it('hides edit on a locked plan and still offers revoke', () => {
    renderPage({
      kind: 'locked',
      mcpUrl: 'https://example.test/api/mcp',
      grants: [grant],
    })
    expect(
      screen.queryByRole('button', { name: 'Edit settings for Inspector' }),
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Revoke Inspector' }),
    ).toBeTruthy()
  })

  it('saves a new name and scope for a personal token and an OAuth app', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const oauth: AgentGrantView = {
      ...grant,
      id: 'g2',
      kind: 'oauth',
      name: 'Connector',
      clientId: 'client-1',
      tokenPrefix: null,
      scopes: ['accounts:read'],
      lastUsedAt: new Date('2026-11-02T12:00:00.000Z'),
    }
    renderPage(
      {
        kind: 'ready',
        mcpUrl: 'https://example.test/api/mcp',
        grants: [grant, oauth],
      },
      onUpdate,
    )

    await user.click(
      screen.getByRole('button', { name: 'Edit settings for Inspector' }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('heading', { name: 'Settings for Inspector' }),
    ).toBeTruthy()
    expect(within(dialog).getByText(/Personal token/)).toBeTruthy()
    expect(within(dialog).getByText(/Last used Never/)).toBeTruthy()

    const readAccounts = screen.getByRole('checkbox', { name: 'Read accounts' })
    await user.click(readAccounts)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(
      screen.getByText(en['settings.agents.edit.scopesRequired']),
    ).toBeTruthy()

    await user.click(readAccounts)
    await user.click(
      screen.getByRole('checkbox', { name: 'Create and change entries' }),
    )
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Household laptop')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onUpdate).toHaveBeenCalledWith({
      grantId: 'g1',
      name: 'Household laptop',
      scopes: ['accounts:read', 'transactions:write'],
    })
    expect(dialog).toBeTruthy()

    await user.click(
      screen.getByRole('button', { name: 'Edit settings for Connector' }),
    )
    const oauthDialog = await screen.findByRole('dialog')
    expect(
      within(oauthDialog).getByRole('heading', {
        name: 'Settings for Connector',
      }),
    ).toBeTruthy()
    expect(within(oauthDialog).getByText(/OAuth app/)).toBeTruthy()
    expect(within(oauthDialog).getByText(/Last used/)).toBeTruthy()
    expect(within(oauthDialog).queryByText(/Never/)).toBeNull()
  })
})
