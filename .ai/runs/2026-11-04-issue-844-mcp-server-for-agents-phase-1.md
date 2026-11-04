# Issue #844 — remote MCP server for agents, Phase 1 (grants and PATs)

Engine: om-auto-create-pr (steps: 5, --loop: no)

Source doc: `.ai/specs/2026-11-04-mcp-server-for-agents.md`
Spec PR: #845
Issue: #844
ADR: `docs/adr/0037-remote-mcp-uses-create-mcp-handler.md`

## Goal

Ship the grant tables, paid-plan `mcp` feature, PAT mint/list/revoke, and tenant isolation — with
no MCP traffic yet. `/api/mcp` does not exist after this phase.

## Scope

- Additive migration **0011**: `agent_grants`, `agent_audit_log`
- Plan catalogue `features.mcp` (`false` on `free`, `true` on `plus` / `household`); resolver exposes it
- EN + PL `plans.feature.mcp`
- Tenant-scoped grant repo: create PAT, list, revoke, hash lookup
- Server functions + Zod for mint (secret once) and revoke
- Spec metadata `Status: in-progress`

## Non-goals

- MCP packages, `createMcpHandler`, `/api/mcp`
- Better Auth `mcp()` / OAuth / DCR
- Access dashboard changes; DEPLOY.md Access bypass (Phase 2)
- Read/write/delete tools, confirm-delete tickets, rate limits, settings UI
- Bank connectors, REST public API, WebMCP
- Closing #844 (this phase is `Refs #844` only)

## Implementation Plan

### Phase 1 — Grants

1. Additive Drizzle schema for `agent_grants` and `agent_audit_log` → migration 0011 via `pnpm db:generate`.
2. Catalogue `mcp` feature + EN/PL copy + resolver + unit tests (`free` false, paid true).
3. Grant repo (PAT hash, admin-only writes, list/revoke) + tenant-isolation cases.
4. Server functions + Zod for mint (token once) and revoke; paid-plan mint refusal.
5. Spec `Status: in-progress` and regenerate spec index.

## Risks

- Hash lookup cannot take a `TenantScope` (the tenant is the result). It lives in the grants repo
  and takes `Database`, documented as the lookup seam, never a second tenant predicate.
- Migration 0011 is the last schema change this spec may add.

## Progress

PR: #pending

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Grants

- [x] 1.1 Additive schema and migration 0011 — 154e105
- [x] 1.2 Plan catalogue mcp feature, copy, resolver tests — 154e105
- [x] 1.3 Grant repo, PAT hash, tenant-isolation — 154e105
- [x] 1.4 Mint and revoke server functions — 154e105
- [x] 1.5 Spec in-progress and spec index — 154e105
