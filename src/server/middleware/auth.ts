/**
 * The guards as TanStack Start middleware.
 *
 * These are **not** a second authorisation path. Each one calls the same `requireUser` /
 * `requireOrg` from `#/server/auth/guards` that a handler would call itself; what they add is that
 * the result arrives as typed context, so a handler that declares `tenantMiddleware` cannot forget
 * to authorise and cannot reach a repository without a scope — the scope is simply there.
 *
 * When to use which:
 *
 * - A server function that needs one line of authorisation and then goes straight to a repository
 *   is clearer calling `requireOrg()` in its own body — `src/server/fns/accounts.ts` does exactly
 *   that, and reads better for it.
 * - A **group** of functions that all need the same context is clearer declaring the middleware
 *   once, because then the guard is part of the function's signature rather than its first
 *   statement, and a new function added to the group cannot be added without it.
 *
 * Both spellings run the same code, so there is no version of "authorised" that only one of them
 * enforces. A refusal is an `AuthRequirementError` in either case, carrying the `401`/`403` the
 * error boundary turns into a response.
 */

import { createMiddleware } from '@tanstack/react-start'

import { requireOrg, requireUser } from '#/server/auth/guards'

/**
 * Provides `context.user`: the signed-in account, or a refusal.
 *
 * For the handful of surfaces that are about the person rather than their money — the account
 * screen, the two-factor setup, sign-out. Anything touching a table belongs behind
 * {@link tenantMiddleware}, because a user id is not a tenant.
 */
export const authMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => next({ context: { user: await requireUser() } }),
)

/**
 * Provides `context.scope`: the tenant scope for the caller's active workspace.
 *
 * This is what every repository call takes as its first argument, so a handler behind this
 * middleware has no way to query without a workspace — it has the scope, and the scope is the only
 * thing the repositories accept. `scope.ctx` carries the caller's id and their **current** role, as
 * `requireOrg` re-read it a moment ago.
 */
export const tenantMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => next({ context: { scope: await requireOrg() } }),
)

/**
 * Provides `context.scope` and refuses anybody below `admin` in the workspace.
 *
 * Declared as its own middleware rather than as a parameter, because a role requirement that is a
 * parameter is a role requirement somebody passes wrongly. Owners satisfy it; members do not.
 */
export const workspaceAdminMiddleware = createMiddleware({
  type: 'function',
}).server(async ({ next }) =>
  next({ context: { scope: await requireOrg({ role: 'admin' }) } }),
)
