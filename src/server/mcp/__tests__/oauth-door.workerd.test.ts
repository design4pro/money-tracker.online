/**
 * An oauth-provider access token opens `/api/mcp` without a network JWKS fetch.
 *
 * Synthetic user, client, and grant only. The password is a fixture, not a credential.
 */

import { betterAuth } from 'better-auth'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { authOptions } from '#/server/auth/config'
import { getDb } from '#/server/auth/db'
import { appUrl } from '#/server/auth/env'
import { member, user } from '#/server/db/auth-schema'
import { newId } from '#/server/db/ids'
import { subscriptions } from '#/server/db/schema'
import { createOauthGrant } from '#/server/repos/agent-grants'
import { createScope, isOrganizationRole } from '#/server/repos/scope'

import { handleMcpRequest } from '../handler'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ handler: (run: unknown) => run }),
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeader: () => undefined,
  getRequest: () => new Request('https://example.test/'),
}))

const PASSWORD = 'a-long-enough-test-password'

describe('oauth access at the MCP door', () => {
  it('lists the grant tools without fetching JWKS over the network', async () => {
    const issued = await issueAccessToken()
    expect(issued.accessToken.split('.').length).toBe(3)

    const db = getDb()
    const membership = await db
      .select({
        userId: member.userId,
        organizationId: member.organizationId,
        role: member.role,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(user.email, issued.email))
      .get()
    expect(membership).toBeDefined()
    expect(isOrganizationRole(membership?.role)).toBe(true)
    if (!membership || !isOrganizationRole(membership.role)) {
      throw new Error('signup did not create a workspace role')
    }

    const scope = createScope(db, membership)
    const now = new Date()
    await db.insert(subscriptions).values({
      id: newId(),
      organizationId: membership.organizationId,
      plan: 'plus',
      status: 'active',
      providerCustomerId: 'cus_synthetic',
      providerSubscriptionId: newId(),
      seats: 1,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    })
    await createOauthGrant(
      scope,
      {
        name: 'Synthetic reader',
        clientId: issued.clientId,
        scopes: ['accounts:read'],
      },
      now,
    )

    const fetches: Array<string> = []
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      fetches.push(new URL(url).pathname)
      return original(input, init)
    }
    try {
      const response = await handleMcpRequest(
        new Request(`${appUrl()}/api/mcp`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${issued.accessToken}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {},
          }),
        }),
      )
      const body = await rpcBody(response)
      expect(response.status, JSON.stringify(body)).toBe(200)
      expect(toolNames(body).toSorted()).toEqual([
        'get_balances',
        'list_accounts',
      ])
      expect(fetches.filter((path) => path.includes('jwks'))).toEqual([])
    } finally {
      globalThis.fetch = original
    }
  }, 30_000)
})

async function issueAccessToken(): Promise<{
  email: string
  clientId: string
  accessToken: string
}> {
  const auth = betterAuth(authOptions())
  const origin = appUrl()
  const redirectUri = 'http://127.0.0.1:3010/oauth/callback'
  const resource = `${origin}/api/mcp`
  const email = `mcp-oauth-${crypto.randomUUID()}@example.test`
  const { verifier, challenge } = await pkce()

  const signedUp = await auth.handler(
    new Request(`${origin}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({
        name: 'Synthetic MCP',
        email,
        password: PASSWORD,
      }),
    }),
  )
  expect(signedUp.status).toBe(200)
  const cookie = cookieHeader(signedUp)

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
  const registration = await readJson(registered)
  const clientId = stringField(registration, 'client_id')
  expect(clientId).toEqual(expect.any(String))

  const authorizeUrl = new URL(`${origin}/api/auth/oauth2/authorize`)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', clientId!)
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
  const authorizeTarget = redirectTarget(authorize, await readJson(authorize))
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
  const code = new URL(
    redirectTarget(consent, await readJson(consent))!,
    origin,
  ).searchParams.get('code')
  expect(code).toEqual(expect.any(String))

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
        code: code!,
        redirect_uri: redirectUri,
        client_id: clientId!,
        code_verifier: verifier,
        resource,
      }),
    }),
  )
  const tokenBody = await readJson(token)
  const accessToken = stringField(tokenBody, 'access_token')
  expect(token.status, 'token endpoint').toBe(200)
  expect(accessToken).toEqual(expect.any(String))
  return { email, clientId: clientId!, accessToken: accessToken! }
}

function toolNames(body: unknown): Array<string> {
  const result = rpcResult(body)
  if (typeof result !== 'object' || result === null || !('tools' in result)) {
    return []
  }
  const tools = result.tools
  if (!Array.isArray(tools)) return []
  return tools.flatMap((tool) => {
    if (typeof tool !== 'object' || tool === null || !('name' in tool)) {
      return []
    }
    return typeof tool.name === 'string' ? [tool.name] : []
  })
}

function rpcResult(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('result' in body)) {
    return null
  }
  return body.result
}

async function rpcBody(response: Response): Promise<unknown> {
  const text = await response.text()
  const dataLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('data:'))
  const json = dataLine ? dataLine.slice('data:'.length).trim() : text
  try {
    return JSON.parse(json) as unknown
  } catch {
    return { unparsed: text.slice(0, 500) }
  }
}

function stringField(body: unknown, key: string): string | null {
  if (typeof body !== 'object' || body === null || !(key in body)) return null
  const value = (body as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
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

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text.slice(0, 200)
  }
}

function redirectTarget(response: Response, body: unknown): string | null {
  const location = response.headers.get('location')
  if (location) return location
  return stringField(body, 'url')
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
