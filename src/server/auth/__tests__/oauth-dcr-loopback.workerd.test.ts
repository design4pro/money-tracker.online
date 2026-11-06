/**
 * A public MCP client that omits `application_type` must still register a
 * loopback `http` redirect. `@better-auth/oauth-provider` defaults that field
 * to `web`, and a web client cannot use `http` or loopback. `infer` classifies
 * exact `localhost`, `127.0.0.1`, and `[::1]` redirects as `native` and leaves
 * every other host on the web rules, so `http` stays illegal off loopback.
 *
 * Synthetic client names only. No session, no production row.
 */

import { betterAuth } from 'better-auth'
import { describe, expect, it, vi } from 'vitest'

import { appUrl } from '../env'
import { authOptions } from '../config'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ handler: (run: unknown) => run }),
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeader: () => undefined,
}))

describe('dynamic client registration without application_type', () => {
  it.each([
    ['http://localhost:8787/callback', 'native'],
    ['http://127.0.0.1:3011/callback', 'native'],
    ['http://[::1]:9/callback', 'native'],
    ['https://app.example.test/callback', 'web'],
  ] as const)('registers %s as %s', async (redirectUri, applicationType) => {
    const outcome = await register({ redirectUris: [redirectUri] })

    expect(outcome.status, JSON.stringify(outcome.body)).toBe(201)
    expect(outcome.body).toMatchObject({
      application_type: applicationType,
      token_endpoint_auth_method: 'none',
    })
    expect(clientIdOf(outcome.body)).toEqual(expect.any(String))
    expect(outcome.body).not.toHaveProperty('client_secret')
  })

  it('rejects http on a host that is not an exact loopback', async () => {
    const outcome = await register({
      redirectUris: ['http://evil.example/callback'],
    })

    expectRejected(outcome)
  })

  it('rejects a loopback redirect paired with http on another host', async () => {
    const outcome = await register({
      redirectUris: [
        'http://localhost:8787/callback',
        'http://evil.example/callback',
      ],
    })

    expectRejected(outcome)
  })

  it('does not rewrite a client that sends application_type web', async () => {
    const outcome = await register({
      redirectUris: ['http://127.0.0.1:8787/callback'],
      applicationType: 'web',
    })

    expectRejected(outcome)
  })

  it('rejects https on localhost when application_type is omitted', async () => {
    const outcome = await register({
      redirectUris: ['https://localhost:8787/callback'],
    })

    expectRejected(outcome)
  })
})

function expectRejected(outcome: RegistrationOutcome): void {
  expect(outcome.status, JSON.stringify(outcome.body)).toBe(400)
  expect(JSON.stringify(outcome.body)).toContain('invalid_redirect_uri')
}

interface RegistrationOutcome {
  readonly status: number
  readonly body: unknown
}

async function register(input: {
  readonly redirectUris: ReadonlyArray<string>
  readonly applicationType?: 'web' | 'native'
}): Promise<RegistrationOutcome> {
  const auth = betterAuth(authOptions())
  const origin = appUrl()
  const body: Record<string, unknown> = {
    client_name: 'synthetic-public-client',
    redirect_uris: input.redirectUris,
    token_endpoint_auth_method: 'none',
  }
  if (input.applicationType !== undefined) {
    body.application_type = input.applicationType
  }

  const response = await auth.handler(
    new Request(`${origin}/api/auth/oauth2/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
        // `/oauth2/register` allows 5 requests per address per minute.
        'cf-connecting-ip': syntheticIp(
          `${input.redirectUris.join('|')}:${input.applicationType ?? ''}`,
        ),
      },
      body: JSON.stringify(body),
    }),
  )

  return { status: response.status, body: await readBody(response) }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** Documentation-range address, stable for one registration and distinct across cases. */
function syntheticIp(seed: string): string {
  let hash = 0
  for (const char of seed) hash = (hash * 33 + char.charCodeAt(0)) >>> 0
  return `203.0.113.${(hash % 250) + 1}`
}

function clientIdOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('client_id' in body)) {
    return null
  }
  const clientId = body.client_id
  return typeof clientId === 'string' ? clientId : null
}
