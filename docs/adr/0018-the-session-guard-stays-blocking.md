# 0018. The session guard stays blocking; loading states are bought by priming

Status: accepted
Date: 2026-09-11

## Context

`src/routes/_app.tsx` is the guarded layout. Its `beforeLoad` awaits `loadShell` — the session, the
active workspace, the role and the workspace list, resolved in one server call — and redirects to
the sign-in screen when that resolution is `null`.

TanStack Router resolves a match's `beforeLoad` before it will render that match's pending component
or any of its children's. On a fresh document the client's query cache is empty, so the **first**
client-side navigation in a tab spends a real round trip inside that `await`, and for its whole
duration the router has no pending matches: neither `_app`'s own `pendingComponent`, nor the
`defaultPendingComponent` issue #21 installed, nor any per-route shape can render. The reader sees
the previous screen's figures under the next screen's URL with nothing announced.

`docs/STATE-INVENTORY.md` §3 measured it: with the shell's request held, zero `role="status"`
regions and the previous list still on screen; with the shell let through and everything after it
held, one `role="status"` and eleven skeleton bars. §6 records that #21 shipped around the block
rather than through it, because this is the session and tenant guard and `AGENTS.md` → Ask First
covers it. It was filed as issue #230.

Two shapes answer it, and they are not variations of one idea.

**Prime the cache.** Keep `beforeLoad` blocking and make sure the shell the server already resolved
during SSR reaches the client's cache before the first client render, so the `await` resolves from
memory rather than from the network. The guard's timing, its authority and what it enforces are all
unchanged.

**Move the read.** Take the shell read out of `beforeLoad` and put it in the route's loader or in a
suspense boundary in the component, leaving `beforeLoad` with only the checks that must precede a
render. The pending component then renders immediately, because there is nothing left to await — and
a skeleton of a protected route paints before the session and the tenant have been confirmed.

The second is the more general fix. It also changes what the product is willing to draw for somebody
whose session has not yet been established, and that is a product and security question rather than
a refactor.

## Decision

**The guard stays blocking. Nothing belonging to a protected route paints before the session and the
tenant are confirmed.** A missing loading state is bought by priming the cache, or by making the read
cheaper — never by making the guard advisory.

Concretely, for #230: the shell resolved during SSR crosses into the client's query cache through
`@tanstack/react-router`'s own `dehydrate` / `hydrate` router options, so the first client-side
navigation finds it warm. `beforeLoad` keeps its `await`, its redirect and its error boundary.

The rejected shape is named here, not only in the spec, because it is the obvious answer and will be
proposed again. `.ai/specs/2026-09-11-first-navigation-loading-state.md` is the design; this is the
standing rule it rests on.

## What this costs

Priming is narrower than moving the read. It fixes the case where the server has already resolved
the shell for this document, and it does nothing for a case where it has not — a tab that enters the
product without a protected document load would still block once. That is accepted: the shell rail
uses the design system's `Link`, which does a full document load
(`src/components/app/dashboard/widget-link.tsx`), so nearly every entry into a client-side
navigation is preceded by a document that primes.

It also means the answer is per-cause rather than universal. The next surface that blocks a paint
behind an unavoidable await gets its own priming, not a general relaxation. That is more work, and
it is the work this decision chooses.

## Consequences

- `beforeLoad` in `src/routes/_app.tsx` is not made advisory, partial or optional by any later
  change. A proposal to move the shell read out of it re-opens this ADR rather than landing as an
  implementation detail.
- `beforeLoad` remains **UX, never a data boundary** — unchanged by this decision and restated here
  so the two are not confused. Every server function underneath calls `requireOrg()` for itself and
  resolves its own tenant scope (ADR 0002). This ADR is about what the product draws, not about what
  protects the data; the guard being blocking is not what makes the application safe.
- A loading-state complaint against a protected route is answered by priming or by making the read
  cheaper. `docs/agents/out-of-scope.md` is not the right home for the rejected shape, because it is
  a design alternative rather than a product request; this ADR is.
- Anything primed into the client cache for this purpose is subject to the ordinary rule that a
  signed-out document carries no session-derived field. The spec asserts it for the shell.
