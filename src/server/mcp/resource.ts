/**
 * The MCP protected-resource identifier (RFC 8707 / RFC 9728).
 *
 * Issued OAuth access tokens are audience-bound to this URL. Discovery metadata
 * and `WWW-Authenticate` challenges name the same value.
 */

import { AUTH_BASE_PATH } from '#/server/auth/config'
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
  return `${mcpAccessTokenIssuer()}/jwks`
}

/**
 * Issuer written on oauth-provider access tokens.
 *
 * Better Auth's context base URL is `appUrl()` plus `AUTH_BASE_PATH`. The
 * provider copies that string into `iss`, and authorization-server metadata
 * publishes the same value. The origin alone does not verify.
 */
export function mcpAccessTokenIssuer(): string {
  return `${appUrl()}${AUTH_BASE_PATH}`
}
