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

/** What `_app.beforeLoad` hands to `ensureQueryData`. */
export function shellQueryOptions({
  queryFn,
}: {
  queryFn: () => Promise<ShellData | null>
}) {
  return {
    queryKey: SHELL_QUERY_KEY,
    queryFn,
    staleTime: SHELL_STALE_TIME,
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
 */
export function hydrateShell(
  queryClient: QueryClient,
  { shell, shellUpdatedAt }: DehydratedShell,
): void {
  if (!shell) return
  queryClient.setQueryData(SHELL_QUERY_KEY, shell, {
    updatedAt: shellUpdatedAt ?? undefined,
  })
}
