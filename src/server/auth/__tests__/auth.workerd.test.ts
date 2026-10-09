/**
 * Does a real sign-up work, end to end, in workerd?
 *
 * `config.test.ts` pins the option values and `organization.test.ts` drives the provisioning hooks
 * against SQLite, and neither can say that the pieces fit: that Better Auth accepts the options,
 * that D1 accepts the SQL its adapter and `provisionPersonalWorkspace` generate, and that a session
 * really lands in the `SESSIONS` namespace. This test builds `betterAuth(authOptions())` - the same
 * options `./index` uses - and signs somebody up through its handler, on the `DB` and `SESSIONS`
 * bindings and the migrations `vitest.setup.workerd.ts` applied. It replaces the plan's manual
 * `wrangler dev` sign-up.
 *
 * It imports `../config` and never `../index`: `index` reaches `getRequest` from
 * `@tanstack/react-start/server`, which means nothing in workerd. The fake `BETTER_AUTH_SECRET` and
 * the empty `EMAIL_API_KEY` come from the project's `miniflare.bindings` in `vitest.config.ts`.
 */

import { env } from 'cloudflare:workers'
import { betterAuth } from 'better-auth'
import { describe, expect, it, vi } from 'vitest'

import { appUrl } from '../env'
import { authOptions } from '../config'

/**
 * `../config` reaches `fns/locale`, which builds a server function at import. Nothing here calls
 * it - the email hooks use `negotiateEmailLocale` - so a builder that returns its handler is enough.
 */
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ handler: (run: unknown) => run }),
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeader: () => undefined,
}))

const EMAIL = 'sign-up-in-workerd@example.test'

describe('email sign-up through Better Auth in workerd', () => {
  it('creates the user, a session in KV and exactly one provisioned workspace', async () => {
    const auth = betterAuth(authOptions())

    const response = await auth.handler(
      new Request(`${appUrl()}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: appUrl(),
        },
        body: JSON.stringify({
          name: 'Workerd Signup',
          email: EMAIL,
          password: 'a-long-enough-test-password',
        }),
      }),
    )
    expect(response.status).toBe(200)

    const created = await env.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind(EMAIL)
      .all<{ id: string }>()
    expect(created.results).toHaveLength(1)
    const userId = created.results[0]!.id
    expect(userId).toHaveLength(24)

    // The rate limiter writes to this namespace too, so look for the session's own index key.
    expect(await env.SESSIONS.get(`active-sessions-${userId}`)).not.toBeNull()

    const workspaces = await env.DB.prepare(
      `SELECT m.organization_id AS organizationId, m.role AS role
         FROM member m JOIN organization o ON o.id = m.organization_id
        WHERE m.user_id = ?`,
    )
      .bind(userId)
      .all<{ organizationId: string; role: string }>()
    expect(workspaces.results).toHaveLength(1)
    expect(workspaces.results[0]!.role).toBe('owner')

    const organizationId = workspaces.results[0]!.organizationId
    const baseCurrencies = await env.DB.prepare(
      'SELECT currency_code FROM organization_currencies WHERE organization_id = ? AND is_base = 1',
    )
      .bind(organizationId)
      .all()
    expect(baseCurrencies.results).toHaveLength(1)
  })
})
