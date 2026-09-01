import { createFileRoute } from '@tanstack/react-router'
// Loads the Start module augmentation that adds `server` to route options.
import type {} from '@tanstack/react-start'

import { handleAuthRequest } from '#/server/auth'

/**
 * `/api/auth/*` — the whole of Better Auth's HTTP surface, in one splat route.
 *
 * `src/server/auth/index.ts` has always exported `handleAuthRequest`, and its own comment named
 * "the route handler" as its only intended caller. There was no route. Sign-up answered 404, which
 * is what a missing mount looks like from a browser: the form posts, the network tab shows
 * `/api/auth/sign-up/email 404`, and nothing in the server log says anything is wrong — because
 * from the Worker's point of view nothing is. This file is that mount.
 *
 * **Every method goes to the same function.** Better Auth routes internally on the path and the
 * verb; enumerating its endpoints here would be a second, staler copy of its router, and the first
 * plugin that adds a path would silently stop working. `GET` and `POST` carry the whole protocol
 * today — `OPTIONS` is listed because the client sends a preflight when the app is opened from a
 * different loopback port than the one `APP_URL` names, which is a routine state in development.
 *
 * **No guard runs in front of it.** This is the endpoint that *establishes* who somebody is; a
 * session check here would make signing in require being signed in. Authorisation for everything
 * downstream is `requireUser` / `requireOrg`, called inside each server function.
 *
 * The paths that must not be reachable — the `admin` plugin's — are closed in
 * `src/server/auth/permissions.ts` via `disabledPaths`, on the instance rather than at this mount,
 * so they stay closed no matter how the handler is reached.
 */
function handle({ request }: { request: Request }): Promise<Response> {
  return handleAuthRequest(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      OPTIONS: handle,
    },
  },
})
