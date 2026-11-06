import { describe, expect, it } from 'vitest'

import { READ_SCOPES, parseRequestedAgentScopes } from '../agent-scopes'

describe('parseRequestedAgentScopes', () => {
  it('keeps matching resource:verb tokens', () => {
    expect(
      parseRequestedAgentScopes('accounts:read transactions:write openid'),
    ).toEqual(['accounts:read', 'transactions:write'])
  })

  it('defaults to every read scope when none match', () => {
    expect(parseRequestedAgentScopes('openid profile')).toEqual([
      ...READ_SCOPES,
    ])
  })
})
