import { createFileRoute } from '@tanstack/react-router'
import type {} from '@tanstack/react-start'

import { handleAuthRequest } from '#/server/auth'

/**
 * `/oauth2/*` — Better Auth MCP OAuth 2.1 endpoints (token, DCR, authorize).
 *
 * These paths are absolute on the plugin, not under `/api/auth`. The auth
 * handler routes internally. Do not Bypass `/oauth2/authorize` in Access;
 * token and register are listed in `docs/DEPLOY.md` §8.1.
 */
function handle({ request }: { request: Request }): Promise<Response> {
  return handleAuthRequest(request)
}

export const Route = createFileRoute('/oauth2/$')({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      OPTIONS: handle,
    },
  },
})
