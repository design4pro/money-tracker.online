/**
 * The MCP protected-resource identifier (RFC 8707 / RFC 9728).
 *
 * Issued OAuth access tokens are audience-bound to this URL. Discovery metadata
 * and `WWW-Authenticate` challenges name the same value.
 */

import { appUrl } from '#/server/auth/env'

/** Streamable HTTP mount. The `agents` package defaults to `/mcp`; this product does not. */
export const MCP_ROUTE = '/api/mcp'

export function mcpResourceUrl(): string {
  return `${appUrl()}${MCP_ROUTE}`
}

export function mcpResourceMetadataUrl(): string {
  return `${appUrl()}/.well-known/oauth-protected-resource${MCP_ROUTE}`
}

export function jwksUrl(): string {
  return `${appUrl()}/api/auth/jwks`
}
