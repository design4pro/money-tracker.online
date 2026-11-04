/**
 * The MCP HTTP door in workerd: unauthenticated calls are 401 with RFC 9728
 * metadata, and the Worker still exports only AccountLedger.
 */

import { describe, expect, it, vi } from 'vitest'

import { handleMcpRequest } from '../handler'
import { AccountLedger } from '../../do/account-ledger'
import * as workerEntry from '../../worker.workerd-entry'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ handler: (run: unknown) => run }),
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeader: () => undefined,
  getRequest: () => new Request('https://example.test/'),
}))

describe('handleMcpRequest', () => {
  it('answers 401 with a protected-resource challenge when no bearer is sent', async () => {
    const response = await handleMcpRequest(
      new Request('https://example.test/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {},
        }),
      }),
    )
    expect(response.status).toBe(401)
    const challenge = response.headers.get('www-authenticate') ?? ''
    expect(challenge).toMatch(/Bearer/i)
    expect(challenge).toMatch(/resource_metadata=/)
    expect(challenge).toMatch(/oauth-protected-resource/)
  })
})

describe('the workerd entry', () => {
  it('still exports only AccountLedger as a Durable Object class', () => {
    expect(workerEntry.AccountLedger).toBe(AccountLedger)
    const exported = Object.keys(workerEntry).filter((key) => key !== 'default')
    expect(exported).toEqual(['AccountLedger'])
  })
})
