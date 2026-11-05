/**
 * Streamable HTTP MCP at `/api/mcp`.
 *
 * `createMcpHandler` from `agents/mcp/server` (ADR 0037). Phase 4 registers
 * the grant's read, write and delete tools. Auth is PAT hash lookup or Better
 * Auth `requireMcpAuth` (JWT), then a grant row. No Durable Object.
 */

import { requireMcpAuth } from '@better-auth/mcp'
import { McpServer } from '@modelcontextprotocol/server'
import { createMcpHandler } from 'agents/mcp/server'

import { getAuth } from '#/server/auth'
import { getDb } from '#/server/auth/db'
import { appUrl, sessionStore } from '#/server/auth/env'
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

  return requireMcpAuth(getAuth(), handleOauth, {
    resource: mcpResourceUrl(),
    issuer: appUrl(),
    jwksUrl: jwksUrl(),
  })(request)
}
