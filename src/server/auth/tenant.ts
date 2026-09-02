/**
 * Session normalisation and the pure half of the guards.
 *
 * Kept free of Worker bindings and request plumbing so the rules that decide "who is this, and which
 * workspace may they touch" are unit-testable without a request, a KV namespace or a D1 handle.
 * `./guards` supplies the reads; this module supplies the decisions.
 *
 * The **workspace** role dictionary (`owner | admin | member`) lives in
 * `src/server/repos/scope.ts`, because that is where the thing it authorises lives. This module
 * imports it and never restates it. The **platform** dictionary is `./permissions`. See that file's
 * header for why the two are never mixed.
 */

import { isOrganizationRole, roleSatisfies } from '#/server/repos/scope'

import type { OrganizationRole, TenantContext } from '#/server/repos/scope'

export type { OrganizationRole, TenantContext }

/**
 * The authenticated user as the app needs it.
 *
 * The last four fields are Better Auth's `admin` plugin columns. They are read by the platform
 * predicate and by the shell; nothing on a client may write them, and {@link normaliseSession} is
 * the only door they come through.
 */
export interface AuthUser {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly emailVerified: boolean
  readonly image: string | null
  readonly twoFactorEnabled: boolean
  /**
   * The **platform** role, verbatim. `null` for an account that has never been raised, and a value
   * outside the three platform roles is possible because the column carries no `CHECK`. Both resolve
   * to `user` in `./permissions`, never to "unset, therefore permissive".
   */
  readonly role: string | null
  readonly banned: boolean
  readonly banReason: string | null
  readonly banExpires: Date | null
}

/** The active session record. */
export interface AuthSessionRecord {
  readonly id: string
  readonly token: string
  readonly userId: string
  readonly activeOrganizationId: string | null
  readonly expiresAt: Date
  /** The operator acting as this session's user, when the session was minted by impersonation. */
  readonly impersonatedBy: string | null
}

export interface AuthSession {
  readonly user: AuthUser
  readonly session: AuthSessionRecord
}

/**
 * Why an auth requirement could not be met.
 *
 * One vocabulary for every denial, workspace and platform alike. A second denial type beside this
 * one would be a second answer to "why was this refused", and the surfaces would drift apart.
 */
export type AuthFailureReason =
  | 'unauthenticated'
  | 'no-active-organization'
  | 'not-a-member'
  | 'insufficient-role'
  | 'banned'
  | 'insufficient-platform-permission'
  | 'impersonated'

export class AuthRequirementError extends Error {
  readonly reason: AuthFailureReason
  readonly status: 401 | 403

  constructor(reason: AuthFailureReason, message: string) {
    super(message)
    this.name = 'AuthRequirementError'
    this.reason = reason
    this.status = reason === 'unauthenticated' ? 401 : 403
  }
}

export function isAuthRequirementError(
  error: unknown,
): error is AuthRequirementError {
  return error instanceof AuthRequirementError
}

/**
 * Narrows a nullable session to a usable one, or explains why there is not one.
 *
 * A banned account is refused here rather than deeper in, because "suspended" has to mean the same
 * thing on every surface — one that stops at the first door and not at some of them.
 */
export function requireSessionFrom(session: AuthSession | null): AuthSession {
  if (!session) {
    throw new AuthRequirementError(
      'unauthenticated',
      'You need to sign in to continue.',
    )
  }
  if (session.user.banned) {
    throw new AuthRequirementError('banned', 'This account is suspended.')
  }
  return session
}

/** The signed-in user, or the reason there is not one. */
export function requireUserFrom(session: AuthSession | null): AuthUser {
  return requireSessionFrom(session).user
}

export interface RequireOrgOptions {
  /** Minimum workspace role the caller must hold. Defaults to `member`. */
  readonly role?: OrganizationRole
  /**
   * Assert which workspace the caller believes they are in.
   *
   * **This never selects a workspace.** The scope always comes from the session's active workspace
   * and the caller's own `member` row; a value here that disagrees is a tenancy violation and is
   * refused. A guard that let a request payload choose the tenant would make every isolation test
   * downstream of it meaningless.
   */
  readonly organizationId?: string
}

/**
 * Builds the tenant context for the session's active workspace, enforcing the minimum role.
 *
 * `membershipRole` is passed in rather than read from the session, and that is the point of the
 * signature: `./guards` re-reads it from the `member` table on every call. A session claim is a
 * snapshot of a membership at sign-in; a membership is a fact, and a member demoted a minute ago
 * must not still be an admin.
 */
export function requireOrgFrom(
  session: AuthSession | null,
  membershipRole: string | null,
  options: RequireOrgOptions = {},
): TenantContext {
  const active = requireSessionFrom(session)
  const activeOrganizationId = active.session.activeOrganizationId

  if (!activeOrganizationId) {
    throw new AuthRequirementError(
      'no-active-organization',
      'Choose a workspace before continuing.',
    )
  }

  if (
    options.organizationId !== undefined &&
    options.organizationId !== activeOrganizationId
  ) {
    throw new AuthRequirementError(
      'not-a-member',
      'You do not have access to that workspace.',
    )
  }

  if (!isOrganizationRole(membershipRole)) {
    throw new AuthRequirementError(
      'not-a-member',
      'You are not a member of this workspace.',
    )
  }

  const minimum = options.role ?? 'member'
  if (!roleSatisfies(membershipRole, minimum)) {
    throw new AuthRequirementError(
      'insufficient-role',
      `This action needs the ${minimum} role.`,
    )
  }

  return {
    organizationId: activeOrganizationId,
    userId: active.user.id,
    role: membershipRole,
  }
}

type RawSession = {
  user: Record<string, unknown>
  session: Record<string, unknown>
} | null

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date : null
  }
  return null
}

/**
 * Normalises what Better Auth returns into the app's own session shape, answering `null` for
 * anything that is not a complete, usable session.
 *
 * Field by field rather than by cast: the adapter's return type is wide, and a session missing its
 * token or its expiry is not a session the product should treat as one.
 */
export function normaliseSession(raw: RawSession): AuthSession | null {
  if (!raw) return null

  const userId = asString(raw.user.id)
  const email = asString(raw.user.email)
  const sessionId = asString(raw.session.id)
  const token = asString(raw.session.token)
  const expiresAt = asDate(raw.session.expiresAt)

  if (!userId || !email || !sessionId || !token || !expiresAt) return null

  return {
    user: {
      id: userId,
      email,
      name: asString(raw.user.name) ?? email,
      emailVerified: raw.user.emailVerified === true,
      image: asString(raw.user.image),
      twoFactorEnabled: raw.user.twoFactorEnabled === true,
      role: asString(raw.user.role),
      banned: raw.user.banned === true,
      banReason: asString(raw.user.banReason),
      banExpires: asDate(raw.user.banExpires),
    },
    session: {
      id: sessionId,
      token,
      userId: asString(raw.session.userId) ?? userId,
      activeOrganizationId: asString(raw.session.activeOrganizationId),
      expiresAt,
      impersonatedBy: asString(raw.session.impersonatedBy),
    },
  }
}
