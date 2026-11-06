/**
 * A session that lives only in KV must not finish an OAuth grant with
 * `400 invalid_request` / "session no longer exists".
 *
 * Authorize and consent read the session through `findSession`, which answers
 * from KV. The token endpoint's authorization-code grant loads that session
 * with `adapter.findOne` on D1. Sessions written before `storeSessionInDatabase`
 * have no row. Those requests are sent to sign in again. A session that already
 * has a D1 row still finishes at a token. Neither path reports that the
 * session disappeared between consent and the token call.
 *
 * Synthetic users only. The password is a test fixture, not a credential.
 */

import { env } from 'cloudflare:workers'
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

const PASSWORD = 'a-long-enough-test-password'

interface GrantOutcome {
  readonly kind: 'login' | 'token' | 'error' | 'stuck'
  readonly detail: unknown
}

describe('OAuth authorization code with a KV session', () => {
  it('sends a KV-only authorize request to login and does not keep the session', async () => {
    const outcome = await runGrant({
      dropDatabaseSession: true,
      entry: 'authorize',
    })

    expect(outcome.kind, summary(outcome)).toBe('login')
    expect(JSON.stringify(outcome.detail)).not.toContain(
      'session no longer exists',
    )
    expect(outcome.detail).toMatchObject({ sessionRows: 0, kvPresent: false })
  })

  it('sends a KV-only consent POST to login instead of failing the grant', async () => {
    const outcome = await runGrant({
      dropDatabaseSession: true,
      entry: 'consent',
    })

    expect(outcome.kind, summary(outcome)).toBe('login')
    expect(JSON.stringify(outcome.detail)).not.toContain(
      'session no longer exists',
    )
    expect(outcome.detail).toMatchObject({ sessionRows: 0, kvPresent: false })
  })

  it('completes the grant when the session row is already in D1', async () => {
    const outcome = await runGrant({
      dropDatabaseSession: false,
      entry: 'authorize',
    })

    expect(outcome.kind, summary(outcome)).toBe('token')
    expect(JSON.stringify(outcome.detail)).not.toContain(
      'session no longer exists',
    )
  })
})

function summary(outcome: GrantOutcome): string {
  return JSON.stringify(outcome.detail)
}

async function runGrant(input: {
  readonly dropDatabaseSession: boolean
  readonly entry: 'authorize' | 'consent'
}): Promise<GrantOutcome> {
  const auth = betterAuth(authOptions())
  const origin = appUrl()
  // `localhost` is not a loopback host for this provider's web-client check.
  // 127.0.0.1 is, so the redirect URI can stay http in the test.
  const redirectUri = 'http://127.0.0.1:3010/oauth/callback'
  const resource = `${origin}/api/mcp`
  const email = `oauth-${crypto.randomUUID()}@example.test`
  const { verifier, challenge } = await pkce()

  const signedUp = await auth.handler(
    new Request(`${origin}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
      },
      body: JSON.stringify({
        name: 'Synthetic OAuth',
        email,
        password: PASSWORD,
      }),
    }),
  )
  const signedUpBody = await readBody(signedUp)
  if (signedUp.status !== 200) {
    return {
      kind: 'stuck',
      detail: { step: 'sign-up', status: signedUp.status, body: signedUpBody },
    }
  }
  const cookie = cookieHeader(signedUp)
  const userId = await userIdFor(email)
  const sessionToken = await sessionTokenFor(userId)
  const before = await sessionRowCount(userId)
  if (before !== 1) {
    return {
      kind: 'stuck',
      detail: {
        step: 'sign-up-session',
        sessionRows: before,
        kvPresent: sessionToken !== null,
      },
    }
  }
  if (input.dropDatabaseSession) {
    await env.DB.prepare('DELETE FROM session WHERE user_id = ?')
      .bind(userId)
      .run()
  }

  const registered = await auth.handler(
    new Request(`${origin}/api/auth/oauth2/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({
        client_name: 'synthetic-public-client',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        application_type: 'native',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        scope: 'openid profile email',
      }),
    }),
  )
  const registration = await readBody(registered)
  const clientId = clientIdOf(registration)
  if (!registered.ok || clientId === null) {
    return {
      kind: 'stuck',
      detail: {
        step: 'register',
        status: registered.status,
        body: registration,
      },
    }
  }

  if (input.entry === 'consent') {
    const consentOnly = await auth.handler(
      new Request(`${origin}/api/auth/oauth2/consent`, {
        method: 'POST',
        headers: {
          cookie,
          origin,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ accept: true }),
      }),
    )
    const consentOnlyBody = await readBody(consentOnly)
    const consentOnlyTarget = redirectTarget(consentOnly, consentOnlyBody)
    if (classify(consentOnlyTarget) === 'login') {
      return {
        kind: 'login',
        detail: await settled(userId, sessionToken, consentOnlyBody),
      }
    }
    return {
      kind: 'stuck',
      detail: {
        step: 'consent',
        status: consentOnly.status,
        target: consentOnlyTarget,
        body: consentOnlyBody,
      },
    }
  }

  const authorizeUrl = new URL(`${origin}/api/auth/oauth2/authorize`)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', clientId)
  authorizeUrl.searchParams.set('redirect_uri', redirectUri)
  authorizeUrl.searchParams.set('scope', 'openid profile email')
  authorizeUrl.searchParams.set('state', 'synthetic-state')
  authorizeUrl.searchParams.set('code_challenge', challenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  authorizeUrl.searchParams.set('resource', resource)

  const authorize = await auth.handler(
    new Request(authorizeUrl, {
      headers: {
        cookie,
        accept: 'text/html',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-dest': 'document',
      },
    }),
  )
  const authorizeBody = await readBody(authorize)
  const authorizeTarget = redirectTarget(authorize, authorizeBody)
  if (classify(authorizeTarget) === 'login') {
    return {
      kind: 'login',
      detail: await settled(userId, sessionToken, authorizeBody),
    }
  }
  if (classify(authorizeTarget) !== 'consent') {
    return {
      kind: 'stuck',
      detail: {
        step: 'authorize',
        status: authorize.status,
        target: authorizeTarget,
        body: authorizeBody,
      },
    }
  }

  const oauthQuery = new URL(authorizeTarget!, origin).search.slice(1)
  const consent = await auth.handler(
    new Request(`${origin}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: {
        cookie,
        origin,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ accept: true, oauth_query: oauthQuery }),
    }),
  )
  const consentBody = await readBody(consent)
  const consentTarget = redirectTarget(consent, consentBody)
  if (classify(consentTarget) === 'login') {
    return {
      kind: 'login',
      detail: await settled(userId, sessionToken, consentBody),
    }
  }
  const code = codeOf(consentTarget)
  if (code === null) {
    return {
      kind: 'stuck',
      detail: {
        step: 'consent',
        status: consent.status,
        target: consentTarget,
        body: consentBody,
      },
    }
  }

  const token = await auth.handler(
    new Request(`${origin}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
        resource,
      }),
    }),
  )
  const tokenBody = await readBody(token)
  if (token.ok && hasAccessToken(tokenBody)) {
    return {
      kind: 'token',
      detail: {
        ...(await settled(userId, sessionToken, null)),
        token: 'issued',
      },
    }
  }
  return {
    kind: 'error',
    detail: { step: 'token', status: token.status, body: tokenBody },
  }
}

async function settled(
  userId: string,
  sessionToken: string | null,
  body: unknown,
): Promise<{ sessionRows: number; kvPresent: boolean; body: unknown }> {
  const kvSession =
    sessionToken === null ? null : await env.SESSIONS.get(sessionToken)
  return {
    sessionRows: await sessionRowCount(userId),
    kvPresent: kvSession !== null,
    body,
  }
}

async function userIdFor(email: string): Promise<string> {
  const row = await env.DB.prepare('SELECT id FROM user WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (!row) throw new Error(`no user for ${email}`)
  return row.id
}

async function sessionTokenFor(userId: string): Promise<string | null> {
  const raw = await env.SESSIONS.get(`active-sessions-${userId}`)
  if (raw === null) return null
  const list: unknown = JSON.parse(raw)
  if (!Array.isArray(list) || list.length === 0) return null
  const first: unknown = list[0]
  if (typeof first !== 'object' || first === null || !('token' in first))
    return null
  return typeof first.token === 'string' ? first.token : null
}

async function sessionRowCount(userId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM session WHERE user_id = ?',
  )
    .bind(userId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

function cookieHeader(response: Response): string {
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : []
  return cookies
    .map((entry) => entry.split(';')[0] ?? '')
    .filter(Boolean)
    .join('; ')
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

function redirectTarget(response: Response, body: unknown): string | null {
  const location = response.headers.get('location')
  if (location) return location
  if (typeof body === 'object' && body !== null && 'url' in body) {
    const url = body.url
    if (typeof url === 'string') return url
  }
  return null
}

function classify(
  target: string | null,
): 'login' | 'consent' | 'code' | 'other' {
  if (target === null) return 'other'
  const url = new URL(target, appUrl())
  if (url.searchParams.get('code')) return 'code'
  if (url.pathname === '/login') return 'login'
  if (url.pathname === '/consent') return 'consent'
  return 'other'
}

function codeOf(target: string | null): string | null {
  if (target === null) return null
  return new URL(target, appUrl()).searchParams.get('code')
}

function clientIdOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('client_id' in body))
    return null
  const clientId = body.client_id
  return typeof clientId === 'string' ? clientId : null
}

function hasAccessToken(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'access_token' in body &&
    typeof body.access_token === 'string' &&
    body.access_token.length > 0
  )
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const verifier = base64Url(bytes)
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  )
  return { verifier, challenge: base64Url(digest) }
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}
