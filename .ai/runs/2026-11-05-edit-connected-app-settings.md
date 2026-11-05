# Edit connected app settings

Source doc: `.ai/specs/2026-11-05-edit-connected-app-settings.md`

Goal: an owner or admin edits the name and `resource:verb` scopes of an OAuth grant or a personal token from Settings → Agents, sees last used, and can still revoke. The next `tools/list` reads the updated row. Stacked on `fix/issue-869-oauth-consent-scopes`.

Scope: `updateAgentGrant`, the settings server function with the `mcp` feature gate, a shared scope picker used by consent, mint, and the edit dialog, and the `DESIGN.md` guideline.

Non-goals: consent lookup changes, `findOauthGrantByClient`, a migration, rotating a PAT secret, editing a revoked grant.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Edit a live grant

- [x] 1.1 Repository write and tenant-isolation case — c7348467
- [x] 1.2 Server function and feature-gate test — 01059cf5
- [x] 1.3 Shared scope picker, consent and mint call sites, DESIGN.md — f6756312
- [x] 1.4 Edit dialog, EN+PL copy, page tests — 94ec1cec
- [x] 1.5 Tool list follows the updated row — c7348467
