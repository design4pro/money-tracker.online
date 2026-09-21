import type { ShellData } from './types'
import type { QueryClient } from '@tanstack/react-query'

/**
 * The application shell's cache contract, in one place.
 *
 * Two modules need it: `src/routes/_app.tsx`, whose `beforeLoad` resolves the shell through it,
 * and `src/router.tsx`, which carries the resolved shell from the SSR pass into the browser's
 * cache. The router cannot import the route module — `routeTree.gen.ts` already does, so that edge
 * would close a cycle through generated code — so the contract lives here, where both can reach it.
 *
 * Nothing here fetches and nothing here imports from `#/server`: the `queryFn` is an argument,
 * supplied by `_app.tsx`, which is the only module that may reach `loadShell`.
 */

/** The milliseconds a resolved shell may be reused across navigations. See `_app.tsx`. */
export const SHELL_STALE_TIME = 30_000

/** The key the shell is cached under. One entry — there is one session per document. */
export const SHELL_QUERY_KEY = ['app-shell'] as const

/**
 * The shell is never garbage-collected.
 *
 * Nothing observes the shell query — `beforeLoad` reads it and no component subscribes — so under
 * the default `gcTime` the entry is removed five minutes after it was written. Collection removes; it
 * does not refetch. A reader who stayed on their first page that long would lose the primed shell and
 * be back to a first navigation that blocks on a round trip (#230). One entry in a per-tab cache.
 */
const SHELL_GC_TIME = Number.POSITIVE_INFINITY

/**
 * What `_app.beforeLoad` hands to `ensureQueryData`.
 *
 * `revalidateIfStale` is what makes {@link SHELL_STALE_TIME} mean anything. Without it
 * `ensureQueryData` returns cached data however stale it is, so the shell only ever refreshed when
 * collection happened to remove it — at most once per five minutes, and never for a reader who does
 * not navigate. With it, the guard still answers from cache at once and the refetch runs behind it:
 * a navigation past the stale mark refreshes the shell within thirty seconds of the server resolving
 * it, and never waits for that refresh. Resident plus revalidated is therefore a tightening of
 * today's cadence, not a widening. The security floor does not move either way: `beforeLoad` is UX,
 * and every server function underneath calls `requireOrg()` for itself.
 *
 * `revalidateIfStale` exists only on the deprecated `ensureQueryData` options in the pinned
 * query-core. Its suggested replacement, `query({ staleTime: 'static' })`, means "never stale" and
 * would invert this, so a query-core major owes this behaviour a deliberate re-implementation
 * (`.ai/specs/implemented/2026-09-11-first-navigation-loading-state.md`, "What Q3 costs").
 */
export function shellQueryOptions({
  queryFn,
}: {
  queryFn: () => Promise<ShellData | null>
}) {
  return {
    queryKey: SHELL_QUERY_KEY,
    queryFn,
    staleTime: SHELL_STALE_TIME,
    gcTime: SHELL_GC_TIME,
    revalidateIfStale: true,
  }
}

/**
 * The shell as it crosses from the SSR pass into the browser: the data, and the moment the
 * **server** resolved it.
 *
 * `null` on every document where `_app` never matched — the landing page, `/login`, an invitation —
 * so a signed-out document carries no session-derived value at all.
 */
export interface DehydratedShell {
  readonly shell: ShellData | null
  readonly shellUpdatedAt: number | null
}

/** What the router's `dehydrate` option writes into the document. A synchronous cache read. */
export function dehydrateShell(queryClient: QueryClient): DehydratedShell {
  return {
    shell: queryClient.getQueryData<ShellData | null>(SHELL_QUERY_KEY) ?? null,
    shellUpdatedAt:
      queryClient.getQueryState(SHELL_QUERY_KEY)?.dataUpdatedAt ?? null,
  }
}

/**
 * What the router's `hydrate` option does with it: seed the browser's cache, so the first
 * client-side navigation's `ensureQueryData` resolves from cache instead of from the network.
 *
 * The server's stamp is put back through `updatedAt` rather than letting `setQueryData` stamp
 * `Date.now()`. Freshness is measured from `dataUpdatedAt`, and a hydration-time stamp would widen
 * the thirty-second window by however long the document took to arrive and hydrate.
 *
 * `setQueryData` builds the query from the client's defaults, not from {@link shellQueryOptions},
 * so the key's `gcTime` is registered first — otherwise the primed entry would be collected on the
 * default five-minute schedule before `beforeLoad` ever got to apply its own options.
 */
export function hydrateShell(
  queryClient: QueryClient,
  { shell, shellUpdatedAt }: DehydratedShell,
): void {
  if (!shell) return
  queryClient.setQueryDefaults(SHELL_QUERY_KEY, { gcTime: SHELL_GC_TIME })
  queryClient.setQueryData(SHELL_QUERY_KEY, shell, {
    updatedAt: shellUpdatedAt ?? undefined,
  })
}
