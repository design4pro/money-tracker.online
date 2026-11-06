/**
 * Streamable HTTP MCP at `/api/mcp`.
 *
 * `createMcpHandler` from `agents/mcp/server` (ADR 0037). Phase 4 registers
 * the grant's read, write and delete tools. Auth is PAT hash lookup or an
 * in-process JWT check (local JWKS and the issuer on the token), then a grant
 * row. No Durable Object. A missing bearer still uses `requireMcpAuth` for
 * the 401 challenge.
 */

import { requireMcpAuth } from '@better-auth/mcp'
import {
  createDpopReplayStore,
  enforceDpopBinding,
  isDpopBindingError,
  parseAccessTokenAuthorization,
  requestToResourceInput,
  verifyJwsAccessToken,
} from 'better-auth/oauth2'
import { McpServer } from '@modelcontextprotocol/server'
import { createMcpHandler } from 'agents/mcp/server'

import { getAuth } from '#/server/auth'
import { getDb } from '#/server/auth/db'
import { sessionStore } from '#/server/auth/env'
import { FeatureLockedError } from '#/server/repos/errors'

import {
  McpGrantNotUsableError,
  bearerToken,
  isPatSecret,
  resolveOauthGrant,
  resolvePatGrant,
  scopeForGrant,
} from './authenticate'
import {
  MCP_ROUTE,
  jwksUrl,
  mcpAccessTokenIssuer,
  mcpResourceMetadataUrl,
  mcpResourceUrl,
} from './resource'
import { registerMcpTools, toolContextForGrant } from './tools'

import type { OauthAccessClaims } from './authenticate'
import type { AgentGrantRow } from '#/server/db/schema'
import type { AppDatabase } from '#/server/auth/db'

function jsonRpcUnauthorized(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Unauthorized' },
      id: null,
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': `Bearer realm="mcp", resource_metadata="${mcpResourceMetadataUrl()}"`,
      },
    },
  )
}

function jsonRpcFeatureLocked(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Feature locked' },
      id: null,
    }),
    {
      status: 403,
      headers: { 'content-type': 'application/json' },
    },
  )
}

function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
      'access-control-allow-headers':
        'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id',
    },
  })
}

async function afterGrant(
  db: AppDatabase,
  request: Request,
  grant: AgentGrantRow,
): Promise<Response> {
  try {
    const scope = await scopeForGrant(db, grant)
    const ctx = toolContextForGrant(grant, scope, sessionStore())
    const handler = createMcpHandler(
      () => {
        const server = new McpServer({
          name: 'money-tracker.online',
          version: 'phase-4',
        })
        registerMcpTools(server, ctx)
        return server
      },
      {
        route: MCP_ROUTE,
        allowedOriginHostnames: '*',
      },
    )
    return handler.fetch(request)
  } catch (error) {
    if (error instanceof FeatureLockedError) return jsonRpcFeatureLocked()
    if (error instanceof McpGrantNotUsableError) return jsonRpcUnauthorized()
    throw error
  }
}

async function handleOauth(
  request: Request,
  claims: OauthAccessClaims,
): Promise<Response> {
  const db = getDb()
  const grant = await resolveOauthGrant(db, claims)
  if (!grant) return jsonRpcUnauthorized()
  return afterGrant(db, request, grant)
}

/**
 * Cookie-free MCP door. OPTIONS is a CORS preflight; every other verb authenticates.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight()

  const token = bearerToken(request)
  if (token !== null && isPatSecret(token)) {
    const db = getDb()
    const grant = await resolvePatGrant(db, token)
    if (!grant) return jsonRpcUnauthorized()
    return afterGrant(db, request, grant)
  }

  if (token === null) {
    return requireMcpAuth(getAuth(), handleOauth, {
      resource: mcpResourceUrl(),
      issuer: mcpAccessTokenIssuer(),
    })(request)
  }

  return handleVerifiedOauth(request)
}

/**
 * Stable cache identity for {@link readLocalJwks}. A fresh closure cannot be
 * the cache key: the verifier only remembers a function source under an object
 * the caller keeps.
 */
const localJwksCacheKey: object = {}

const JWKS_INFRASTRUCTURE_CODES = new Set([
  'ERR_JWKS_TIMEOUT',
  'ERR_JWKS_INVALID',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
])

/**
 * Verify a non-PAT bearer in-process.
 *
 * `requireMcpAuth` can only be given a JWKS URL, and that URL is fetched with
 * the Worker `fetch`. A fetch to this zone does not return, and the resulting
 * `Jwks failed` error is not a JOSE error, so the door answers 500. The key
 * set is served by `getAuth().handler` from D1. The issuer is the one on the
 * token, not the bare origin.
 */
async function handleVerifiedOauth(request: Request): Promise<Response> {
  const input = requestToResourceInput(request)
  const authorization = parseAccessTokenAuthorization(input.authorizationHeader)
  if (!authorization?.token || authorization.scheme === 'Unknown') {
    return jsonRpcUnauthorized()
  }

  try {
    const claims = await verifyJwsAccessToken(authorization.token, {
      jwksFetch: readLocalJwks,
      jwksCacheKey: localJwksCacheKey,
      verifyOptions: {
        issuer: mcpAccessTokenIssuer(),
        audience: mcpResourceUrl(),
        requiredClaims: ['azp'],
      },
    })
    const { internalAdapter } = await getAuth().$context
    await enforceDpopBinding({
      payload: claims,
      authorization,
      proofJwt: input.dpopProofJwt,
      method: input.method,
      url: input.url,
      replayStore: createDpopReplayStore(internalAdapter),
    })
    return handleOauth(request, claims)
  } catch (error) {
    if (isPresentedTokenRejected(error)) return jsonRpcUnauthorized()
    throw error
  }
}

async function readLocalJwks(): Promise<{ keys: Array<{ kty?: string }> }> {
  const response = await getAuth().handler(
    new Request(jwksUrl(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    }),
  )
  if (!response.ok) {
    throw new Error('The MCP JWKS document was not available')
  }
  const body: unknown = await response.json()
  if (!isKeySet(body)) {
    throw new Error('The MCP JWKS document was not a key set')
  }
  return body
}

function isKeySet(value: unknown): value is { keys: Array<{ kty?: string }> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'keys' in value &&
    Array.isArray(value.keys)
  )
}

function isPresentedTokenRejected(error: unknown): boolean {
  if (isDpopBindingError(error)) return true
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false
  }
  const code = error.code
  return (
    typeof code === 'string' &&
    code.startsWith('ERR_') &&
    !JWKS_INFRASTRUCTURE_CODES.has(code)
  )
}
