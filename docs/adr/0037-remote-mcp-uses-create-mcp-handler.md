# 0037. The remote MCP server is `createMcpHandler` over MCP SDK v2, not `McpAgent`

Status: accepted
Date: 2026-11-04

## Context

#844 needs a remote Model Context Protocol server on the existing Cloudflare Worker so an MCP
client can call tools that read and change one workspace. The issue framed the library choice as
Cloudflare `agents` `McpAgent` versus `@modelcontextprotocol/sdk`. That framing was already stale
when this record was written. The live documents and packages, probed on 2026-11-04 rather than
copied from the issue, are:

- Cloudflare Agents docs, [MCP Server](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)
  and [Build a Remote MCP server](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/):
  new servers use `createMcpHandler` from `agents/mcp/server`. The handler is **stateless**: a
  factory builds a fresh `McpServer` per request. It needs no Durable Object, protocol session, or
  WebSocket. Streamable HTTP is the remote transport; SSE is not what `createMcpHandler` serves.
- The same docs' [McpAgent (deprecated)](https://developers.cloudflare.com/agents/model-context-protocol/apis/agent-api/)
  page: `McpAgent` is a **legacy, feature-frozen** Durable Object server. New work is told to
  migrate off it. It still imports the legacy `McpServer` from `@modelcontextprotocol/sdk`. An SDK
  v2 server from `@modelcontextprotocol/server` **cannot** run inside `McpAgent`. Its RPC transport
  has no OAuth flow.
- npm, same day: `agents@0.33.0` (Cloudflare Inc., updated 2026-11-03) lists optional peers
  `@modelcontextprotocol/server@2.4.0` and `@modelcontextprotocol/sdk@1.32.2`. The published
  README's "Creating a Stateless MCP server" example is `createMcpHandler` plus
  `@modelcontextprotocol/server`. `@modelcontextprotocol/server` is an optional peer, so it is
  not installed with `agents` alone.
- MCP TypeScript SDK v2 (`@modelcontextprotocol/server@2.4.0`) documents
  `WebStandardStreamableHTTPServerTransport` on Workers in stateless mode
  (`sessionIdGenerator: undefined`). Cloudflare's handler is that transport plus Workers concerns
  the SDK does not own: CORS, host allow-lists, and a 25s SSE comment-frame keepalive against the
  ~5-minute edge idle-stream watchdog (see `WorkerTransport` in `cloudflare/agents`).
- This repository on `origin/develop` (`8f8bde8`): `package.json` has neither `agents` nor either
  MCP package. `wrangler.jsonc` declares one Durable Object, `LEDGER` / `AccountLedger`. Auth is
  Better Auth `^1.7.1` (lockfile 1.7.2) with plugins `admin`, `twoFactor`, `organization` only
  (`src/server/auth/config.ts`). Production Access is default-deny (`docs/DEPLOY.md` §8.1).

`docs/SPEC.md` §3.1 freezes `package.json`. Adding either library is therefore an ADR, not a
stage-local install. This record is that permission, scoped to the MCP **transport** library. It
does not add packages in the spec pull request.

OAuth 2.1 with Dynamic Client Registration, personal tokens, plan gating, and Access bypasses are
owner decisions on #844 (2026-11-04). They belong in the spec, not here. This record only answers
which MCP server library the implementation may add.

## Decision

**Serve Streamable HTTP with `createMcpHandler` from `agents/mcp/server`, wrapping
`McpServer` from `@modelcontextprotocol/server` (MCP TypeScript SDK v2).** Mount it on the existing
Worker at `/api/mcp` (the handler's `route` option; the package default `/mcp` is not our public
path). Keep the handler **stateless**. Do not add a Durable Object class, binding, or migration
for MCP sessions. Persist grants, tokens, confirm-delete tickets, and rate-limit counters in D1
and the existing KV namespaces, keyed by the authenticated grant, never by an MCP session id.

**Do not use `McpAgent`.** It is deprecated, feature-frozen, Durable-Object-backed, and incompatible
with SDK v2 servers. It would be a second DO next to `LEDGER` for a problem we have decided not to
have (protocol session state).

**Do not use `@modelcontextprotocol/sdk` (v1) as the server entry.** That package remains the
legacy `McpServer` `McpAgent` still needs. The implementation's server import is
`@modelcontextprotocol/server`. If `agents` pulls `@modelcontextprotocol/sdk` as a transitive peer
to satisfy its own legacy path, that is the adapter's problem, not an invitation to write our
tools against v1 types.

The implementation pull request is the one that edits `package.json` and `pnpm-lock.yaml`, citing
this record, with caret pins over the resolved versions of `agents` and
`@modelcontextprotocol/server` (SPEC §3.1). Pin `@modelcontextprotocol/server` to the exact peer
the chosen `agents` release documents. Zod is already in the tree.

## Consequences

- The Worker entry stays one custom module (`src/server/worker.ts`). MCP is another TanStack Start
  API route in the same fetch handler, in the shape of `src/routes/api/webhooks/polar.ts`: no
  session cookie, its own auth, `OPTIONS` for CORS. `createMcpHandler` is composed inside that
  route after the grant is verified. No `routeAgentRequest`, no `durable_objects` row, no
  `new_sqlite_classes` for MCP.
- Cloudflare's Workers OAuth Provider (`OAuthResourceServer`, `@cloudflare/workers-oauth-provider`)
  is **not** implied. #844 authenticates with Better Auth OAuth 2.1 and personal tokens. Wrapping
  the MCP handler in a second OAuth resource server would be a parallel identity system. CORS and
  keepalive are the only Workers-specific reasons to take `agents/mcp/server` rather than the SDK
  transport alone.
- Importing `agents/mcp/server` must not become an import of `agents` the Agent class. A
  workerd test (ADR 0015) asserts the MCP route boots without a new Durable Object export.
- Rollback is removing the route and the two packages. No protocol session remains on the edge.
  Grants already minted in D1 stay until their own revocation path deletes them; that is the spec's
  problem, not this library's.
- A later WebMCP surface in the open tab is out of this decision. If it ever ships, it is a
  different transport and a different ADR.
