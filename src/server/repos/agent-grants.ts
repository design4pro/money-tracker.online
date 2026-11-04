/**
 * Agent grants: one user, one workspace, a closed set of `resource:verb` scopes.
 *
 * Personal tokens are hashed (SHA-256) and shown once. OAuth rows are the same table with a
 * `client_id` and no secret. SQL for tenant rows goes through
 * {@link createTenantRepository}. The exceptions are {@link findPatGrantByTokenHash} and
 * {@link findOauthGrantByClient}: the tenant is the *result* of the lookup, so they take a
 * {@link Database} and match on the presented credential. They do not fork `tenantFilter`.
 */

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import {
  AGENT_PAT_ENVIRONMENTS,
  AGENT_RESOURCES,
  AGENT_VERBS,
} from '#/lib/enums'
import { newId } from '#/server/db/ids'
import { agentGrants } from '#/server/db/schema'

import { createTenantRepository, desc } from './base'
import { NotFoundError } from './errors'
import { assertRole } from './scope'

import type { AgentPatEnvironment, AgentResource, AgentVerb } from '#/lib/enums'
import type { AgentGrantRow } from '#/server/db/schema'
import type { Database, TenantScope } from './base'

export type AgentScope = `${AgentResource}:${AgentVerb}`

const AGENT_SCOPE_VALUES = AGENT_RESOURCES.flatMap((resource) =>
  AGENT_VERBS.map((verb) => `${resource}:${verb}` as AgentScope),
)
const AGENT_SCOPE_TUPLE = AGENT_SCOPE_VALUES as [
  AgentScope,
  ...Array<AgentScope>,
]

const grantAccess = createTenantRepository(agentGrants, 'agent grant')

const PAT_SECRET = /^mto_(stg|live)_[a-z0-9]+\.[A-Za-z0-9_-]+$/
const PUBLIC_PART_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const SECRET_PART_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-'

export const createPatGrantSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  scopes: z
    .array(z.enum(AGENT_SCOPE_TUPLE))
    .min(1)
    .max(AGENT_SCOPE_VALUES.length),
  environment: z.enum(AGENT_PAT_ENVIRONMENTS),
})
export type CreatePatGrantInput = z.infer<typeof createPatGrantSchema>

export const createOauthGrantSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  clientId: z.string().trim().min(1).max(256),
  scopes: z
    .array(z.enum(AGENT_SCOPE_TUPLE))
    .min(1)
    .max(AGENT_SCOPE_VALUES.length),
})
export type CreateOauthGrantInput = z.infer<typeof createOauthGrantSchema>

export const revokeGrantSchema = z.strictObject({
  grantId: z.string().trim().min(1).max(64),
})
export type RevokeGrantInput = z.infer<typeof revokeGrantSchema>

/** Public grant: never `token_hash`. */
export interface AgentGrantView {
  readonly id: string
  readonly userId: string
  readonly kind: AgentGrantRow['kind']
  readonly name: string
  readonly clientId: string | null
  readonly tokenPrefix: string | null
  readonly scopes: ReadonlyArray<AgentScope>
  readonly createdAt: Date
  readonly revokedAt: Date | null
  readonly lastUsedAt: Date | null
}

export interface MintedPat {
  readonly grant: AgentGrantView
  readonly secret: string
}

function uniqueSortedScopes(
  scopes: ReadonlyArray<AgentScope>,
): Array<AgentScope> {
  return [...new Set(scopes)].toSorted()
}

function parseStoredScopes(raw: string): Array<AgentScope> {
  const parsed: unknown = JSON.parse(raw)
  return z.array(z.enum(AGENT_SCOPE_TUPLE)).min(1).parse(parsed)
}

function toView(row: AgentGrantRow): AgentGrantView {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    name: row.name,
    clientId: row.clientId,
    tokenPrefix: row.tokenPrefix,
    scopes: parseStoredScopes(row.scopes),
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function hashesEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i]! ^ b[i]!
  }
  return diff === 0
}

function randomChars(alphabet: string, length: number): string {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length]!
  }
  return out
}

function mintSecret(environment: AgentPatEnvironment): {
  secret: string
  prefix: string
} {
  const publicPart = randomChars(PUBLIC_PART_ALPHABET, 8)
  const secretPart = randomChars(SECRET_PART_ALPHABET, 32)
  const secret = `mto_${environment}_${publicPart}.${secretPart}`
  return { secret, prefix: `mto_${environment}_${publicPart}.` }
}

/** Owner/admin: mint a PAT. The secret is in the return value and nowhere else. */
export async function createPatGrant(
  scope: TenantScope,
  input: CreatePatGrantInput,
  now: Date,
): Promise<MintedPat> {
  assertRole(scope, 'create an agent grant', 'admin')
  const parsed = createPatGrantSchema.parse(input)
  const scopes = uniqueSortedScopes(parsed.scopes)
  const { secret, prefix } = mintSecret(parsed.environment)
  const tokenHash = await sha256Hex(secret)
  const row = await grantAccess.insert(scope, {
    id: newId(),
    userId: scope.ctx.userId,
    kind: 'pat',
    name: parsed.name,
    clientId: null,
    tokenHash,
    tokenPrefix: prefix,
    scopes: JSON.stringify(scopes),
    createdAt: now,
    revokedAt: null,
    lastUsedAt: null,
  })
  return { grant: toView(row), secret }
}

/** Owner/admin: persist an OAuth grant for one client in this workspace. */
export async function createOauthGrant(
  scope: TenantScope,
  input: CreateOauthGrantInput,
  now: Date,
): Promise<AgentGrantView> {
  assertRole(scope, 'create an agent grant', 'admin')
  const parsed = createOauthGrantSchema.parse(input)
  const scopes = uniqueSortedScopes(parsed.scopes)
  const row = await grantAccess.insert(scope, {
    id: newId(),
    userId: scope.ctx.userId,
    kind: 'oauth',
    name: parsed.name,
    clientId: parsed.clientId,
    tokenHash: null,
    tokenPrefix: null,
    scopes: JSON.stringify(scopes),
    createdAt: now,
    revokedAt: null,
    lastUsedAt: null,
  })
  return toView(row)
}

/** Owner/admin: every grant in this workspace, including revoked ones. */
export async function listGrants(
  scope: TenantScope,
): Promise<ReadonlyArray<AgentGrantView>> {
  assertRole(scope, 'list agent grants', 'admin')
  const rows = await grantAccess.findMany(scope, {
    orderBy: [desc(agentGrants.createdAt), desc(agentGrants.id)],
  })
  return rows.map(toView)
}

/** Owner/admin: set `revoked_at`. Idempotent if already revoked. Foreign ids are not found. */
export async function revokeGrant(
  scope: TenantScope,
  input: RevokeGrantInput,
  now: Date,
): Promise<AgentGrantView> {
  assertRole(scope, 'revoke an agent grant', 'admin')
  const parsed = revokeGrantSchema.parse(input)
  const existing = await grantAccess.findById(scope, parsed.grantId)
  if (!existing) throw new NotFoundError('agent grant', parsed.grantId)
  if (existing.revokedAt) return toView(existing)
  const updated = await grantAccess.requireUpdate(scope, parsed.grantId, {
    revokedAt: now,
  })
  return toView(updated)
}

/**
 * Resolve a presented PAT to its grant row, or `null`.
 *
 * Revoked, malformed, and unknown secrets are the same answer. The hash comparison is
 * constant-time on equal-length hex; the SQL match is how we find the candidate.
 */
export async function findPatGrantByTokenHash(
  db: Database,
  secret: string,
): Promise<AgentGrantRow | null> {
  if (!PAT_SECRET.test(secret)) return null
  const tokenHash = await sha256Hex(secret)
  const rows = await db
    .select()
    .from(agentGrants)
    .where(eq(agentGrants.tokenHash, tokenHash))
    .limit(1)
  const row = rows[0]
  if (!row || row.tokenHash === null) return null
  if (!hashesEqual(row.tokenHash, tokenHash)) return null
  if (row.revokedAt) return null
  return row
}

/**
 * Resolve a verified OAuth client to its grant row, or `null`.
 *
 * Revoked and unknown pairs are the same answer. The tenant is whatever row
 * matches this user and client.
 */
export async function findOauthGrantByClient(
  db: Database,
  input: { userId: string; clientId: string },
): Promise<AgentGrantRow | null> {
  const userId = z.string().trim().min(1).max(64).parse(input.userId)
  const clientId = z.string().trim().min(1).max(256).parse(input.clientId)
  const rows = await db
    .select()
    .from(agentGrants)
    .where(
      and(
        eq(agentGrants.userId, userId),
        eq(agentGrants.clientId, clientId),
        eq(agentGrants.kind, 'oauth'),
      ),
    )
    .limit(1)
  const row = rows[0]
  if (!row || row.revokedAt) return null
  return row
}
