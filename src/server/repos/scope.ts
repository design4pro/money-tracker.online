/**
 * The tenant scope — the only thing that authorises a query.
 *
 * A {@link TenantScope} is a validated {@link TenantContext} welded to the database handle it may
 * act on. Nothing in `src/server/repos/**` reads or writes a row without one, every repository
 * function takes it as its **first parameter**, and {@link createScope} is its only constructor.
 * There is no ambient scope, no default workspace and no "current organization" global: a query
 * that has not been handed a scope does not compile.
 *
 * Two properties make that claim worth something rather than decorative:
 *
 * - **The context is parsed, not trusted.** `createScope` takes `unknown` and runs it through Zod.
 *   A session, a queue message and a Durable Object callback all arrive as loosely-typed objects,
 *   and a half-populated one — `organizationId: undefined` — would otherwise compose
 *   `WHERE organization_id IS NULL`, which matches nothing today and matches everything the moment
 *   somebody makes the column nullable.
 * - **The scope is frozen.** `TenantScope` and `TenantContext` are `readonly` and the object is
 *   `Object.freeze`d, so a caller cannot rewrite the workspace after the scope was built. Handing a
 *   scope onward is therefore handing on exactly the authority it was created with.
 *
 * Zod runs here **and again in each repository** on that repository's own input (the standard's
 * "validated with Zod, and parsed a second time in the repository"): this file validates who is
 * asking, not what they are asking for.
 */

import { z } from 'zod'

import { ORGANIZATION_ROLES } from '#/server/db/auth-schema'
import {
  ForbiddenError,
  MissingTenantContextError,
  TenantIsolationError,
} from './errors'

import type { BatchItem, BatchResponse } from 'drizzle-orm/batch'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { OrganizationRole } from '#/server/db/auth-schema'

export type { OrganizationRole }

/**
 * A driver-agnostic Drizzle handle.
 *
 * The Worker passes a D1 handle and the tests pass an in-memory SQLite one through Drizzle's proxy
 * driver. Both satisfy this type, which is what lets every repository be exercised against the real
 * generated DDL in a plain Node test rather than against a hand-written fake.
 *
 * Both also expose `batch`, one atomic unit of statements (D1 runs it as an implicit transaction;
 * the test harness wraps it in `BEGIN`/`COMMIT`). Nothing outside `./base` calls it: a repository
 * composes a batch from the statement builders and `runTenantBatch` there.
 */
export type Database = BaseSQLiteDatabase<'async', unknown> & {
  batch: <U extends BatchItem<'sqlite'>, T extends Readonly<[U, ...U[]]>>(
    batch: T,
  ) => Promise<BatchResponse<T>>
}

/**
 * Who is asking, and the single workspace whose rows they may touch.
 *
 * `role` is the **workspace** role (`owner | admin | member`) and never the platform role
 * (`admin | curator | user`). The two dictionaries are separate types on purpose — see
 * `src/server/auth/permissions.ts` — because a helper that takes "a role" without saying which is
 * the shape of a privilege bug rather than a naming quibble.
 */
export interface TenantContext {
  /** `user.id` of the acting principal. */
  readonly userId: string
  /** `organization.id` every row read or written under this scope must belong to. */
  readonly organizationId: string
  /** The principal's role **inside that workspace**, re-read from `member` by `requireOrg`. */
  readonly role: OrganizationRole
}

/** A validated tenant context paired with the database handle it may act on. */
export interface TenantScope {
  readonly db: Database
  readonly ctx: TenantContext
}

const identifier = z.string().trim().min(1).max(64)

/** Validates a tenant context arriving from a session, a queue message or a Durable Object. */
export const tenantContextSchema: z.ZodType<TenantContext> = z.object({
  userId: identifier,
  organizationId: identifier,
  role: z.enum(ORGANIZATION_ROLES),
})

/**
 * The single gate into the repository layer: a frozen, validated {@link TenantContext}, or a throw.
 */
export function requireTenantContext(context: unknown): TenantContext {
  if (context === null || context === undefined) {
    throw new MissingTenantContextError('no context was supplied')
  }

  const parsed = tenantContextSchema.safeParse(context)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(
        (issue) =>
          `${issue.path.join('.') || 'context'} ${issue.message.toLowerCase()}`,
      )
      .join('; ')
    throw new MissingTenantContextError(detail)
  }

  return Object.freeze({
    userId: parsed.data.userId,
    organizationId: parsed.data.organizationId,
    role: parsed.data.role,
  })
}

/**
 * The only constructor of a {@link TenantScope}.
 *
 * Frozen so that `scope.ctx.organizationId = other` is inert in sloppy mode and a `TypeError` in
 * strict mode, which every module in this codebase is. A caller that wants a different workspace has
 * to go back through the guard that proved membership of it.
 */
export function createScope(db: Database, context: unknown): TenantScope {
  return Object.freeze({ db, ctx: requireTenantContext(context) })
}

/**
 * Workspace roles by privilege, most privileged first — the order `ORGANIZATION_ROLES` declares.
 * The index doubles as the rank, so the dictionary and the ordering cannot drift apart.
 */
const ROLE_RANK: Record<OrganizationRole, number> = {
  owner: 0,
  admin: 1,
  member: 2,
}

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return (
    typeof value === 'string' &&
    (ORGANIZATION_ROLES as ReadonlyArray<string>).includes(value)
  )
}

/** True when `role` is at least as privileged as `minimum`. `owner` satisfies everything. */
export function roleSatisfies(
  role: OrganizationRole,
  minimum: OrganizationRole,
): boolean {
  return ROLE_RANK[role] <= ROLE_RANK[minimum]
}

/** Throws {@link ForbiddenError} unless the scope's role is at least `minimum`. */
export function assertRole(
  scope: TenantScope,
  action: string,
  minimum: OrganizationRole,
): void {
  if (!roleSatisfies(scope.ctx.role, minimum)) {
    throw new ForbiddenError(action, [minimum])
  }
}

/**
 * Re-asserts that an already-loaded row belongs to the caller's workspace.
 *
 * For rows that did **not** come through a scoped query — a queue message body, a webhook payload,
 * a Durable Object callback. Anything loaded through {@link import('./base').createTenantRepository}
 * is already filtered and does not need this.
 */
export function assertSameTenant<TRow extends { organizationId: string }>(
  scope: TenantScope,
  entity: string,
  row: TRow | null | undefined,
): TRow {
  if (!row || row.organizationId !== scope.ctx.organizationId) {
    throw new TenantIsolationError(entity)
  }
  return row
}
