import { render, screen } from '@testing-library/react'
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

function renderPage(page: Parameters<typeof AgentsPage>[0]['page']) {
  return render(
    <I18nProvider locale="en" messages={en}>
      <AgentsPage page={page} onMint={vi.fn()} onRevoke={vi.fn()} />
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
})
