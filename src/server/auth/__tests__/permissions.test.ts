/**
 * The platform role grid.
 *
 * These roles govern the operator console — the currency catalogue, the plan definitions, the
 * support view — and they are a **different vocabulary** from the workspace roles that govern
 * somebody's money. The tests below check both that the grid says what it means and that the two
 * dictionaries stay apart.
 *
 * Pure and synchronous, because `permits` is. That is the point of it living apart from the
 * bindings: an authorisation rule you can only exercise through a request is a rule nobody
 * exercises.
 */

import { describe, expect, it } from 'vitest'

import {
  BANNED_USER_MESSAGE,
  DISABLED_ADMIN_PATHS,
  IMPERSONATION_SESSION_SECONDS,
  adminOptions,
  isPlatformRole,
  permits,
  resolvePlatformRole,
  roles,
} from '../permissions'

import type { PlatformActor } from '../permissions'

function actor(overrides: Partial<PlatformActor> = {}): PlatformActor {
  return { role: null, banned: false, impersonatedBy: null, ...overrides }
}

describe('resolvePlatformRole', () => {
  it('treats an unset role as the least privileged, never as unrestricted', () => {
    expect(resolvePlatformRole(null)).toBe('user')
    expect(resolvePlatformRole('')).toBe('user')
  })

  it('treats an unrecognised role as the least privileged', () => {
    // A value from a migration, a console edit or a future release. It must not open a door.
    expect(resolvePlatformRole('superuser')).toBe('user')
  })

  it('takes the highest of a comma-separated list, which is how the plugin stores several', () => {
    expect(resolvePlatformRole('curator,admin')).toBe('admin')
    expect(resolvePlatformRole('user,curator')).toBe('curator')
  })

  it('recognises exactly the three declared names', () => {
    expect(Object.keys(roles)).toEqual(['admin', 'curator', 'user'])
    expect(isPlatformRole('curator')).toBe(true)
    expect(isPlatformRole('owner')).toBe(false)
  })
})

describe('permits', () => {
  it('refuses an absent actor', () => {
    expect(permits(null, { catalog: ['read'] })).toBe(false)
  })

  it('gives an admin the whole grid', () => {
    const operator = actor({ role: 'admin' })
    expect(permits(operator, { user: ['ban'] })).toBe(true)
    expect(permits(operator, { catalog: ['write'] })).toBe(true)
    expect(permits(operator, { plan: ['write'] })).toBe(true)
    expect(permits(operator, { support: ['read'] })).toBe(true)
  })

  it('gives a curator the catalogue and nothing that touches a person', () => {
    const curator = actor({ role: 'curator' })
    expect(permits(curator, { catalog: ['write'] })).toBe(true)
    expect(permits(curator, { support: ['read'] })).toBe(true)
    expect(permits(curator, { user: ['ban'] })).toBe(false)
    expect(permits(curator, { user: ['impersonate'] })).toBe(false)
    expect(permits(curator, { plan: ['write'] })).toBe(false)
    expect(permits(curator, { session: ['revoke'] })).toBe(false)
  })

  it('gives an ordinary account no platform surface at all', () => {
    const ordinary = actor({ role: 'user' })
    expect(permits(ordinary, { catalog: ['read'] })).toBe(false)
    expect(permits(ordinary, { support: ['read'] })).toBe(false)
  })

  it('requires every action in a request, not any of them', () => {
    const curator = actor({ role: 'curator' })
    expect(permits(curator, { catalog: ['read', 'write'] })).toBe(true)
    // `catalog:write` is held, `user:ban` is not, so the pair is refused.
    expect(permits(curator, { catalog: ['write'], user: ['ban'] })).toBe(false)
  })

  it('lets a ban veto a role rather than change it', () => {
    expect(
      permits(actor({ role: 'admin', banned: true }), { user: ['ban'] }),
    ).toBe(false)
    expect(
      permits(actor({ role: 'curator', banned: true }), { catalog: ['read'] }),
    ).toBe(false)
  })

  it('refuses everything while an account is being impersonated', () => {
    // The operator is wearing this account. Borrowing its authority would make impersonation a
    // privilege-escalation tool: sign in as a curator, keep the catalogue write.
    expect(
      permits(actor({ role: 'curator', impersonatedBy: 'op-1' }), {
        catalog: ['write'],
      }),
    ).toBe(false)
    expect(
      permits(actor({ role: 'admin', impersonatedBy: 'op-1' }), {
        support: ['read'],
      }),
    ).toBe(false)
  })

  it('checks the ban before the impersonation, so ending one does not lift the other', () => {
    const both = actor({ role: 'admin', banned: true, impersonatedBy: 'op-1' })
    expect(permits(both, { user: ['list'] })).toBe(false)
  })
})

describe('the admin plugin options', () => {
  it('passes the complete role set, not just the access controller', () => {
    // Passing `ac` without `roles` denies every curator statement with no error and no warning.
    expect(Object.keys(adminOptions.roles)).toEqual([
      'admin',
      'curator',
      'user',
    ])
  })

  it('names only declared roles as admin roles', () => {
    for (const name of adminOptions.adminRoles) {
      expect(isPlatformRole(name)).toBe(true)
    }
  })

  it('defaults a new account to the least privileged role', () => {
    expect(adminOptions.defaultRole).toBe('user')
  })

  it('has no adminUserIds slot to fill', () => {
    // An id there short-circuits the plugin's permission check to `true` while reading as a plain
    // user everywhere a person could look. An empty array is a slot, and slots get filled.
    expect('adminUserIds' in adminOptions).toBe(false)
  })

  it('bounds an impersonated session explicitly', () => {
    expect(adminOptions.impersonationSessionDuration).toBe(
      IMPERSONATION_SESSION_SECONDS,
    )
    expect(IMPERSONATION_SESSION_SECONDS).toBeLessThanOrEqual(3600)
  })

  it('states what a suspended account is told', () => {
    expect(adminOptions.bannedUserMessage).toBe(BANNED_USER_MESSAGE)
  })
})

describe('the disabled console paths', () => {
  it('closes every admin path with the router’s own spelling', () => {
    expect(DISABLED_ADMIN_PATHS.length).toBeGreaterThan(0)
    for (const path of DISABLED_ADMIN_PATHS) {
      // Matching happens with `basePath` already stripped. `/api/auth/admin/...` matches nothing.
      expect(path.startsWith('/admin/')).toBe(true)
      expect(path.startsWith('/api/')).toBe(false)
    }
  })

  it('lists each path once', () => {
    expect(new Set(DISABLED_ADMIN_PATHS).size).toBe(DISABLED_ADMIN_PATHS.length)
  })
})
