/**
 * The create-organization route, driven through Better Auth's real handler.
 *
 * `allowUserToCreateOrganization` stays on so a session-carrying in-process call (plan stage 26-S1)
 * can create a workspace, but nothing in the product posts to `/api/auth/organization/create`, and
 * left open it lets a signed-in user mint unlimited owner-role organizations with no base currency.
 * `disabledPaths` is the instrument: it answers the HTTP request with a bare 404 before the endpoint
 * is entered and leaves `auth.api.*` untouched. Only the real router can show that, so the instance
 * is built from `authOptions()` over a real SQLite and a Map-backed KV.
 *
 * **Mocks.** The same two as `config.test.ts`: `cloudflare:workers` carries the few bindings the
 * options read (`SESSIONS` is a fake KV here, because sign-in writes sessions to it), and `../db`
 * hands back the test database.
 */

import { betterAuth } from 'better-auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { member, organization } from '#/server/db/auth-schema'

import { authOptions } from '../config'
import { resolveOrProvisionOrganization } from '../organization'
import { openAuthTestDb } from './harness'

import type { AppDatabase } from '../db'

const current = vi.hoisted(() => ({
  db: undefined as unknown,
  kv: undefined as unknown,
}))

vi.mock('cloudflare:workers', () => ({
  env: {
    get SESSIONS() {
      return current.kv
    },
    BETTER_AUTH_SECRET: 'test-only-secret-that-is-not-a-real-deployment-value',
    APP_URL: 'https://app.example.test',
    EMAIL_API_KEY: '',
  },
}))

vi.mock('../db', () => ({ getDb: () => current.db }))

const ORIGIN = 'https://app.example.test'

/** Only the four methods the secondary-storage adapter calls. */
class FakeKv {
  readonly store = new Map<string, string>()

  async get(key: string, type: 'text' | 'json'): Promise<unknown> {
    const stored = this.store.get(key)
    if (stored === undefined) return null
    return type === 'json' ? JSON.parse(stored) : stored
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
}

/**
 * The one plugin endpoint called in-process. `authOptions()` is typed as `BetterAuthOptions`, so the
 * instance's `api` carries no plugin endpoints in its type and this names the one the test uses.
 */
interface OrganizationApi {
  createOrganization: (input: {
    headers: Headers
    body: { name: string; slug: string }
  }) => Promise<{ slug: string }>
}

let db: AppDatabase
let auth: ReturnType<typeof betterAuth>

/** A request the way the browser sends it: same origin, JSON body, optional session cookie. */
function post(path: string, body: unknown, cookie?: string): Request {
  return new Request(`${ORIGIN}/api/auth${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

/** Signs a user up through the handler and returns the session cookie it set. */
async function signUp(email: string): Promise<string> {
  const response = await auth.handler(
    post('/sign-up/email', {
      name: 'Ada Lovelace',
      email,
      password: 'correct horse battery staple',
    }),
  )
  expect(response.status).toBe(200)
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

beforeEach(() => {
  db = openAuthTestDb()
  current.db = db
  current.kv = new FakeKv()
  auth = betterAuth(authOptions())
})

describe('POST /api/auth/organization/create', () => {
  it('answers a signed-in user with a bare 404 and creates nothing', async () => {
    const cookie = await signUp('ada@example.test')
    const organizationsBefore = await db.select().from(organization)
    const membersBefore = await db.select().from(member)

    const response = await auth.handler(
      post(
        '/organization/create',
        { name: 'Second workspace', slug: 'second-workspace' },
        cookie,
      ),
    )

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not Found')
    expect(await db.select().from(organization)).toEqual(organizationsBefore)
    expect(await db.select().from(member)).toEqual(membersBefore)
  })

  // Without the fix the router already answers a trailing slash with a body-less 404, so the body
  // text is what tells the `disabledPaths` answer ("Not Found") from the router's. The dot-segment
  // spelling reaches the endpoint when the path is open.
  it.each(['/organization/create/', '/organization/./create'])(
    'is closed as %s too',
    async (path) => {
      const cookie = await signUp('katherine@example.test')

      const response = await auth.handler(
        post(path, { name: 'Extra', slug: 'extra' }, cookie),
      )

      expect(response.status).toBe(404)
      expect(await response.text()).toBe('Not Found')
      expect(await db.select().from(organization)).toHaveLength(1)
    },
  )

  it('stays usable in-process: auth.api bypasses the router, which is what 26-S1 relies on', async () => {
    const cookie = await signUp('margaret@example.test')

    const created = await (
      auth.api as unknown as OrganizationApi
    ).createOrganization({
      headers: new Headers({ cookie }),
      body: { name: 'In process', slug: 'in-process' },
    })

    expect(created).toMatchObject({ slug: 'in-process' })
    expect(await db.select().from(organization)).toHaveLength(2)
  })

  it('leaves the personal workspace provisioned, and provisioning idempotent', async () => {
    const cookie = await signUp('grace@example.test')
    await auth.handler(
      post('/organization/create', { name: 'Extra', slug: 'extra' }, cookie),
    )

    const organizations = await db.select().from(organization)
    const members = await db.select().from(member)
    expect(organizations).toHaveLength(1)
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({ role: 'owner' })

    const [personal] = organizations
    expect(await resolveOrProvisionOrganization(db, members[0]!.userId)).toBe(
      personal!.id,
    )
    expect(await db.select().from(organization)).toHaveLength(1)
  })
})
