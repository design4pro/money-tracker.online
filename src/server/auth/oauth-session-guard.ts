/**
 * A KV session with no D1 row cannot back an OAuth grant.
 *
 * `findSession` answers from KV, so authorize and consent treat that session as
 * signed in and store its id on the authorization code. The token endpoint then
 * loads `session` by id through the database adapter. A miss is
 * `400 invalid_request` / "session no longer exists".
 *
 * The KV payload is not written back. It is JSON (dates are strings, `user`
 * sits beside the session), `updateSession` does not insert a missing row, and
 * a row that was removed must not be put back and then used to mint tokens.
 * The session is deleted and the request continues as signed out. Authorize
 * already redirects to the login page in that case. Consent requires a
 * session, so it returns the `{ redirect, url }` object the consent screen
 * already follows.
 */

import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { deleteSessionCookie } from 'better-auth/cookies'

const OAUTH_SESSION_PATHS: ReadonlySet<string> = new Set([
  '/oauth2/authorize',
  '/oauth2/consent',
])

/**
 * Before hook for `/oauth2/authorize` and `/oauth2/consent`.
 *
 * Other paths return immediately, so a normal page read still uses the KV
 * session and is not signed out.
 */
export const rejectKvOnlyOauthSession = createAuthMiddleware(async (ctx) => {
  if (!OAUTH_SESSION_PATHS.has(ctx.path)) return

  const current = await getSessionFromCtx(ctx)
  if (!current?.session) return

  const row = await ctx.context.adapter.findOne({
    model: 'session',
    where: [{ field: 'id', value: current.session.id }],
  })
  if (row) return

  await ctx.context.internalAdapter.deleteSession(current.session.token)
  ctx.context.session = null
  deleteSessionCookie(ctx)

  if (ctx.path === '/oauth2/consent') {
    return { redirect: true, url: oauthLoginPage(ctx) }
  }
})

function oauthLoginPage(ctx: {
  readonly context: {
    readonly options: {
      readonly plugins?: ReadonlyArray<{
        readonly id: string
        readonly options?: unknown
      }>
    }
  }
}): string {
  const plugin = ctx.context.options.plugins?.find(
    (candidate) => candidate.id === 'oauth-provider',
  )
  const options = plugin?.options
  if (
    typeof options === 'object' &&
    options !== null &&
    'loginPage' in options &&
    typeof options.loginPage === 'string' &&
    options.loginPage.startsWith('/')
  ) {
    return options.loginPage
  }
  return '/login'
}
