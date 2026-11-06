/**
 * Access-token claim naming the workspace the consent was given in.
 *
 * Not an RFC 9068 reserved name, so the authorization server will not strip
 * it. `azp` stays the OAuth client. The value is the session's active
 * organization id at token issue, never a query parameter.
 */
export const MCP_ORGANIZATION_CLAIM = 'org_id'
