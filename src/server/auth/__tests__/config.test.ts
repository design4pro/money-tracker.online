/**
 * The Better Auth option set, pinned.
 *
 * `authOptions()` carries decisions that hold today only because nobody has changed them (ADR 0011),
 * and nothing else calls it: a refactor that adds a cookie cache, moves the disabled paths into the
 * admin plugin or drops a provisioning hook would compile, pass every other test and ship. Each case
 * below names the reason its option exists, so the failure that follows an edit says what was lost.
 *
 * **Mocks.** `./env` reads `cloudflare:workers`, so the module is replaced by an `env` holding the
 * few values the options read, and `./db` hands back a real SQLite handle (the narrow exception the
 * `server` project allows; precedent in `src/server/fns/__tests__/attachments.test.ts`). The two
 * provisioning hooks are then driven against that database rather than asserted on by shape.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { member, organization } from '#/server/db/auth-schema'

import { authOptions } from '../config'
import {
  DISABLED_ADMIN_PATHS,
  DISABLED_ORGANIZATION_PATHS,
  adminOptions,
} from '../permissions'
import { openAuthTestDb, seedUser } from './harness'

import type { BetterAuthOptions } from 'better-auth'
import type { AppDatabase } from '../db'

const current = vi.hoisted(() => ({ db: undefined as unknown }))

/**
 * The two KV bindings, told apart. `SESSIONS` records its writes; `KV` is the general cache and
 * throws on any access, so a path that reaches it fails loudly rather than silently (ADR 0011).
 */
const stores = vi.hoisted(() => ({
  sessionPuts: [] as Array<{ key: string; value: string }>,
  sessions: {
    async put(key: string, value: string) {
      stores.sessionPuts.push({ key, value })
    },
  },
  cache: new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(
          `the general KV cache was touched (${String(property)}): sessions must live in SESSIONS`,
        )
      },
    },
  ),
}))

vi.mock('cloudflare:workers', () => ({
  env: {
    SESSIONS: stores.sessions,
    KV: stores.cache,
    BETTER_AUTH_SECRET: 'test-only-secret-that-is-not-a-real-deployment-value',
    APP_URL: 'https://app.example.test',
    EMAIL_API_KEY: '',
  },
}))

vi.mock('../db', () => ({ getDb: () => current.db }))

let db: AppDatabase
let options: BetterAuthOptions

beforeEach(() => {
  db = openAuthTestDb()
  current.db = db
  stores.sessionPuts.length = 0
  options = authOptions()
})

/** The configuration for a hook that is optional in Better Auth's types; absent means a defect. */
function present<T>(hook: T | undefined, name: string): T {
  if (hook === undefined) throw new Error(`${name} is not configured`)
  return hook
}

/** The plugin's constructor arguments, which `BetterAuthPlugin` does not type. */
function pluginOptions(id: string): unknown {
  const plugin = options.plugins?.find((candidate) => candidate.id === id)
  if (!plugin) throw new Error(`plugin ${id} is not configured`)
  return 'options' in plugin ? plugin.options : undefined
}

describe('session and verification storage', () => {
  it('has no cookieCache: a ban or a sign-out-everywhere must be visible at once (ADR 0011)', () => {
    expect(options.session).toBeDefined()
    expect('cookieCache' in (options.session ?? {})).toBe(false)
  })

  it('stores verification rows in the database: a reset link must survive a KV miss', () => {
    expect(options.verification?.storeInDatabase).toBe(true)
  })

  it('has secondary storage: sessions and rate-limit counters live in KV', () => {
    expect(options.secondaryStorage).toBeDefined()
  })

  it('writes secondary storage to SESSIONS, never the general KV cache: a cache purge must not sign everyone out (ADR 0011)', async () => {
    await options.secondaryStorage!.set('session-token', 'payload', 120)

    expect(stores.sessionPuts).toEqual([
      { key: 'session-token', value: 'payload' },
    ])
  })
})

describe('the disabled console paths', () => {
  it('are top level and equal both constants: the admin plugin does not read them from its own options', () => {
    expect(options.disabledPaths).toEqual([
      ...DISABLED_ADMIN_PATHS,
      ...DISABLED_ORGANIZATION_PATHS,
    ])
    expect(pluginOptions('admin')).not.toHaveProperty('disabledPaths')
  })

  it('keep organization creation enabled: plan stage 26-S1 creates workspaces in-process', () => {
    expect(pluginOptions('organization')).toMatchObject({
      allowUserToCreateOrganization: true,
    })
  })
})

describe('the admin plugin', () => {
  it('receives adminOptions: the role grid, adminRoles and defaultRole, not the plugin defaults', () => {
    expect(pluginOptions('admin')).toMatchObject({
      ac: adminOptions.ac,
      roles: adminOptions.roles,
      adminRoles: adminOptions.adminRoles,
      defaultRole: adminOptions.defaultRole,
    })
  })
})

describe('plugin order', () => {
  it('puts admin first, then two-factor and organization: later plugins read what admin adds', () => {
    expect(options.plugins?.map((plugin) => plugin.id)).toEqual([
      'admin',
      'two-factor',
      'organization',
    ])
  })
})

describe('the rate limiter', () => {
  it('counts in secondary storage, because an isolate’s memory is not shared between colos', () => {
    expect(options.rateLimit?.enabled).toBe(true)
    expect(options.rateLimit?.storage).toBe('secondary-storage')
  })

  it('carries exactly the seven custom rules, the four ADR 0011 credential paths among them', () => {
    // A literal table on purpose: adding, removing or retuning a rule is then a visible diff here.
    expect(options.rateLimit?.customRules).toEqual({
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 300, max: 5 },
      '/request-password-reset': { window: 300, max: 5 },
      '/reset-password': { window: 300, max: 10 },
      '/send-verification-email': { window: 300, max: 5 },
      '/two-factor/verify-totp': { window: 60, max: 10 },
      '/two-factor/verify-backup-code': { window: 300, max: 5 },
    })
  })
})

describe('advanced', () => {
  it('prefixes cookies with mtr, so they do not collide with another app on the host', () => {
    expect(options.advanced?.cookiePrefix).toBe('mtr')
  })

  it('generates 24-character ids, the shape of every other id in the schema', () => {
    const generateId = options.advanced?.database?.generateId
    if (typeof generateId !== 'function') {
      throw new Error('advanced.database.generateId is not a function')
    }
    const id = generateId({ model: 'user' })
    expect(typeof id).toBe('string')
    expect(id).toHaveLength(24)
  })
})

describe('the provisioning hooks', () => {
  const NOW = new Date('2026-04-01T09:00:00.000Z')

  function userRecord(id: string, email: string) {
    return {
      id,
      email,
      name: 'Anna',
      emailVerified: false,
      createdAt: NOW,
      updatedAt: NOW,
    }
  }

  function sessionRecord(userId: string) {
    return {
      id: `session-${userId}`,
      token: `token-${userId}`,
      userId,
      expiresAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    }
  }

  const afterUserCreated = () =>
    present(
      options.databaseHooks?.user?.create?.after,
      'databaseHooks.user.create.after',
    )

  const beforeSessionCreated = () =>
    present(
      options.databaseHooks?.session?.create?.before,
      'databaseHooks.session.create.before',
    )

  async function membershipsOf(userId: string) {
    const owned = await db.select().from(member)
    return owned.filter((row) => row.userId === userId)
  }

  it('user.create.after gives the new account one workspace and one owner membership', async () => {
    await seedUser(db, { id: 'u1', email: 'anna@example.test', name: 'Anna' })

    await afterUserCreated()(userRecord('u1', 'anna@example.test'), null)

    expect(await db.select().from(organization)).toHaveLength(1)
    const memberships = await membershipsOf('u1')
    expect(memberships).toHaveLength(1)
    expect(memberships[0]?.role).toBe('owner')
  })

  it('session.create.before pins the session to that user’s workspace', async () => {
    await seedUser(db, { id: 'u1', email: 'anna@example.test', name: 'Anna' })

    const result = await beforeSessionCreated()(sessionRecord('u1'), null)

    const [membership] = await membershipsOf('u1')
    expect(result).toMatchObject({
      data: { activeOrganizationId: membership?.organizationId },
    })
    expect(await db.select().from(organization)).toHaveLength(1)
  })

  it('running both hooks for one user leaves one workspace', async () => {
    await seedUser(db, { id: 'u1', email: 'anna@example.test', name: 'Anna' })

    await afterUserCreated()(userRecord('u1', 'anna@example.test'), null)
    await beforeSessionCreated()(sessionRecord('u1'), null)

    expect(await db.select().from(organization)).toHaveLength(1)
    expect(await membershipsOf('u1')).toHaveLength(1)
  })

  it('session.create.before returns nothing for a user that no longer exists', async () => {
    const result = await beforeSessionCreated()(sessionRecord('ghost'), null)

    expect(result).toBeUndefined()
    expect(await db.select().from(organization)).toHaveLength(0)
  })
})
