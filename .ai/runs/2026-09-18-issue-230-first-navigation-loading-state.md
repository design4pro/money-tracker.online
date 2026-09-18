# Execution plan — the first client-side navigation draws its loading state

`Source doc:` `.ai/specs/2026-09-11-first-navigation-loading-state.md`
`Issue:` #230
`Spec PR:` #232 (merged 2026-09-11)
`Engine:` om-auto-create-pr (steps: 6, --loop: no)

## Goal

Dehydrate the shell `_app.beforeLoad` already resolved during SSR into the client's query cache
through the router's own `dehydrate`/`hydrate` options, so the first client-side navigation in a tab
resolves the guard from cache and renders the destination's pending state — without moving or
weakening the guard (ADR 0018).

## Scope

- `src/components/app/shell/shell-query.ts` (new): `SHELL_QUERY_KEY`, `SHELL_STALE_TIME`,
  `shellQueryOptions({ queryFn })` with Q2 (`gcTime: Infinity`) and Q3 (`revalidateIfStale: true`).
- `src/routes/_app.tsx`: consume the factory, correct the cadence comment.
- `src/router.tsx`: `dehydrate` / `hydrate` carrying `shell` and `shellUpdatedAt`.
- Unit tests over `shellQueryOptions` and the hydrate round trip.
- `e2e/support/states.ts`: a hold that includes the shell (the regression helper); docblocks
  rewritten (Q4 — the exception in `holdServerFns` stays).
- `e2e/states.spec.ts`: the first-navigation case, the guard-redirect case, the anonymous-document
  case.
- `docs/STATE-INVENTORY.md` §3 and §6 reconciled.

## Non-goals

- Anything #21 shipped; the `ErrorPanel` move (#208); weakening the guard in any form.
- No dependency, schema, message key, repository or server-function change.

## Implementation Plan

### Phase 1 — The shell crosses the wire, and the first navigation draws its skeleton

1. Give the shell's cache contract one owner (pure move).
2. Write the failing browser test (hold including the shell, first navigation in a fresh context).
3. Open the channel: `dehydrate` / `hydrate` in `src/router.tsx`.
4. Q2 + Q3 in `shellQueryOptions`, with unit tests (options, hydrate keeps the server stamp).
5. Guard answer unchanged (unauthenticated redirect keeps `redirect`), and no session-derived value
   in an anonymous document.
6. Reconcile `docs/STATE-INVENTORY.md` and the `e2e/support/states.ts` docblocks; full gate; frames.

## Risks

- `src/router.tsx` is in every visitor's entry chunk: the anonymous-document assertion guards it.
- `holdServerFns` picks "the shell" by arrival order; once the shell is primed, the first request of
  a first navigation is the destination's own read. Existing loading-state tests are re-run to
  confirm they still photograph a skeleton.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The shell crosses the wire, and the first navigation draws its skeleton

- [ ] 1.1 Give the shell's cache contract one owner
- [ ] 1.2 Write the failing browser test
- [ ] 1.3 Open the channel
- [ ] 1.4 Make the priming outlive five minutes, and make the refresh real
- [ ] 1.5 Assert the guard's answer is unchanged, and that nothing leaks into a signed-out document
- [ ] 1.6 Reconcile the documents that record the block as permanent, and capture the frames
