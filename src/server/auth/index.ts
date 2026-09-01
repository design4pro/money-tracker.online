/**
 * The auth instance and the request-bound session read.
 *
 * This is the only module that constructs Better Auth, and the only one that reaches for the
 * request in flight. Everything with a rule in it lives next door — `./config` holds the options,
 * `./guards` the two doors, `./tenant` and `./permissions` the decisions — so that this file stays
 * small enough to be obviously correct.
 *
 * Nothing here is imported by `./guards` at module scope: the guards reach it with a dynamic import
 * so they remain loadable in a plain Node test. See that file for the reasoning.
 */

import { betterAuth } from 'better-auth'
import { getRequest } from '@tanstack/react-start/server'

import { authOptions } from './config'
import { normaliseSession } from './tenant'

import type { Auth } from './config'
import type { AuthSession } from './tenant'

export { AUTH_BASE_PATH } from './config'
export type { Auth } from './config'

let instance: Auth | null = null

/**
 * The auth instance for this isolate.
 *
 * Built once and reused: constructing it reads the bindings, resolves the adapter and initialises
 * every plugin, and doing that per request would put that work on the critical path of every
 * authenticated page. It holds no request state.
 */
export function getAuth(): Auth {
  instance ??= betterAuth(authOptions())
  return instance
}

/** Serves an `/api/auth/*` request. The route handler is the only intended caller. */
export function handleAuthRequest(request: Request): Promise<Response> {
  return getAuth().handler(request)
}

/**
 * The session for the request in flight, or `null`.
 *
 * The result goes through {@link normaliseSession} rather than being returned as-is: the adapter's
 * return type is wide and partly plugin-shaped, and this codebase wants one narrow `AuthSession`
 * that every guard, middleware and route can rely on. The cast is at the boundary where an unknown
 * external shape becomes a checked internal one, which is where a cast belongs.
 */
export async function getSession(): Promise<AuthSession | null> {
  const raw = await getAuth().api.getSession({
    headers: getRequest().headers,
  })
  return normaliseSession(raw)
}
