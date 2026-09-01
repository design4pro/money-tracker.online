/**
 * `requireUser` and `requireOrg` — the two doors every server function goes through.
 *
 * A server function is a public HTTP endpoint. Its arguments come from the network, so the only
 * facts it may act on are the ones re-established here: **who** the cookie proves you are, and
 * **which workspace** your `member` row says you belong to.
 *
 * Three properties are load-bearing, and each of them is a decision rather than an accident.
 *
 * **The membership role is re-read on every call.** Better Auth can put a role in the session, and
 * reading it there would be one fewer query. It would also mean that demoting somebody from `admin`
 * to `member` does nothing until their session expires — a session claim is a snapshot of a
 * membership taken at sign-in, and this layer needs the membership.
 *
 * **The workspace is never chosen by the caller.** `requireOrg({ organizationId })` *asserts* which
 * workspace the caller believes they are in and refuses on a mismatch; it does not select one. If a
 * request payload could pick the tenant, every isolation test below this line would be theatre.
 *
 * **The returned value is a `TenantScope`, not an id.** `createScope` is the only constructor of the
 * thing every repository takes as its first parameter, so the path from "authenticated request" to
 * "SQL with a tenant predicate" has no branch on which the predicate can be forgotten.
 *
 * {@link createGuards} takes its session reader and its database as arguments and reaches no
 * binding, so the whole decision path above is exercised against real SQLite in `__tests__`. The
 * request-bound `requireUser` / `requireOrg` at the bottom are the same functions with the Worker's
 * own session reader supplied.
 */

import { createScope } from '#/server/repos/scope'
import {
  membershipRoleFor,
  resolveOrProvisionOrganization,
} from './organization'
import {
  AuthRequirementError,
  requireOrgFrom,
  requireSessionFrom,
  requireUserFrom,
} from './tenant'

import type { TenantScope } from '#/server/repos/scope'
import type { AppDatabase } from './db'
import type { AuthSession, AuthUser, RequireOrgOptions } from './tenant'

export type { RequireOrgOptions }
export { AuthRequirementError, isAuthRequirementError } from './tenant'
export type { AuthFailureReason, AuthSession, AuthUser } from './tenant'

export interface GuardDependencies {
  /** Reads the session for the request in flight. */
  readonly getSession: () => Promise<AuthSession | null>
  readonly db: AppDatabase
}

export interface Guards {
  /** The signed-in user, or `AuthRequirementError`. Banned accounts are refused here. */
  requireUser: () => Promise<AuthUser>
  /** The signed-in user's scope for their active workspace, or `AuthRequirementError`. */
  requireOrg: (options?: RequireOrgOptions) => Promise<TenantScope>
}

export function createGuards(deps: GuardDependencies): Guards {
  async function currentUser(): Promise<AuthUser> {
    return requireUserFrom(await deps.getSession())
  }

  async function currentScope(
    options: RequireOrgOptions = {},
  ): Promise<TenantScope> {
    const session = requireSessionFrom(await deps.getSession())

    // Normally the sign-up hooks have already pinned a workspace to the session. This resolves the
    // accounts they did not reach — one created before provisioning shipped, or one whose session
    // predates it — rather than showing a returning user an empty product. It is idempotent.
    const organizationId =
      session.session.activeOrganizationId ??
      (await resolveOrProvisionOrganization(deps.db, session.user.id))

    if (!organizationId) {
      throw new AuthRequirementError(
        'no-active-organization',
        'Choose a workspace before continuing.',
      )
    }

    const role = await membershipRoleFor(deps.db, {
      userId: session.user.id,
      organizationId,
    })

    // Rebuilt with the resolved workspace so the pure rule below reads it from exactly one place.
    const context = requireOrgFrom(
      {
        ...session,
        session: { ...session.session, activeOrganizationId: organizationId },
      },
      role,
      options,
    )

    return createScope(deps.db, context)
  }

  return { requireUser: currentUser, requireOrg: currentScope }
}

/* -------------------------------------------------------------------------- */
/* The request-bound guards                                                    */
/* -------------------------------------------------------------------------- */

let requestGuards: Guards | null = null

/**
 * The production wiring, resolved on first use.
 *
 * `./index` and `./db` are reached with a **dynamic** import on purpose: both lead to
 * `cloudflare:workers`, and a static import would make this module unloadable in the `server` test
 * project, which runs in plain Node. Deferring them keeps every export above testable while the two
 * functions below stay a plain call for their callers. Wrangler and Vite resolve the import at
 * build time, so this is not a runtime fetch.
 */
async function guards(): Promise<Guards> {
  if (!requestGuards) {
    const [{ getSession }, { getDb }] = await Promise.all([
      import('./index'),
      import('./db'),
    ])
    requestGuards = createGuards({ getSession, db: getDb() })
  }
  return requestGuards
}

/** The signed-in user for the request in flight. Throws `AuthRequirementError` when there is none. */
export async function requireUser(): Promise<AuthUser> {
  return (await guards()).requireUser()
}

/**
 * The tenant scope for the request in flight: the workspace the caller is actually a member of,
 * with the role they actually hold right now.
 */
export async function requireOrg(
  options?: RequireOrgOptions,
): Promise<TenantScope> {
  return (await guards()).requireOrg(options)
}
