import { createFileRoute } from '@tanstack/react-router'
// Loads the Start module augmentation that adds `server` to route options.
import type {} from '@tanstack/react-start'

import { handleMcpRequest } from '#/server/mcp/handler'

/**
 * `/api/mcp` — Streamable HTTP MCP (ADR 0037).
 *
 * Cookie-free. Personal tokens and OAuth access tokens both resolve to one
 * grant. The handler lists no tools until a later phase. `OPTIONS` is listed
 * because Inspector and browser-hosted clients send a CORS preflight.
 */
function handle({ request }: { request: Request }): Promise<Response> {
  return handleMcpRequest(request)
}

export const Route = createFileRoute('/api/mcp')({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      DELETE: handle,
      OPTIONS: handle,
    },
  },
})
