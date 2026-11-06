/**
 * Resolve a presented bearer credential to a grant, then a live TenantScope.
 *
 * PAT secrets are hashed and looked up first (they never go through JWKS).
 * OAuth access tokens arrive already verified; this module only maps claims to
 * a grant row. Membership is re-read. The paid-plan gate is FeatureLockedError.
 */

import { membershipRoleFor } from '#/server/auth/organization'
import { resolveLimits } from '#/server/billing/resolve-limits'
import {
  findOauthGrantByClient,
  findPatGrantByTokenHash,
} from '#/server/repos/agent-grants'
import { FeatureLockedError } from '#/server/repos/errors'
import { createScope, isOrganizationRole } from '#/server/repos/scope'

import { MCP_ORGANIZATION_CLAIM } from './organization-claim'

import type { AppDatabase } from '#/server/auth/db'
import type { AgentGrantRow } from '#/server/db/schema'
import type { Database, TenantScope } from '#/server/repos/base'

/** The claims `requireMcpAuth` forwards after JWKS verification. */
export interface OauthAccessClaims {
  readonly sub?: unknown
  readonly azp?: unknown
  readonly client_id?: unknown
  readonly org_id?: unknown
}

const PAT_SECRET = /^mto_(stg|live)_[a-z0-9]+\.[A-Za-z0-9_-]+$/

export interface McpGrantContext {
  readonly grant: AgentGrantRow
  readonly scope: TenantScope
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header === null) return null
  const match = /^Bearer\s+(\S+)/i.exec(header.trim())
  return match?.[1] ?? null
}

export function isPatSecret(token: string): boolean {
  return PAT_SECRET.test(token)
}

export function oauthClientIdFromClaims(
  claims: OauthAccessClaims,
): string | null {
  const azp = claims.azp
  const clientId = claims.client_id
  if (typeof azp === 'string' && azp.length > 0) return azp
  if (typeof clientId === 'string' && clientId.length > 0) return clientId
  return null
}

/** Workspace bound into the access token, or null when the claim is absent. */
export function organizationIdFromClaims(
  claims: OauthAccessClaims,
): string | null {
  const value = claims[MCP_ORGANIZATION_CLAIM]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 64) return null
  return trimmed
}

export async function resolvePatGrant(
  db: Database,
  secret: string,
): Promise<AgentGrantRow | null> {
  return findPatGrantByTokenHash(db, secret)
}

export async function resolveOauthGrant(
  db: Database,
  claims: OauthAccessClaims,
): Promise<AgentGrantRow | null> {
  const userId = typeof claims.sub === 'string' ? claims.sub : null
  const clientId = oauthClientIdFromClaims(claims)
  if (!userId || !clientId) return null
  return findOauthGrantByClient(db, {
    userId,
    clientId,
    organizationId: organizationIdFromClaims(claims),
  })
}

/**
 * Re-read membership, build TenantScope, refuse a free plan.
 *
 * A missing or unrecognised role is the same as "not a member": the grant
 * cannot mint a scope, so the caller is unauthenticated at this door.
 */
export async function scopeForGrant(
  db: Database,
  grant: AgentGrantRow,
): Promise<TenantScope> {
  const role = await membershipRoleFor(db as AppDatabase, {
    userId: grant.userId,
    organizationId: grant.organizationId,
  })
  if (!isOrganizationRole(role)) {
    throw new McpGrantNotUsableError('not-a-member')
  }
  const scope = createScope(db, {
    userId: grant.userId,
    organizationId: grant.organizationId,
    role,
  })
  const limits = await resolveLimits(scope)
  if (!limits.features.mcp) {
    throw new FeatureLockedError('mcp')
  }
  return scope
}

export class McpGrantNotUsableError extends Error {
  readonly reason: 'not-a-member'

  constructor(reason: 'not-a-member') {
    super('The grant cannot be used')
    this.reason = reason
  }
}
