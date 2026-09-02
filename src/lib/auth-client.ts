/**
 * The browser half of auth.
 *
 * It talks to `/api/auth/*` over HTTP and knows nothing else: no binding, no database handle, no
 * import from `src/server`. That separation is not stylistic — anything reachable from here ends up
 * in the browser bundle, and `src/server/auth/*` reaches `cloudflare:workers` and the D1 schema.
 *
 * The plugins mirror the server's, minus one. `admin` is deliberately absent: its HTTP paths are
 * closed by `disabledPaths` in `src/server/auth/permissions.ts`, so a client for them would be a
 * set of methods that always answer `404` — an invitation to try, and a misleading one.
 *
 * `AuthFailure` at the bottom exists because every auth screen needs the same three facts about a
 * refusal and Better Auth hands back a wide error object. Normalising once here means the screens
 * hold one shape and the message catalogue holds one key per code.
 */

import { createAuthClient } from 'better-auth/react'
import { organizationClient, twoFactorClient } from 'better-auth/client/plugins'

/**
 * Where the auth routes are mounted.
 *
 * The same value appears in `src/server/auth/config.ts` and in the route file that serves it. It is
 * repeated rather than imported because importing it from the server module would pull the Worker
 * runtime into the browser bundle, which is a much worse trade than one duplicated path literal.
 */
export const AUTH_BASE_PATH = '/api/auth'

/**
 * Same-origin by default: the app and its auth routes are served by one Worker, so a `baseURL`
 * would only be a second place for the origin to be wrong.
 */
export const authClient = createAuthClient({
  basePath: AUTH_BASE_PATH,
  plugins: [twoFactorClient(), organizationClient()],
})

export const {
  signIn,
  signOut,
  signUp,
  useSession,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  organization,
  twoFactor,
} = authClient

/** The shape every auth screen renders a failure from. */
export interface AuthFailure {
  /**
   * Better Auth's error code (`INVALID_EMAIL_OR_PASSWORD`, `USER_ALREADY_EXISTS`, …), upper snake
   * case, or `UNKNOWN`. The screens key their message catalogue on this and never on the message.
   */
  readonly code: string
  /** HTTP status, when there was a response. `0` for a request that never reached the server. */
  readonly status: number
  /**
   * The server's own sentence.
   *
   * A fallback for a code the catalogue does not know yet, never the primary text: it is English,
   * it comes from a dependency, and the product ships in more than one language.
   */
  readonly message: string
}

/** Narrows whatever a Better Auth call rejected or reported with into {@link AuthFailure}. */
export function toAuthFailure(error: unknown): AuthFailure {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      code?: unknown
      status?: unknown
      statusText?: unknown
      message?: unknown
    }
    return {
      code: typeof candidate.code === 'string' ? candidate.code : 'UNKNOWN',
      status: typeof candidate.status === 'number' ? candidate.status : 0,
      message:
        typeof candidate.message === 'string'
          ? candidate.message
          : typeof candidate.statusText === 'string'
            ? candidate.statusText
            : 'Something went wrong.',
    }
  }
  return { code: 'UNKNOWN', status: 0, message: 'Something went wrong.' }
}
